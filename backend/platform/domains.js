/**
 * Own-domain automation: when a client's own domain is saved, check its DNS, then
 * ask the server helper script to create the web-server site + free SSL (Let's Encrypt),
 * then confirm the domain really opens that newspaper.
 *
 * The helper (deploy/epaper-domain.sh → /usr/local/bin/epaper-domain) runs as root via sudo;
 * it is the ONLY thing the app may run with sudo (see deploy/README-domains.md).
 *
 * Status per domain (table tenant_domains): pending_dns → configuring → live | ssl_error | error | manual
 */
const dns = require('dns').promises;
const fs = require('fs');
const { execFile } = require('child_process');
const config = require('../config');
const { master } = require('../config/db');
const platformSettings = require('./settings');

const SCRIPT = process.env.DOMAIN_SCRIPT || '/usr/local/bin/epaper-domain';
const AUTOMATION = String(process.env.DOMAIN_AUTOMATION || 'on').toLowerCase() !== 'off';
const DOMAIN_RE = /^(?=.{4,190}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const running = new Set();

async function ensureTable() {
  await master.query(`CREATE TABLE IF NOT EXISTS tenant_domains (
    tenant_id INT UNSIGNED NOT NULL PRIMARY KEY,
    domain VARCHAR(191) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending_dns',
    message VARCHAR(500) NULL,
    dns_ips VARCHAR(255) NULL,
    log TEXT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    checked_at DATETIME NULL,
    live_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

const run = (args, timeout = 240000) => new Promise((resolve) => {
  execFile('sudo', ['-n', SCRIPT, ...args], { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim().slice(-4000), timedOut: !!err?.killed });
  });
});

/** Is the helper installed and allowed? Returns { ready, server, message }. */
async function serverStatus() {
  if (!AUTOMATION) return { ready: false, automation: false, message: 'Turned off (DOMAIN_AUTOMATION=off in .env).' };
  if (process.platform === 'win32') return { ready: false, automation: true, message: 'Automatic setup works on the Linux server only. On this Windows PC, set domains up by hand.' };
  if (!fs.existsSync(SCRIPT)) return { ready: false, automation: true, message: `Server helper not installed (${SCRIPT}). See deploy/README-domains.md.` };
  const r = await run(['check'], 20000);
  if (r.code !== 0) {
    const m = /password is required|not allowed|sudoers/i.test(r.out) ? 'The app is not allowed to run the helper with sudo. Add the sudoers line from deploy/README-domains.md.' : (r.out.split('\n').pop() || 'Helper check failed');
    return { ready: false, automation: true, message: m };
  }
  const server = (r.out.match(/server=(\w+)/) || [])[1] || 'unknown';
  const certbot = /certbot=yes/.test(r.out);
  return { ready: true, automation: true, server, certbot, message: `Ready · ${server}${certbot ? ' + certbot' : ' (certbot missing: no SSL)'}` };
}

/** The public IP(s) your domains must point to. */
async function serverIps() {
  const s = await platformSettings.getAll();
  const set = String(s.server_ip || '').split(/[\s,]+/).filter(Boolean);
  if (set.length) return set;
  try { const host = new URL(s.platform_url).hostname; if (!/^localhost$|^127\./.test(host)) return await resolveA(host); } catch { /* ignore */ }
  return [];
}

/** Ask public DNS (not the server's cache) for the domain's A records. */
async function resolveA(domain) {
  const NONE = ['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ENOTIMP', 'EREFUSED', 'NXDOMAIN'];
  const r = new dns.Resolver({ timeout: 4000, tries: 1 }); r.setServers(['1.1.1.1', '8.8.8.8']);
  try { return await r.resolve4(domain); } catch (e) { if (NONE.includes(e.code)) return []; }
  // Public DNS not reachable from this server: use the server's own resolver, then the hosts file
  try { return await dns.resolve4(domain); } catch (e) { if (!NONE.includes(e.code) && e.code !== 'ETIMEOUT' && e.code !== 'ECONNREFUSED') throw e; }
  try { return (await dns.lookup(domain, { all: true, family: 4 })).map((a) => a.address); } catch { return []; }
}

/** DNS records the client must add at their domain registrar. */
function dnsRecords(domain, ips) {
  const parts = domain.split('.');
  const apex = parts.slice(-2).join('.');
  const name = parts.length > 2 ? parts.slice(0, -2).join('.') : '@';
  return (ips.length ? ips : ['<your server IP>']).map((ip) => ({ type: 'A', host: name, value: ip, zone: apex, ttl: '600 seconds' }));
}

async function row(tenantId) { return master.one('SELECT * FROM tenant_domains WHERE tenant_id=?', [tenantId]); }
async function save(tenantId, domain, data) {
  const cur = await row(tenantId);
  const f = { status: data.status, message: data.message ?? null, dns_ips: data.dns_ips ?? cur?.dns_ips ?? null, log: data.log ?? cur?.log ?? null };
  if (cur) {
    await master.query(`UPDATE tenant_domains SET domain=?, status=?, message=?, dns_ips=?, log=?, checked_at=NOW(), attempts=attempts+?, live_at=IF(?='live', COALESCE(live_at, NOW()), live_at) WHERE tenant_id=?`,
      [domain, f.status, f.message, f.dns_ips, f.log, data.attempt ? 1 : 0, f.status, tenantId]);
  } else {
    await master.query("INSERT INTO tenant_domains (tenant_id, domain, status, message, dns_ips, log, attempts, checked_at, live_at) VALUES (?,?,?,?,?,?,?,NOW(),IF(?='live',NOW(),NULL))",
      [tenantId, domain, f.status, f.message, f.dns_ips, f.log, data.attempt ? 1 : 0, f.status]);
  }
}

/** Does the domain really open THIS newspaper? */
async function verify(domain, slug) {
  for (const proto of ['https', 'http']) {
    try {
      const ctl = AbortSignal.timeout(10000);
      const r = await fetch(`${proto}://${domain}/api/v1/health`, { signal: ctl, redirect: 'follow' });
      const j = await r.json().catch(() => ({}));
      if (j.tenant === slug) return { ok: true, https: proto === 'https' };
      if (r.ok && j.success) return { ok: false, message: `The domain reaches the app but opens ${j.tenant ? `"${j.tenant}"` : 'no newspaper'}. Check the domain is saved on this client.` };
    } catch { /* try next */ }
  }
  return { ok: false, message: 'The domain does not open the app yet.' };
}

