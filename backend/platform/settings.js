/** Platform-wide settings (super admin): branding, homepage, Platform Email (SMTP). */
const config = require('../config');
const { master } = require('../config/db');
const { encrypt, decrypt } = require('../utils/helpers');

const DEFS = {
  platform_name: { def: 'ePaper Platform' },
  platform_url: { def: config.appUrl },
  support_email: { def: '' },
  support_phone: { def: '' },
  home_tenant_id: { def: 0, type: 'number' }, // newspaper shown on the platform's own home page (0 = list of newspapers)
  unavailable_message: { def: 'This newspaper is temporarily unavailable. Please check back soon.' },
  reminder_days: { def: '7,3,1' },
  smtp_host: { def: config.smtp.host || '' },
  smtp_port: { def: config.smtp.port || 587, type: 'number' },
  smtp_secure: { def: !!config.smtp.secure, type: 'bool' },
  smtp_user: { def: config.smtp.user || '' },
  smtp_pass: { def: '', type: 'secret' },
  mail_from_name: { def: 'ePaper' },
  mail_from_email: { def: (String(config.smtp.from).match(/<([^>]+)>/) || [])[1] || 'no-reply@example.com' },
};

let memo = null;
let memoAt = 0;

const decode = (d, raw) => {
  if (raw === null || raw === undefined) return d.def;
  if (d.type === 'number') return Number(raw) || 0;
  if (d.type === 'bool') return raw === '1' || raw === 'true';
  if (d.type === 'secret') return raw ? decrypt(raw) : '';
  return raw;
};
const encode = (d, v) => {
  if (d.type === 'bool') return v === true || v === 'true' || v === '1' || v === 1 ? '1' : '0';
  if (d.type === 'number') return String(Number(v) || 0);
  if (d.type === 'secret') return v ? encrypt(String(v)) : '';
  return v === null || v === undefined ? '' : String(v);
};

async function getAll() {
  if (memo && Date.now() - memoAt < 30000) return memo;
  const rows = await master.query('SELECT setting_key, setting_value FROM platform_settings');
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const out = {};
  for (const [k, d] of Object.entries(DEFS)) out[k] = decode(d, map[k]);
  memo = out; memoAt = Date.now();
  return out;
}

/** For the super admin UI: the SMTP password is never sent back. */
async function getPublicForAdmin() {
  const s = { ...(await getAll()) };
  s.smtp_pass_set = !!s.smtp_pass;
  delete s.smtp_pass;
  return s;
}

async function update(values) {
  for (const [k, v] of Object.entries(values)) {
    const d = DEFS[k];
    if (!d) continue;
    if (d.type === 'secret' && (v === undefined || v === null || v === '' || v === '********')) continue; // keep existing
    await master.query('INSERT INTO platform_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [k, encode(d, v)]);
  }
  memo = null;
}

async function ensureDefaults() {
  for (const [k, d] of Object.entries(DEFS)) {
    await master.query('INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?,?)', [k, encode(d, d.def)]);
  }
  memo = null;
}

module.exports = { DEFS, getAll, getPublicForAdmin, update, ensureDefaults };
