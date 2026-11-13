/** Super admin (platform) authentication — separate accounts and tokens from newspaper staff. */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { master } = require('../config/db');
const { ApiError } = require('../utils/http');

const sign = (a) => jwt.sign({ pid: a.id, tv: a.token_version || 0, scope: 'platform' }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
const publicAdmin = (a) => ({ id: a.id, name: a.name, email: a.email, last_login_at: a.last_login_at });

async function login(email, password) {
  const a = await master.one('SELECT * FROM platform_admins WHERE email=?', [String(email).toLowerCase()]);
  const fail = () => ApiError.unauthorized('Invalid email or password');
  if (!a) { await bcrypt.compare(password, '$2a$12$0000000000000000000000000000000000000000000000000000'); throw fail(); }
  if (a.locked_until && new Date(a.locked_until) > new Date()) {
    throw new ApiError(429, `Too many failed attempts. Try again in ${Math.ceil((new Date(a.locked_until) - Date.now()) / 60000)} minute(s).`);
  }
  if (!(await bcrypt.compare(password, a.password_hash))) {
    const n = (a.failed_logins || 0) + 1;
    const lock = n >= config.maxLoginAttempts ? new Date(Date.now() + config.lockMinutes * 60000) : null;
    await master.query('UPDATE platform_admins SET failed_logins=?, locked_until=? WHERE id=?', [lock ? 0 : n, lock, a.id]);
    throw fail();
  }
  if (a.status !== 'active') throw ApiError.forbidden('This super admin account is disabled.');
  await master.query('UPDATE platform_admins SET failed_logins=0, locked_until=NULL, last_login_at=NOW() WHERE id=?', [a.id]);
  return { token: sign(a), admin: publicAdmin(a) };
}

/** Middleware: requires a valid super admin token. */
async function requirePlatformAdmin(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw ApiError.unauthorized();
    let p;
    try { p = jwt.verify(h.slice(7), config.jwt.secret); } catch { throw ApiError.unauthorized('Session expired. Please log in again.'); }
    if (p.scope !== 'platform' || !p.pid) throw ApiError.unauthorized();
    const a = await master.one('SELECT * FROM platform_admins WHERE id=?', [p.pid]);
    if (!a || a.status !== 'active' || a.token_version !== p.tv) throw ApiError.unauthorized('Session is no longer valid. Please log in again.');
    req.platformAdmin = a;
    next();
  } catch (e) { next(e); }
}

module.exports = { login, sign, publicAdmin, requirePlatformAdmin };
