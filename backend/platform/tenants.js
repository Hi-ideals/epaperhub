/** Clients (newspapers): lookup, limits, provisioning and storage usage. */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { master, closeTenantPool } = require('../config/db');
const ctx = require('./context');
const { KEYS } = require('./features');

const parseList = (v) => { try { const a = JSON.parse(v || 'null'); return Array.isArray(a) ? a : null; } catch { return null; } };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const SELECT = `SELECT t.*, p.name AS plan_name, p.storage_mb AS plan_storage_mb, p.max_admin_users AS plan_max_admin_users,
  p.max_editions_per_month AS plan_max_editions_per_month, p.modules AS plan_modules, p.price AS plan_price, p.currency AS plan_currency, p.duration_months AS plan_duration_months
  FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id`;

/** Effective limits/modules: client override, else the plan, else defaults. */
function decorate(t) {
  if (!t) return null;
  const pick = (own, plan, def) => (own !== null && own !== undefined ? Number(own) : plan !== null && plan !== undefined ? Number(plan) : def);
  t.limits = {
    storage_mb: pick(t.storage_mb, t.plan_storage_mb, 5120),
    max_admin_users: pick(t.max_admin_users, t.plan_max_admin_users, 5),
    max_editions_per_month: pick(t.max_editions_per_month, t.plan_max_editions_per_month, 0),
  };
  t.features = parseList(t.modules) || parseList(t.plan_modules) || KEYS;
  t.expires_at = t.expires_at ? String(t.expires_at).slice(0, 10) : null;
  t.starts_at = t.starts_at ? String(t.starts_at).slice(0, 10) : null;
  t.is_expired = !!t.expires_at && t.expires_at < todayISO();
  t.is_active = t.status === 'active' && !t.is_expired;
  return t;
}

/* Short cache: tenants are looked up on every request */
const cache = new Map();
const TTL = 20 * 1000;
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + TTL });
  return val;
}
const forget = () => cache.clear();

const bySlug = (slug) => cached(`s:${slug}`, async () => decorate(await master.one(`${SELECT} WHERE t.slug=?`, [String(slug).toLowerCase()])));
const byDomain = (host) => cached(`d:${host}`, async () => decorate(await master.one(`${SELECT} WHERE t.domain=?`, [String(host).toLowerCase()])));
const byId = async (id) => decorate(await master.one(`${SELECT} WHERE t.id=?`, [id]));
const all = async () => (await master.query(`${SELECT} ORDER BY t.created_at DESC`)).map(decorate);

const dbNameFor = (id) => `${config.db.database}_c${id}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
const dirsFor = (id) => [path.join(config.paths.uploadsRoot, `c${id}`), path.join(config.paths.originalsRoot, `c${id}`), path.join(config.paths.backupsRoot, `c${id}`)];

/** Run fn inside a client's context (its database, folders, cache). */
const within = (t, fn) => ctx.run(t, fn);

/** Bring a client database up to date (migrations + automatic upgrades + defaults). */
async function upgrade(t) {
  const { migrate } = require('../migrations/lib');
  await migrate(t.db_name);
  await within(t, async () => {
    await require('../services/schemaUpgrades').run();
    await require('../services/backup').ensureTables();
    await require('../services/settings').ensureDefaults();
  });
  for (const d of dirsFor(t.id)) fs.mkdirSync(d, { recursive: true });
}

/**
 * Create a client: platform row, its own database (all tables), its folders, and its
 * first admin account. Rolls everything back if any step fails.
 */
async function provision(data) {
  const r = await master.query(`INSERT INTO tenants (name, slug, domain, owner_name, owner_email, owner_phone, plan_id, status, starts_at, expires_at,
      storage_mb, max_admin_users, max_editions_per_month, modules, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [data.name, data.slug, data.domain || null, data.owner_name || null, data.owner_email, data.owner_phone || null, data.plan_id || null, data.status || 'active',
    data.starts_at || null, data.expires_at || null, data.storage_mb ?? null, data.max_admin_users ?? null, data.max_editions_per_month ?? null,
    data.modules ? JSON.stringify(data.modules) : null, data.notes || null]);
  const id = r.insertId;
  const dbName = dbNameFor(id);
  try {
    await master.query('UPDATE tenants SET db_name=? WHERE id=?', [dbName, id]);
    forget();
    const t = await byId(id);
    const platformUrl = (await require('./settings').getAll()).platform_url;
    await upgrade(t);
    await within(t, () => require('../seeders/base').seedBase({
      adminName: data.owner_name || data.name, adminEmail: data.owner_email, adminPassword: data.admin_password,
      siteName: data.name, siteUrl: siteUrlOf(t, platformUrl),
    }));
    return t;
  } catch (e) {
    await closeTenantPool(dbName);
    await require('../migrations/lib').dropDatabase(dbName).catch(() => {});
    await master.query('DELETE FROM tenants WHERE id=?', [id]).catch(() => {});
    forget();
    throw e;
  }
}

/** Permanently delete a client: its database and all its files. */
async function destroy(t) {
  await closeTenantPool(t.db_name);
  if (t.db_name) await require('../migrations/lib').dropDatabase(t.db_name);
  for (const d of dirsFor(t.id)) fs.rmSync(d, { recursive: true, force: true });
  await master.query('DELETE FROM tenants WHERE id=?', [t.id]);
  await require('./credentials').removeTenant(t.id);
  forget();
}

/** Public address of a client's newspaper. */
function siteUrlOf(t, platformUrl) {
  if (t.domain) return `${/^localhost|^127\./.test(t.domain) ? 'http' : 'https'}://${t.domain}`;
  return `${(platformUrl || config.appUrl).replace(/\/$/, '')}/n/${t.slug}`;
}

/** Store the newspaper's public address in its own settings (used for SEO, sitemap, share links). */
async function syncSiteUrl(t, platformUrl) {
  if (!t?.db_name) return;
  await within(t, async () => {
    await require('../services/settings').updateGroup('website_settings', { site_url: siteUrlOf(t, platformUrl) });
    require('../services/cache').invalidate();
  }).catch((e) => console.warn(`[platform] site_url sync for ${t.slug}:`, e.message));
}

/* ---------------- Storage usage ---------------- */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* gone */ } }
    }
  }
  return total;
}

/** Bytes used by a client's files (page images, originals, logos, clips). Backups are not counted. */
async function storageUsed(t, { fresh = false } = {}) {
  const age = t.storage_checked_at ? Date.now() - new Date(t.storage_checked_at).getTime() : Infinity;
  if (!fresh && age < 5 * 60 * 1000) return Number(t.storage_used_bytes) || 0;
  const [up, orig] = dirsFor(t.id);
  const bytes = dirSize(up) + dirSize(orig);
  await master.query('UPDATE tenants SET storage_used_bytes=?, storage_checked_at=NOW() WHERE id=?', [bytes, t.id]);
  t.storage_used_bytes = bytes; t.storage_checked_at = new Date();
  forget();
  return bytes;
}

module.exports = { syncSiteUrl, bySlug, byDomain, byId, all, decorate, forget, provision, destroy, upgrade, within, siteUrlOf, storageUsed, dbNameFor, todayISO };
