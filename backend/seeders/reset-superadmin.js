/**
 * Reset the super admin login when you can't sign in.
 *
 *   npm run reset-superadmin                          → uses ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from .env
 *   npm run reset-superadmin -- you@mail.com NewPass@123   → uses the email and password you type
 *
 * - If a super admin with that email exists: sets the new password, re-activates it and clears any lock.
 * - If not: and there is exactly ONE super admin, that account gets the new email + password.
 *           Otherwise a new super admin is created.
 * All existing super admin sessions are logged out.
 */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { master } = require('../config/db');
const { ensurePlatformSchema } = require('../platform/schema');

async function main() {
  const [argEmail, argPass] = process.argv.slice(2);
  const email = String(argEmail || config.admin.email || '').trim().toLowerCase();
  const password = String(argPass || config.admin.password || '');
  const name = config.admin.name || 'Super Admin';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${email}" is not a valid email address.`);
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  await ensurePlatformSchema();
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const all = await master.query('SELECT id, email FROM platform_admins ORDER BY id');
  const same = all.find((a) => a.email.toLowerCase() === email);
  const reset = "password_hash=?, status='active', failed_logins=0, locked_until=NULL, token_version=token_version+1";

  if (same) {
    await master.query(`UPDATE platform_admins SET ${reset} WHERE id=?`, [hash, same.id]);
    console.log(`✓ Password reset for super admin ${email}`);
  } else if (all.length === 1) {
    await master.query(`UPDATE platform_admins SET email=?, ${reset} WHERE id=?`, [email, hash, all[0].id]);
    console.log(`✓ Super admin login changed from ${all[0].email} to ${email}`);
  } else {
    await master.query('INSERT INTO platform_admins (name, email, password_hash) VALUES (?,?,?)', [name, email, hash]);
    console.log(`✓ New super admin created: ${email}`);
  }
  if (all.length > 1) console.log(`  Other super admins: ${all.filter((a) => a.email.toLowerCase() !== email).map((a) => a.email).join(', ')}`);
  console.log(`\n  Log in at /superadmin with:\n    Email:    ${email}\n    Password: ${argPass ? '(the password you typed)' : '(ADMIN_PASSWORD from .env)'}\n`);
}

main().then(() => master.pool.end()).catch((e) => { console.error('✗ ' + e.message); master.pool.end(); process.exit(1); });
