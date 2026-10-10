import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/last_known_state_model.dart';
import '../models/queued_telemetry_item.dart';

/// SQLite Database Service for offline state caching and pending telemetry queue
class LocalDatabaseService {
  static final LocalDatabaseService _instance = LocalDatabaseService._internal();
  factory LocalDatabaseService() => _instance;
  LocalDatabaseService._internal();

  Database? _db;

  Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDatabase();
    return _db!;
  }

  Future<Database> _initDatabase() async {
    final databasesPath = await getDatabasesPath();
    final path = join(databasesPath, 'driver_telemetry.db');

    return await openDatabase(
      path,
      version: 1,
      onCreate: (Database db, int version) async {
        // 1. Cached Key-Value State Table
        await db.execute('''
          CREATE TABLE cached_state (
            key TEXT PRIMARY KEY,
            json_value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        ''');

        // 2. Pending Telemetry Queue Table
        await db.execute('''
          CREATE TABLE pending_telemetry_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id TEXT NOT NULL,
            bus_id TEXT NOT NULL,
            driver_id TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            speed_kmh REAL NOT NULL,
            bearing_degrees REAL,
            accuracy_meters REAL,
            recorded_at TEXT NOT NULL,
            retry_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
          )
        ''');

        // Create index for rapid queue draining
        await db.execute('''
          CREATE INDEX idx_pending_created ON pending_telemetry_queue (created_at ASC)
        ''');
      },
    );
  }

  // ==================== STATE CACHE ====================

  /// Save last known state snapshot
  Future<void> saveLastKnownState(LastKnownStateSnapshot snapshot) async {
    final db = await database;
    final jsonStr = jsonEncode(snapshot.toJson());
    await db.insert(
      'cached_state',
      {
        'key': 'last_known_driver_state',
        'json_value': jsonStr,
        'updated_at': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Retrieve last known state snapshot
  Future<LastKnownStateSnapshot?> getLastKnownState() async {
    try {
      final db = await database;
      final results = await db.query(
        'cached_state',
        where: 'key = ?',
        whereArgs: ['last_known_driver_state'],
        limit: 1,
      );

      if (results.isNotEmpty) {
        final jsonStr = results.first['json_value'] as String;
        final decoded = jsonDecode(jsonStr) as Map<String, dynamic>;
        return LastKnownStateSnapshot.fromJson(decoded);
      }
    } catch (_) {
      // Fallback gracefully on corrupt or missing cache
    }
    return null;
  }

  // ==================== TELEMETRY QUEUE ====================

  /// Enqueue a telemetry ping to the local SQLite queue
  Future<int> enqueueTelemetry(QueuedTelemetryItem item) async {
    final db = await database;
    return await db.insert(
      'pending_telemetry_queue',
      item.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Fetch up to [limit] oldest pending telemetry records
  Future<List<QueuedTelemetryItem>> getPendingTelemetry({int limit = 50}) async {
    final db = await database;
    final results = await db.query(
      'pending_telemetry_queue',
      orderBy: 'created_at ASC',
      limit: limit,
    );

    return results.map((row) => QueuedTelemetryItem.fromMap(row)).toList();
  }

  /// Delete successfully synced telemetry pings by their IDs
  Future<int> removeTelemetry(List<int> ids) async {
    if (ids.isEmpty) return 0;
    final db = await database;
    final placeholders = List.filled(ids.length, '?').join(',');
    return await db.delete(
      'pending_telemetry_queue',
      where: 'id IN ($placeholders)',
      whereArgs: ids,
    );
  }

  /// Increment retry counter on failed batch delivery
  Future<void> incrementRetryCount(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await database;
    final placeholders = List.filled(ids.length, '?').join(',');
    await db.rawUpdate('''
      UPDATE pending_telemetry_queue
      SET retry_count = retry_count + 1
      WHERE id IN ($placeholders)
    ''', ids);
  }

  /// Get total count of pending telemetry items
  Future<int> getPendingCount() async {
    try {
      final db = await database;
      final result = await db.rawQuery('SELECT COUNT(*) as count FROM pending_telemetry_queue');
      return Sqflite.firstIntValue(result) ?? 0;
    } catch (_) {
      return 0;
    }
  }

  /// Clear all cache and pending items (e.g. on clean logout)
  Future<void> clearAll() async {
    final db = await database;
    await db.delete('cached_state');
    await db.delete('pending_telemetry_queue');
  }
}
