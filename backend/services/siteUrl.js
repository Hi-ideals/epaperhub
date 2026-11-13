/** Public address of the current newspaper: its own domain, else <platform address>/n/<slug>. */
const config = require('../config');
const ctx = require('../platform/context');

async function siteBase() {
  const t = ctx.current();
  if (!t) return config.appUrl.replace(/\/$/, '');
  const ps = await require('../platform/settings').getAll().catch(() => ({}));
  return require('../platform/tenants').siteUrlOf(t, ps.platform_url).replace(/\/$/, '');
}

module.exports = { siteBase };