/**
 * Full check + setup for a client's domain. Safe to call again at any time.
 * @param {object} t tenant  @param {object} opts { force: run the server setup even if it was done }
 */
async function connect(t, opts = {}) {
  if (!t?.domain) return null;
  const domain = String(t.domain).toLowerCase().replace(/:\d+$/, '');
  if (!DOMAIN_RE.test(domain)) { await save(t.id, domain, { status: 'error', message: 'Not a public domain name (e.g. epaper.example.com).' }); return status(t); }
  if (running.has(t.id)) return status(t);
  running.add(t.id);
  try {
    const want = await serverIps();
    const got = await resolveA(domain).catch(() => []);
    const dnsOk = got.length > 0 && (want.length === 0 || got.some((ip) => want.includes(ip)));
    if (!dnsOk) {
      await save(t.id, domain, { status: 'pending_dns', dns_ips: got.join(', '),
        message: got.length ? `DNS points to ${got.join(', ')}; it must point to ${want.join(', ') || 'this server'}.` : 'No DNS record found yet. Add the A record at the domain registrar (changes take 5–30 minutes).' });
      return status(t);
    }
    // Already working (and nothing to redo)?
    const before = await verify(domain, t.slug);
    if (before.ok && before.https && !opts.force) {
      await save(t.id, domain, { status: 'live', dns_ips: got.join(', '), message: 'Live with SSL.' });
      return status(t);
    }
    const srv = await serverStatus();
    if (!srv.ready) {
      await save(t.id, domain, { status: before.ok ? 'live' : 'manual', dns_ips: got.join(', '),
        message: before.ok ? 'Working (http). Automatic SSL is not available: ' + srv.message : 'DNS is correct. Automatic setup is not available: ' + srv.message });
      return status(t);
    }
    await save(t.id, domain, { status: 'configuring', dns_ips: got.join(', '), message: 'Creating the website and SSL certificate…' });
    const s = await platformSettings.getAll();
    const email = s.ssl_email || s.support_email || '';
    const r = await run(['add', domain, String(config.port), email]);
    const after = await verify(domain, t.slug);
    let st; let msg;
    if (after.ok && after.https) { st = 'live'; msg = 'Live with SSL.'; }
    else if (after.ok) { st = 'ssl_error'; msg = 'Website works on http, but the SSL certificate could not be issued. ' + ((r.out.match(/(?:Detail|error|Error):?.*$/m) || [''])[0]).slice(0, 220); }
    else { st = 'error'; msg = r.code !== 0 ? `Server setup failed: ${(r.out.split('\n').filter(Boolean).pop() || 'unknown error').slice(0, 250)}` : after.message; }
    await save(t.id, domain, { status: st, message: msg, log: r.out, attempt: true });
    return status(t);
  } catch (e) {
    await save(t.id, domain, { status: 'error', message: e.message.slice(0, 400), attempt: true });
    return status(t);
  } finally { running.delete(t.id); }
}

/** Remove the web-server site + certificate (domain changed or client deleted). */
async function disconnect(tenantId, domain) {
  await master.query('DELETE FROM tenant_domains WHERE tenant_id=?', [tenantId]).catch(() => {});
  if (!domain || !DOMAIN_RE.test(domain)) return;
  const srv = await serverStatus();
  if (srv.ready) { const r = await run(['remove', domain], 120000); if (r.code) console.error('[domains] remove', domain, r.out.slice(-300)); }
}

async function status(t) {
  const r = t?.domain ? await row(t.id) : null;
  const ips = await serverIps();
  return {
    domain: t?.domain || null,
    status: r && r.domain === t.domain ? r.status : (t?.domain ? 'pending_dns' : 'none'),
    message: r && r.domain === t.domain ? r.message : (t?.domain ? 'Not checked yet.' : null),
    dns_found: r?.dns_ips ? r.dns_ips.split(', ') : [],
    server_ips: ips,
    records: t?.domain ? dnsRecords(String(t.domain).replace(/:\d+$/, ''), ips) : [],
    checked_at: r?.checked_at || null, live_at: r?.live_at || null, attempts: r?.attempts || 0,
    log: r?.log || null, busy: running.has(t?.id),
  };
}

/** Scheduler: keep trying domains that are waiting for DNS; re-check live ones daily. */
async function autoCheck() {
  const list = await master.query(`SELECT t.* FROM tenants t LEFT JOIN tenant_domains d ON d.tenant_id=t.id
    WHERE t.domain IS NOT NULL AND t.domain<>'' AND (d.tenant_id IS NULL OR d.domain<>t.domain
      OR (d.status IN ('pending_dns','ssl_error','error','configuring') AND d.attempts < 30 AND d.checked_at < NOW() - INTERVAL 10 MINUTE)
      OR (d.status IN ('live','manual') AND d.checked_at < NOW() - INTERVAL 1 DAY))`);
  for (const t of list) await connect(t).catch((e) => console.error('[domains]', t.domain, e.message));
}

module.exports = { ensureTable, connect, disconnect, status, serverStatus, serverIps, autoCheck, dnsRecords, DOMAIN_RE };
