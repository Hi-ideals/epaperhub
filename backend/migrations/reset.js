/* DANGER: deletes the platform database AND every client's database and files, then runs setup.
   Usage: npm run db:reset */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { execSync } = require('child_process');
const config = require('../config');

(async () => {
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
  const [clients] = await conn.query('SHOW DATABASES LIKE ?', [`${config.db.database}\\_c%`]);
  for (const row of clients) {
    const name = Object.values(row)[0];
    console.log(`→ Dropping client database "${name}"`);
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  }
  console.log(`→ Dropping and recreating platform database "${config.db.database}"`);
  await conn.query(`DROP DATABASE IF EXISTS \`${config.db.database}\``);
  await conn.query(`CREATE DATABASE \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  for (const root of [config.paths.uploadsRoot, config.paths.originalsRoot, config.paths.backupsRoot]) {
    for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) if (/^c\d+$/.test(d)) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
  const root = path.join(__dirname, '..');
  execSync('node migrations/run.js', { cwd: root, stdio: 'inherit' });
  execSync('node seeders/run.js', { cwd: root, stdio: 'inherit' });
})().catch((e) => { console.error('Reset failed:', e.message); process.exit(1); });
