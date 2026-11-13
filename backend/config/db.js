const mysql = require('mysql2/promise');
const config = require('./index');
const ctx = require('../platform/context');

/** Keep MySQL NOW() in the same time zone as Node so schedules & timestamps agree. */
function nodeOffset() {
  const m = -new Date().getTimezoneOffset();
  const s = m >= 0 ? '+' : '-';
  const a = Math.abs(m);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function createPool(database, connectionLimit = 10) {
  const p = mysql.createPool({
    ...config.db,
    database,
    waitForConnections: true,
    connectionLimit,
    charset: 'utf8mb4',
    dateStrings: ['DATE'],
    timezone: 'local',
    supportBigNumbers: true,
    multipleStatements: false,
  });
  p.pool.on('connection', (conn) => { conn.query(`SET time_zone = '${nodeOffset()}'`); });
  return p;
}

/** Platform (master) database: plans, clients, super admins, platform settings. */
const masterPool = createPool(config.db.database, 10);

/** One pool per client database, created on first use. */
const tenantPools = new Map();
function tenantPool(t) {
  if (!t.db_name) throw new Error(`Client #${t.id} has no database`);
  let p = tenantPools.get(t.db_name);
  if (!p) { p = createPool(t.db_name, 8); tenantPools.set(t.db_name, p); }
  return p;
}
async function closeTenantPool(dbName) {
  const p = tenantPools.get(dbName);
  if (p) { tenantPools.delete(dbName); await p.end().catch(() => {}); }
}

/** The pool for the current request: the client's database, or the master database. */
function currentPool() {
  const t = ctx.current();
  return t ? tenantPool(t) : masterPool;
}

/**
 * `pool` keeps the old API (pool.query, pool.getConnection, …) but always talks to the
 * current client's database, so existing feature code needs no changes.
 */
const pool = new Proxy({}, {
  get(_, prop) {
    const p = currentPool();
    const v = p[prop];
    return typeof v === 'function' ? v.bind(p) : v;
  },
});

/** Run a parameterised query and return rows. */
async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function one(sql, params = [], conn = pool) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

/** Run fn(conn) inside a transaction. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Master-database helpers (always the platform DB, whatever the current tenant). */
const master = {
  pool: masterPool,
  query: (sql, params = []) => query(sql, params, masterPool),
  one: (sql, params = []) => one(sql, params, masterPool),
};

module.exports = { pool, query, one, transaction, master, tenantPool, closeTenantPool, createPool };
