/**
 * Passwords that the SUPER ADMIN set for a client's admin accounts (on "Add client" or
 * "Reset a password"), kept encrypted so the super admin can see/copy them again.
 * Real logins still use the one-way bcrypt hash. When the client changes the password
 * themselves, the stored copy is deleted, so an outdated password is never shown.
 */
const { master } = require('../config/db');
const { encrypt, decrypt } = require('../utils/helpers');
const ctx = require('./context');

async function ensure() {
  await master.query(`CREATE TABLE IF NOT EXISTS client_credentials (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT UNSIGNED NOT NULL,
    email VARCHAR(191) NOT NULL,
    password_enc TEXT NOT NULL,
    set_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cc (tenant_id, email)
  ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4`);
}

async function remember(tenantId, email, password) {
  await master.query('INSERT INTO client_credentials (tenant_id, email, password_enc, set_at) VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE password_enc=VALUES(password_enc), set_at=NOW()',
    [tenantId, String(email).toLowerCase(), encrypt(password)]);
}

/** Call whenever a password changes inside a newspaper (not by the super admin). */
async function forget(email, tenantId = ctx.current()?.id) {
  if (!tenantId || !email) return;
  await master.query('DELETE FROM client_credentials WHERE tenant_id=? AND email=?', [tenantId, String(email).toLowerCase()]).catch(() => {});
}

/** { email: { password, set_at } } for a client. */
async function list(tenantId) {
  const rows = await master.query('SELECT email, password_enc, set_at FROM client_credentials WHERE tenant_id=?', [tenantId]);
  const out = {};
  for (const r of rows) { try { out[r.email] = { password: decrypt(r.password_enc), set_at: r.set_at }; } catch { /* key changed */ } }
  return out;
}

const removeTenant = (tenantId) => master.query('DELETE FROM client_credentials WHERE tenant_id=?', [tenantId]).catch(() => {});

module.exports = { ensure, remember, forget, list, removeTenant };
