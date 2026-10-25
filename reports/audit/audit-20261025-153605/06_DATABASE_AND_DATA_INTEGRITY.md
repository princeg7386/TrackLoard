# TrackLoard — Database Architecture & Data Integrity Audit

- **Audit Identifier:** `audit-20261025-153605`
- **Audit Date:** 2026-10-25
- **Database Engine:** PostgreSQL 16 + PostGIS 3.4
- **Migration Count:** 21 SQL Migration Scripts (`001_core_entities.sql` through `021_geofence_event_handling.sql`)

---

## 1. Schema & Migration Architecture

The database architecture is designed with strict multi-tenant partitioning, spatial PostGIS indexing, and defensive integrity constraints:

```
Database Schema Overview:
├── Core Multi-Tenancy: schools, admins, audit_logs
├── Transport Directory: buses, drivers, routes, pickup_locations
├── Student & Parent Graph: students, student_parents, student_transport
├── Trip State & Attendance: trips, trip_stops, student_attendance
├── Telemetry & Spatial: gps_locations, bus_latest_location
└── Safety & Geofencing: pickup_geofences, school_geofences, geofence_events, geofence_notification_logs
```

---

## 2. Geospatial PostGIS Indexing & Verification

Spatial tables utilize PostGIS native geometry types (`GEOMETRY(Point, 4326)` and `GEOMETRY(Polygon, 4326)`) indexed with GiST (Generalized Search Tree) for spatial searches:

| Table | Column | Spatial Type / SRID | Index Name & Type | Query Usage |
| :--- | :--- | :--- | :--- | :--- |
| `pickup_locations` | `location` | `Point, 4326` | `idx_pickup_locations_geom (GiST)` | Nearest pickup stop search via `ST_DWithin` |
| `gps_locations` | `location` | `Point, 4326` | `idx_gps_locations_geom (GiST)` | Trip trail queries, geofence collision detection |
| `bus_latest_location` | `location` | `Point, 4326` | `idx_bus_latest_location_geom (GiST)` | Real-time map viewport clustering & live feed |
| `school_geofences` | `boundary` | `Polygon, 4326` | `idx_school_geofences_geom (GiST)` | `ST_Contains` for campus arrival detection |
| `pickup_geofences` | `location` | `Point, 4326` | `idx_pickup_geofences_geom (GiST)` | `ST_DWithin(radius)` for stop arrival alerts |

---

## 3. Multi-Tenant Integrity & Foreign Key Cascades

1. **School Isolation FKs:**
   Every entity (`buses`, `drivers`, `students`, `routes`, `trips`, `audit_logs`) contains a non-nullable `school_id UUID REFERENCES schools(id) ON DELETE RESTRICT`.
2. **Soft Delete Architecture & Partial Indexes:**
   To allow re-registering vehicles or students after deletion without unique constraint collisions, full `UNIQUE` constraints were refactored in migration `015` into partial unique indexes filtered by `WHERE deleted_at IS NULL`:
   - `CREATE UNIQUE INDEX uq_bus_reg_school_active ON buses(school_id, registration_number) WHERE deleted_at IS NULL;`
   - `CREATE UNIQUE INDEX uq_driver_phone_school_active ON drivers(school_id, phone) WHERE deleted_at IS NULL;`
   - `CREATE UNIQUE INDEX uq_student_adm_school_active ON students(school_id, admission_number) WHERE deleted_at IS NULL;`
   - `CREATE UNIQUE INDEX uq_parent_student_phone_active ON student_parents(student_id, phone) WHERE deleted_at IS NULL;`

---

## 4. Trip State Machine Constraints

The `trips` table enforces valid lifecycle progression through an explicit SQL `CHECK` constraint:
```sql
ALTER TABLE trips 
  ADD CONSTRAINT chk_trip_status 
  CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'ARRIVED_AT_SCHOOL', 'COMPLETED', 'CANCELLED'));
```
- When a trip completes:
  1. `end_time` is recorded.
  2. Unmarked stop attendance records are locked.
  3. `trip_stops` state transitions to `VISITED`.
  4. The operation is executed inside an atomic PostgreSQL transaction via `transaction()`.

---

## 5. Transaction Safety & Atomic Operations

The backend provides a transaction runner in `backend/src/config/database.ts`:
```typescript
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```
This utility is utilized in student transport reassignment, trip completion, and batch telemetry ingestion to prevent partial database writes.
