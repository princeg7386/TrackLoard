import { pool, query } from '../config/database.js';
import { runMigrations } from './migrate.js';

export async function seedDatabase(): Promise<void> {
  console.log('ðŸŒ± Starting database seeding for development & testing...');

  // Ensure migrations are executed first
  await runMigrations();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create Demo School
    const schoolRes = await client.query(`
      INSERT INTO schools (name, code, address, city, state, postal_code, phone, email, timezone)
      VALUES (
        'Delhi Public School, R.K. Puram',
        'DPS_RKP',
        'Kaifi Azmi Marg, Sector XII, R.K. Puram',
        'New Delhi',
        'Delhi',
        '110022',
        '+911126177000',
        'transport@dpsrkp.net',
        'Asia/Kolkata'
      )
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `);
    const schoolId = schoolRes.rows[0].id;

    // 2. Create Admin User (Demo password hash)
    await client.query(`
      INSERT INTO admins (school_id, email, password_hash, full_name, phone, role)
      VALUES (
        $1,
        'transport.admin@dpsrkp.net',
        '$2b$10$EP1J7gN7R.8oNqI9YmJ84.9aQ42nF3rM5d18k5VzF/4kE7l5v2o3K',
        'Sunil Sharma (Transport Head)',
        '+919811002233',
        'SCHOOL_ADMIN'
      )
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name;
    `, [schoolId]);

    // 3. Create Drivers
    const driver1Res = await client.query(`
      INSERT INTO drivers (school_id, full_name, phone, license_number, license_expiry)
      VALUES (
        $1,
        'Ramesh Kumar Singh',
        '+919876543210',
        'DL-0420110012345',
        '2028-12-31'
      )
      ON CONFLICT (school_id, phone) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id;
    `, [schoolId]);
    const driver1Id = driver1Res.rows[0].id;

    const driver2Res = await client.query(`
      INSERT INTO drivers (school_id, full_name, phone, license_number, license_expiry)
      VALUES (
        $1,
        'Jaswinder Singh',
        '+919876543211',
        'DL-0420150098765',
        '2029-06-30'
      )
      ON CONFLICT (school_id, phone) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id;
    `, [schoolId]);
    const driver2Id = driver2Res.rows[0].id;

    // 4. Create Buses (NO capacity, NO active-inactive toggles)
    const bus1Res = await client.query(`
      INSERT INTO buses (school_id, registration_number, bus_number, default_driver_id, make_model)
      VALUES (
        $1,
        'DL-01-AB-1234',
        'Bus 04 (South Route)',
        $2,
        'Tata Starbus Ultra 32'
      )
      ON CONFLICT (school_id, registration_number) WHERE deleted_at IS NULL DO UPDATE SET bus_number = EXCLUDED.bus_number
      RETURNING id;
    `, [schoolId, driver1Id]);
    const bus1Id = bus1Res.rows[0].id;

    await client.query(`
      INSERT INTO buses (school_id, registration_number, bus_number, default_driver_id, make_model)
      VALUES (
        $1,
        'DL-01-CD-5678',
        'Bus 07 (Central Route)',
        $2,
        'Eicher Starline 38'
      )
      ON CONFLICT (school_id, registration_number) WHERE deleted_at IS NULL DO UPDATE SET bus_number = EXCLUDED.bus_number;
    `, [schoolId, driver2Id]);

    // 5. Create Route
    const routeRes = await client.query(`
      INSERT INTO routes (school_id, name, code, route_type, default_bus_id, default_driver_id, estimated_duration_minutes)
      VALUES (
        $1,
        'South Delhi Morning Route 04',
        'RTE-S04',
        'MORNING_PICKUP',
        $2,
        $3,
        40
      )
      ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `, [schoolId, bus1Id, driver1Id]);
    const routeId = routeRes.rows[0].id;

    // 6. Create Ordered PostGIS Stops
    const stopsData = [
      { name: 'Green Park Metro Gate 2', seq: 1, lat: 28.5589, lng: 77.2065, time: '07:05:00' },
      { name: 'AIIMS Main Circle', seq: 2, lat: 28.5672, lng: 77.2100, time: '07:15:00' },
      { name: 'South Extension Part 1 Market', seq: 3, lat: 28.5723, lng: 77.2224, time: '07:25:00' },
      { name: 'DPS R.K. Puram Campus Gate', seq: 4, lat: 28.5645, lng: 77.1785, time: '07:45:00' },
    ];

    const stopIds: string[] = [];
    for (const stop of stopsData) {
      const stopRes = await client.query(`
        INSERT INTO pickup_locations (
          school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters
        ) VALUES (
          $1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, 300
        )
        ON CONFLICT (route_id, sequence_order) DO UPDATE SET stop_name = EXCLUDED.stop_name
        RETURNING id;
      `, [schoolId, routeId, stop.name, stop.seq, stop.lat, stop.lng, stop.time]);
      stopIds.push(stopRes.rows[0].id);
    }

    // 7. Create Students & 1:1 Parents
    const studentsData = [
      { name: 'Aarav Sharma', adm: 'DPS-2026-881', grade: 'Class 8', sec: 'A', parent: 'Vikram Sharma', phone: '+919811223344', stopIdx: 0 },
      { name: 'Ananya Verma', adm: 'DPS-2026-882', grade: 'Class 9', sec: 'B', parent: 'Priya Verma', phone: '+919811223345', stopIdx: 1 },
      { name: 'Rohan Gupta', adm: 'DPS-2026-883', grade: 'Class 6', sec: 'C', parent: 'Deepak Gupta', phone: '+919811223346', stopIdx: 2 },
      { name: 'Meera Iyer', adm: 'DPS-2026-884', grade: 'Class 7', sec: 'A', parent: 'Karthik Iyer', phone: '+919811223347', stopIdx: 0 },
    ];

    for (const item of studentsData) {
      const stdRes = await client.query(`
        INSERT INTO students (school_id, full_name, admission_number, class_grade, section, emergency_contact_phone)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (school_id, admission_number) WHERE deleted_at IS NULL DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id;
      `, [schoolId, item.name, item.adm, item.grade, item.sec, item.phone]);
      const studentId = stdRes.rows[0].id;

      // Parent 1:1
      await client.query(`
        INSERT INTO parents (school_id, student_id, full_name, phone, relationship)
        VALUES ($1, $2, $3, $4, 'PARENT')
        ON CONFLICT (student_id, phone) WHERE deleted_at IS NULL DO UPDATE SET full_name = EXCLUDED.full_name;
      `, [schoolId, studentId, item.parent, item.phone]);

      // Stop Assignment
      const stopId = stopIds[item.stopIdx]!;
      await client.query(`
        INSERT INTO student_stop_assignments (school_id, student_id, pickup_stop_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (school_id, student_id) DO UPDATE SET pickup_stop_id = EXCLUDED.pickup_stop_id;
      `, [schoolId, studentId, stopId]);
    }

    // 8. Create Active Scheduled Trip for Today
    const today = new Date().toISOString().split('T')[0]!;
    await client.query(`
      INSERT INTO trips (
        school_id, route_id, bus_id, driver_id, status, scheduled_date, scheduled_start_time
      ) VALUES (
        $1, $2, $3, $4, 'SCHEDULED', $5, ($5 || ' 07:00:00+05:30')::timestamptz
      )
      ON CONFLICT DO NOTHING;
    `, [schoolId, routeId, bus1Id, driver1Id, today]);

    await client.query('COMMIT');
    console.log('âœ… Seed data successfully inserted!');
    console.log(`ðŸ« School: DPS RKP (ID: ${schoolId})`);
    console.log(`ðŸšŒ Bus 04 assigned to Route RTE-S04 with 4 PostGIS stops & 4 students`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('âŒ Error during seeding:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seedDatabase()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Seed execution failed:', err);
      process.exit(1);
    });
}

