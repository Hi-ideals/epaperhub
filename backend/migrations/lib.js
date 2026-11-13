/* Ordered SQL migration runner for one database (used for every client database). */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config');

const ident = (name) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid database name: ${name}`);
  return name;
};

async function createDatabase(dbName) {
  const admin = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${ident(dbName)}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally { await admin.end(); }
}

async function dropDatabase(dbName) {
  const admin = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
  try { await admin.query(`DROP DATABASE IF EXISTS \`${ident(dbName)}\``); } finally { await admin.end(); }
}

/** Create the database if needed and apply all pending migrations. Returns the number applied. */
async function migrate(dbName, { log = () => {} } = {}) {
  await createDatabase(dbName);
  const conn = await mysql.createConnection({ ...config.db, database: dbName, multipleStatements: false });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS migrations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(191) NOT NULL UNIQUE,
      run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`);
    const [done] = await conn.query('SELECT name FROM migrations');
    const doneSet = new Set(done.map((r) => r.name));
    const files = fs.readdirSync(__dirname).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      if (doneSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
      log(`→ ${dbName}: running ${file} (${statements.length} statements)`);
      for (const st of statements) {
        try { await conn.query(st); } catch (e) {
          e.message = `${e.message}\n  in statement: ${st.slice(0, 120).replace(/\s+/g, ' ')}…`;
          throw e;
        }
      }
      await conn.query('INSERT INTO migrations (name) VALUES (?)', [file]);
      count++;
    }
    return count;
  } finally { await conn.end(); }
}

module.exports = { migrate, createDatabase, dropDatabase };
