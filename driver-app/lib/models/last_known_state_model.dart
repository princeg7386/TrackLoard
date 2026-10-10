import 'dart:convert';
import 'driver_profile.dart';

/// Snapshot of the last-known driver, bus, and trip state saved locally in SQLite
class LastKnownStateSnapshot {
  final DriverProfileData? profile;
  final double? lastLatitude;
  final double? lastLongitude;
  final DateTime cachedAt;

  LastKnownStateSnapshot({
    this.profile,
    this.lastLatitude,
    this.lastLongitude,
    DateTime? cachedAt,
  }) : cachedAt = cachedAt ?? DateTime.now();

  Map<String, dynamic> toJson() {
    return {
      'profile': profile != null
          ? {
              'driver': profile!.driver.toJson(),
              'assignedBus': profile!.assignedBus?.toJson(),
              'activeTrip': profile!.activeTrip,
              'todayTrips': profile!.todayTrips,
            }
          : null,
      'lastLatitude': lastLatitude,
      'lastLongitude': lastLongitude,
      'cachedAt': cachedAt.toIso8601String(),
    };
  }

  factory LastKnownStateSnapshot.fromJson(Map<String, dynamic> json) {
    DriverProfileData? parsedProfile;
    if (json['profile'] != null && json['profile'] is Map<String, dynamic>) {
      parsedProfile = DriverProfileData.fromJson(json['profile']);
    }

    return LastKnownStateSnapshot(
      profile: parsedProfile,
      lastLatitude: (json['lastLatitude'] as num?)?.toDouble(),
      lastLongitude: (json['lastLongitude'] as num?)?.toDouble(),
      cachedAt: json['cachedAt'] != null
          ? DateTime.tryParse(json['cachedAt'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }
}
