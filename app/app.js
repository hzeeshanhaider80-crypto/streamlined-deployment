// The web application. createApp(db) receives the database, so tests can pass a fake one.
const express = require('express');
const path = require('path');
const os = require('os');

function createApp(db) {
  const app = express();
  const APP_ENV = process.env.APP_ENV || 'development';
  const APP_VERSION = process.env.APP_VERSION || 'local';   // CI sets the commit ID

  app.set('trust proxy', 1);          // behind Nginx: read the real visitor IP
  app.disable('x-powered-by');        // don't advertise "Express"
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, 'public')));  // serves public/index.html

  // LIVENESS: "is the app process running?" (no database check, used by Docker)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // READINESS: "can the app do real work?" (checks the database, used by deploys)
  app.get('/ready', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ready', database: 'connected' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', database: 'unreachable' });
    }
  });

  // Deployment info: which version and container answered
  app.get('/api/info', (req, res) => {
    res.json({
      environment: APP_ENV,
      version: APP_VERSION,
      container: os.hostname(),
      clientIp: req.ip,
      time: new Date().toISOString(),
    });
  });

  // Save a visit in the database (RDS) and return the total number of visits
  app.post('/api/visits', async (req, res, next) => {
    try {
      await db.query('INSERT INTO visits (client_ip) VALUES ($1)', [req.ip]);
      const result = await db.query('SELECT COUNT(*)::int AS total FROM visits');
      res.json({ total: result.rows[0].total });
    } catch (err) {
      next(err);                        // hand the error to the error handler below
    }
  });

  // Unknown routes → 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Errors → 500, details only in the server log (never shown to visitors)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
