-- Audit DB behaviour checks (run after migrations). Each check prints PASS/FAIL.
\set ON_ERROR_STOP 0
BEGIN;
INSERT INTO schools(id,name,code,city,state) VALUES ('11111111-1111-1111-1111-111111111111','Audit School','AUD1','Delhi','Delhi');
INSERT INTO drivers(id,school_id,full_name,phone,license_number) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Ramesh','+919876543210','DL123');
INSERT INTO buses(id,school_id,registration_number,bus_number) VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','DL-01-AB-1234','B1');
INSERT INTO routes(id,school_id,name,code) VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','R1','R1');
INSERT INTO trips(id,school_id,route_id,bus_id,driver_id,scheduled_start_time) VALUES ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',now());
COMMIT;

\echo '--- 2.5 updated_at trigger'
UPDATE buses SET bus_number='B1x', updated_at='2000-01-01' WHERE id='33333333-3333-3333-3333-333333333333';
SELECT CASE WHEN updated_at > now() - interval '1 minute' THEN 'PASS updated_at auto-refreshed' ELSE 'FAIL' END FROM buses WHERE id='33333333-3333-3333-3333-333333333333';

\echo '--- 6.3 soft-delete a bus, then re-register the same plate'
UPDATE buses SET deleted_at=now() WHERE id='33333333-3333-3333-3333-333333333333';
INSERT INTO buses(school_id,registration_number,bus_number) VALUES ('11111111-1111-1111-1111-111111111111','DL-01-AB-1234','B1-new');
SELECT CASE WHEN count(*)=2 THEN 'PASS re-register after soft delete' ELSE 'FAIL re-register after soft delete blocked by unique constraint' END FROM buses WHERE registration_number='DL-01-AB-1234';
UPDATE buses SET deleted_at=NULL WHERE id='33333333-3333-3333-3333-333333333333';

\echo '--- 7.x same driver phone in two schools'
INSERT INTO schools(id,name,code,city,state) VALUES ('66666666-6666-6666-6666-666666666666','Other School','AUD2','Gurgaon','Haryana');
INSERT INTO drivers(school_id,full_name,phone,license_number) VALUES ('66666666-6666-6666-6666-666666666666','Ramesh (2nd job)','+919876543210','DL123');
SELECT CASE WHEN count(*)=2 THEN 'WARN same phone allowed in 2 schools -> driver login picks one arbitrarily (LIMIT 1)' ELSE 'PASS' END FROM drivers WHERE phone='+919876543210';

\echo '--- 11.2 duplicate GPS point dedupe'
INSERT INTO gps_locations(trip_id,bus_id,driver_id,latitude,longitude,location,recorded_at) VALUES ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',28.6,77.2,'SRID=4326;POINT(77.2 28.6)','2026-10-15T10:00:00Z') ON CONFLICT (trip_id, recorded_at) DO NOTHING;
INSERT INTO gps_locations(trip_id,bus_id,driver_id,latitude,longitude,location,recorded_at) VALUES ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',28.6,77.2,'SRID=4326;POINT(77.2 28.6)','2026-10-15T10:00:00Z') ON CONFLICT (trip_id, recorded_at) DO NOTHING;
SELECT CASE WHEN count(*)=1 THEN 'PASS duplicate GPS point ignored' ELSE 'FAIL' END FROM gps_locations;

\echo '--- 11.4 GPS point for a trip that does not exist (batch path)'
INSERT INTO gps_locations(trip_id,bus_id,driver_id,latitude,longitude,location,recorded_at) VALUES ('99999999-9999-9999-9999-999999999999','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',28.6,77.2,'SRID=4326;POINT(77.2 28.6)',now());

\echo '--- 2.x columns the code expects but schema lacks'
SELECT table_name, 'has deleted_at' FROM information_schema.columns WHERE column_name='deleted_at' AND table_name IN ('trips','incidents','delays','sos_events','student_stop_assignments');
SELECT 'FAIL: trips/incidents/delays/sos_events/student_stop_assignments have NO deleted_at column, but services query it' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name='deleted_at' AND table_name='trips');

\echo '--- 2.5 trip status / incident severity constraints'
INSERT INTO trips(school_id,route_id,bus_id,driver_id,scheduled_start_time,status) VALUES ('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',now(),'BANANA');
SELECT CASE WHEN count(*)>0 THEN 'WARN trips.status accepts any string (no CHECK constraint)' ELSE 'PASS' END FROM trips WHERE status='BANANA';
