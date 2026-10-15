import { verifyPostGisConnection, pool } from '../config/database.js';

async function main() {
  console.log('ðŸ” Checking PostgreSQL + PostGIS connection...');
  const status = await verifyPostGisConnection();
  if (status.connected) {
    console.log('âœ… Connected successfully to PostgreSQL!');
    console.log('ðŸ—ºï¸ PostGIS Version:', status.postgisVersion);
  } else {
    console.warn('âš ï¸ Could not connect to PostgreSQL/PostGIS:', status.error);
    console.log('ðŸ’¡ Note: Start the local container via `docker compose -f infrastructure/docker-compose.yml up -d` or verify DATABASE_URL in .env');
  }
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error verifying database:', err);
  process.exit(1);
});

