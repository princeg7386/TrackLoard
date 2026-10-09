import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';

const PORT = env.PORT;

const server = app.listen(PORT, () => {
  console.log(`🚌 [${env.APP_NAME}] Server running in ${env.NODE_ENV} mode on port ${PORT}`);
  console.log(`📡 Health check available at: http://localhost:${PORT}/health`);
  console.log(`🔗 API Base route: http://localhost:${PORT}/api/v1`);
});

// Graceful Shutdown Handlers
async function handleShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    console.log('🔒 Closed HTTP server connections.');
    try {
      await pool.end();
      console.log('📦 Closed database pool connections.');
      process.exit(0);
    } catch (err) {
      console.error('Error closing database pool:', err);
      process.exit(1);
    }
  });

  // Force exit after 10s if hanging
  setTimeout(() => {
    console.error('⚠️ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default server;
