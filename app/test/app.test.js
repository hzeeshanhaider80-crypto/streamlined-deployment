// Unit tests with a FAKE database, so they run anywhere (CI has no RDS).
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');

// Fake database that behaves like PostgreSQL for our queries
function fakeDb() {
  let count = 0;
  return {
    async query(sql) {
      if (sql.startsWith('INSERT')) { count++; return { rows: [] }; }
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ total: count }] };
      return { rows: [{ ok: 1 }] };     // SELECT 1
    },
  };
}
// Fake database that is "down"
const brokenDb = { async query() { throw new Error('connection refused'); } };

// Start an app on a random free port and return its base URL
function start(db) {
  return new Promise((resolve) => {
    const server = createApp(db).listen(0, () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('GET /health is always ok (does not need the database)', async () => {
  const { server, url } = await start(brokenDb);
  const res = await fetch(`${url}/health`);
  assert.strictEqual(res.status, 200);
  server.close();
});

test('GET /ready is 200 when the database works', async () => {
  const { server, url } = await start(fakeDb());
  const res = await fetch(`${url}/ready`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).database, 'connected');
  server.close();
});

test('GET /ready is 503 when the database is down', async () => {
  const { server, url } = await start(brokenDb);
  const res = await fetch(`${url}/ready`);
  assert.strictEqual(res.status, 503);
  server.close();
});

test('POST /api/visits counts visits', async () => {
  const { server, url } = await start(fakeDb());
  await fetch(`${url}/api/visits`, { method: 'POST' });
  const res = await fetch(`${url}/api/visits`, { method: 'POST' });
  assert.strictEqual((await res.json()).total, 2);
  server.close();
});

test('unknown route returns 404', async () => {
  const { server, url } = await start(fakeDb());
  const res = await fetch(`${url}/nope`);
  assert.strictEqual(res.status, 404);
  server.close();
});
