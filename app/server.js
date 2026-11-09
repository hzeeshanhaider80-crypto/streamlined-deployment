// Entry point: connect to the database, start the web server, shut down cleanly.
const { createApp } = require('./app');
const { createPool, initSchema } = require('./db');

const PORT = process.env.PORT || 3000;
const pool = createPool();
const app = createApp(pool);

// Prepare the database. If RDS isn't reachable yet, keep trying (the app still runs;
// /ready reports 503 until the database works).
async function prepareDatabase() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await initSchema(pool);
      console.log('Database ready');
      return;
    } catch (err) {
      console.error(`Database not ready (attempt ${attempt}/10): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

// 0.0.0.0 = reachable from other containers (Nginx)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`App ${process.env.APP_VERSION || 'local'} listening on port ${PORT}`);
  prepareDatabase();
});

// Graceful shutdown: 'docker stop' sends SIGTERM → stop new requests, close DB, exit
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();   // force exit after 10 s
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
