// Database connection to Amazon RDS (PostgreSQL). All settings come from environment variables.
const fs = require('fs');
const { Pool } = require('pg');

function createPool() {
  // Encrypted connection that verifies RDS's certificate (if the CA file is provided)
  const ssl = process.env.DB_SSL_CA
    ? { ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8'), rejectUnauthorized: true }
    : false;

  const pool = new Pool({
    host: process.env.DB_HOST,          // RDS endpoint
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
    max: 5,                             // at most 5 open connections
    connectionTimeoutMillis: 5000,      // give up connecting after 5 s
    idleTimeoutMillis: 30000,           // close idle connections after 30 s
  });

  // A broken idle connection must not crash the whole app
  pool.on('error', (err) => console.error('Database pool error:', err.message));
  return pool;
}

// Create the table the app needs (safe to run every start: IF NOT EXISTS)
async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id          SERIAL PRIMARY KEY,
      visited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_ip   TEXT
    )`);
}

module.exports = { createPool, initSchema };
