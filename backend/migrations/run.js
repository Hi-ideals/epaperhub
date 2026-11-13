/* `npm run migrate`: sets up the platform database and brings every client database up to date. */
const config = require('../config');
const { createDatabase, migrate } = require('./lib');

async function main() {
  await createDatabase(config.db.database);
  const { ensurePlatformSchema } = require('../platform/schema');
  await ensurePlatformSchema();
  console.log(`✓ Platform database "${config.db.database}" ready.`);
  const { master } = require('../config/db');
  const clients = await master.query('SELECT id, name, db_name FROM tenants WHERE db_name IS NOT NULL');
  for (const c of clients) {
    const n = await migrate(c.db_name, { log: console.log });
    console.log(`✓ ${c.name}: ${n ? `${n} migration(s) applied` : 'up to date'}`);
  }
  await master.pool.end();
}

main().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
