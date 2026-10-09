import { verifyPostGisConnection, pool } from '../config/database.js';

async function main() {
  console.log('🔍 Checking PostgreSQL + PostGIS connection...');
  const status = await verifyPostGisConnection();
  if (status.connected) {
    console.log('✅ Connected successfully to PostgreSQL!');
    console.log('🗺️ PostGIS Version:', status.postgisVersion);
  } else {
    console.warn('⚠️ Could not connect to PostgreSQL/PostGIS:', status.error);
    console.log('💡 Note: Start the local container via `docker compose -f infrastructure/docker-compose.yml up -d` or verify DATABASE_URL in .env');
  }
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error verifying database:', err);
  process.exit(1);
});
