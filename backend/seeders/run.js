/* `npm run seed`: platform super admin (from .env), starter plans and platform settings. Idempotent. */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { master } = require('../config/db');
const { ensurePlatformSchema } = require('../platform/schema');
const platformSettings = require('../platform/settings');
const { KEYS } = require('../platform/features');

const PLANS = [
  { name: 'Basic', description: 'For a single small newspaper', price: 4999, duration_months: 12, storage_mb: 5120, max_admin_users: 2, max_editions_per_month: 31,
    modules: ['area_mapping', 'clippings', 'cms', 'seo'] },
  { name: 'Standard', description: 'Most popular — district editions and readers', price: 9999, duration_months: 12, storage_mb: 20480, max_admin_users: 5, max_editions_per_month: 0,
    modules: ['area_mapping', 'clippings', 'comments', 'schedules', 'subscribers', 'notifications', 'locations', 'cms', 'seo', 'backups'] },
  { name: 'Premium', description: 'Everything, unlimited editions', price: 19999, duration_months: 12, storage_mb: 102400, max_admin_users: 25, max_editions_per_month: 0, modules: KEYS },
];

async function main() {
  await ensurePlatformSchema();

  const email = config.admin.email.toLowerCase();
  if (!(await master.one('SELECT id FROM platform_admins WHERE email=?', [email]))) {
    const hash = await bcrypt.hash(config.admin.password, config.bcryptRounds);
    await master.query('INSERT INTO platform_admins (name, email, password_hash) VALUES (?,?,?)', [config.admin.name, email, hash]);
    console.log(`✓ Super admin created: ${email} / ${config.admin.password}  (log in at /superadmin and change this password)`);
  }

  if (!(await master.one('SELECT id FROM plans LIMIT 1'))) {
    for (const [i, p] of PLANS.entries()) {
      await master.query('INSERT INTO plans (name, description, price, duration_months, storage_mb, max_admin_users, max_editions_per_month, modules, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
        [p.name, p.description, p.price, p.duration_months, p.storage_mb, p.max_admin_users, p.max_editions_per_month, JSON.stringify(p.modules), i + 1]);
    }
    console.log('✓ Starter plans created: Basic, Standard, Premium');
  }

  await platformSettings.ensureDefaults();
  console.log('✓ Platform setup complete.');
}

main().then(() => master.pool.end()).catch((e) => { console.error('Setup failed:', e); master.pool.end(); process.exit(1); });
