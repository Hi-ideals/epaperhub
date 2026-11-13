/**
 * Works out which newspaper (client) a request is for and runs the rest of the request
 * inside that client's context (database, files, cache):
 *   1. /n/<slug>/…            path on the platform domain   (the prefix is stripped)
 *   2. X-Tenant: <slug>       API calls from a /n/<slug> page
 *   3. the request's domain   a client's own domain, e.g. epaper.vachanakranti.com
 *   4. the platform "home newspaper", if the super admin chose one
 * /api/v1/platform/* (super admin) always runs on the platform database.
 */
const tenants = require('../platform/tenants');
const ctx = require('../platform/context');
const platformSettings = require('../platform/settings');

const SLUG = /^\/n\/([a-z0-9][a-z0-9-]{0,78})(?=\/|\?|$)/i;

async function resolveTenant(req, res, next) {
  try {
    if (req.path.startsWith('/api/v1/platform') || req.path.startsWith('/uploads/') || req.path.startsWith('/assets/')) return ctx.run(null, next);

    let tenant = null;
    const m = req.url.match(SLUG);
    if (m) {
      req.tenantBase = `/n/${m[1].toLowerCase()}`;
      req.url = req.url.slice(m[0].length) || '/';
      if (req.url.startsWith('?')) req.url = `/${req.url}`;
      tenant = await tenants.bySlug(m[1]);
      if (!tenant) req.tenantMissing = true;
    } else if (req.headers['x-tenant'] || req.query._t) {
      tenant = await tenants.bySlug(String(req.headers['x-tenant'] || req.query._t).slice(0, 80));
      if (!tenant) req.tenantMissing = true;
    } else {
      tenant = await tenants.byDomain(req.hostname);
      if (!tenant) {
        const home = Number((await platformSettings.getAll()).home_tenant_id) || 0;
        if (home) tenant = await tenants.byId(home);
      }
    }
    req.tenant = tenant || null;
    ctx.run(req.tenant, next);
  } catch (e) { next(e); }
}

/** Re-enter the request's client context (needed after stream-based middleware like multer). */
const rebind = (req, fn) => ctx.run(req.tenant || null, fn);

/**
 * API guard: client APIs need a client; an inactive/expired client is closed to readers
 * and its staff (the super admin can still open it via "Login as client").
 */
function requireTenant(req, res, next) {
  if (!req.tenant) {
    return res.status(404).json({ success: false, code: req.tenantMissing ? 'TENANT_NOT_FOUND' : 'NO_TENANT', message: 'Newspaper not found.' });
  }
  if (!req.tenant.is_active) {
    // Closed newspaper: only the super admin's "Login as client" token gets through
    req.impersonationOnly = true;
    const header = req.headers.authorization || '';
    let p = null;
    try { p = header.startsWith('Bearer ') ? require('jsonwebtoken').verify(header.slice(7), require('../config').jwt.secret) : null; } catch { p = null; }
    if (!p || !p.imp || p.tid !== req.tenant.id) return inactive(req, res);
  }
  next();
}

async function inactive(req, res) {
  const s = await platformSettings.getAll().catch(() => ({}));
  res.status(403).json({ success: false, code: 'TENANT_INACTIVE', message: s.unavailable_message || 'This newspaper is temporarily unavailable.', expired: !!req.tenant?.is_expired });
}

module.exports = { resolveTenant, requireTenant, rebind, inactive };
