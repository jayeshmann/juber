const { createApp } = require('./app');
const config = require('./config');
const { closeRedisConnection } = require('./db/redis');
const { closePool } = require('./db/postgres');
const { disconnectProducer } = require('./events/kafka-producer');

const startServer = async () => {
  try {
    const app = await createApp();

    const server = app.listen(config.PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚗  JUBER RIDE-HAILING PLATFORM                           ║
║                                                              ║
║   Server running on port ${config.PORT}                            ║
║   Environment: ${config.NODE_ENV.padEnd(15)}                        ║
║                                                              ║
║   Endpoints:                                                 ║
║   - Health: http://localhost:${config.PORT}/api/v1/health          ║
║   - Drivers: http://localhost:${config.PORT}/api/v1/drivers        ║
║   - Rides: http://localhost:${config.PORT}/api/v1/rides            ║
║   - Trips: http://localhost:${config.PORT}/api/v1/trips            ║
║   - Surge: http://localhost:${config.PORT}/api/v1/surge            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        console.log('HTTP server closed');

        try {
          await closeRedisConnection();
          console.log('Redis connection closed');
        } catch (err) {
          console.error('Error closing Redis:', err);
        }

        try {
          await closePool();
          console.log('PostgreSQL pool closed');
        } catch (err) {
          console.error('Error closing PostgreSQL:', err);
        }

        try {
          await disconnectProducer();
          console.log('Kafka producer disconnected');
        } catch (err) {
          console.error('Error disconnecting Kafka:', err);
        }

        console.log('Graceful shutdown complete');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
