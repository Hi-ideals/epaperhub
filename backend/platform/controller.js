/** Super admin API: dashboard, plans, clients (newspapers), platform settings, super admins. */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { master } = require('../config/db');
const { z, email, password, str, optStr } = require('../validators/schemas');
const { ApiError, ok, created, asyncHandler } = require('../utils/http');
const { clientIp } = require('../utils/helpers');
const tenants = require('./tenants');
const platformSettings = require('./settings');
const { FEATURES, KEYS } = require('./features');
const pauth = require('./auth');
const { sendMail, verify: verifySmtp } = require('../services/mail');

const RESERVED = ['admin', 'api', 'superadmin', 'platform', 'n', 'uploads', 'assets', 'www', 'static', 'login', 'app', 'mail'];

const parse = (schema, body) => {
  const r = schema.safeParse(body || {});
  if (!r.success) {
    const errors = {};
    for (const i of r.error.issues) errors[i.path.join('.')] ??= i.message;
    throw ApiError.badRequest('Please fix the highlighted fields', errors);
  }
  return r.data;
};

async function log(req, action, tenantId = null, details = null) {
  await master.query('INSERT INTO platform_activity (admin_id, tenant_id, action, details, ip_address) VALUES (?,?,?,?,?)',
    [req.platformAdmin?.id || null, tenantId, action, details ? JSON.stringify(details) : null, clientIp(req)]).catch(() => {});
}

// Empty / null = "use the plan's value" (must not become 0, which means unlimited)
const num = (max = 10000000) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(max).nullable()).optional().transform((v) => (v === undefined ? null : v));
const modules = z.array(z.enum(KEYS)).optional().nullable();
const dateOpt = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'), z.literal(''), z.null()]).optional().transform((v) => v || null);
const cleanDomain = (v) => (v ? String(v).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, (m) => m) : null);

/* ------------------------------ Auth ------------------------------ */
const login = asyncHandler(async (req, res) => {
  const b = parse(z.object({ email, password: z.string().min(1, 'Password is required').max(128) }), req.body);
  const r = await pauth.login(b.email, b.password);
  await master.query('INSERT INTO platform_activity (admin_id, action, ip_address) VALUES (?,?,?)', [r.admin.id, 'login', clientIp(req)]);
  ok(res, r, 'Welcome back');
});
const me = asyncHandler(async (req, res) => ok(res, pauth.publicAdmin(req.platformAdmin)));
const updateMe = asyncHandler(async (req, res) => {
  const b = parse(z.object({ name: str(120, 2), email, current_password: z.string().max(128).optional().default(''), new_password: z.union([password, z.literal('')]).optional() }), req.body);
  const a = req.platformAdmin;
  const vals = { name: b.name, email: b.email };
  if (b.new_password || b.email !== a.email) {
    if (!(await bcrypt.compare(b.current_password || '', a.password_hash))) throw ApiError.badRequest('Current password is incorrect', { current_password: 'Current password is incorrect' });
  }
  if (b.email !== a.email && (await master.one('SELECT id FROM platform_admins WHERE email=? AND id<>?', [b.email, a.id]))) throw ApiError.conflict('That email is already used');
  if (b.new_password) { vals.password_hash = await bcrypt.hash(b.new_password, config.bcryptRounds); vals.token_version = a.token_version + 1; }
  await master.query('UPDATE platform_admins SET ? WHERE id=?', [vals, a.id]);
  const fresh = await master.one('SELECT * FROM platform_admins WHERE id=?', [a.id]);
  await log(req, 'profile.updated');
  ok(res, { admin: pauth.publicAdmin(fresh), token: b.new_password ? pauth.sign(fresh) : undefined }, 'Profile saved');
});

/* ------------------------------ Dashboard ------------------------------ */
const dashboard = asyncHandler(async (req, res) => {
  const list = await tenants.all();
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = tenants.todayISO();
  const activity = await master.query(`SELECT a.*, pa.name AS admin_name, t.name AS tenant_name FROM platform_activity a
    LEFT JOIN platform_admins pa ON pa.id=a.admin_id LEFT JOIN tenants t ON t.id=a.tenant_id ORDER BY a.id DESC LIMIT 12`);
  ok(res, {
    clients: {
      total: list.length,
      active: list.filter((t) => t.is_active).length,
      suspended: list.filter((t) => t.status !== 'active').length,
      expired: list.filter((t) => t.status === 'active' && t.is_expired).length,
    },
    storage_bytes: list.reduce((s, t) => s + Number(t.storage_used_bytes || 0), 0),
    yearly_value: list.filter((t) => t.is_active && t.plan_price).reduce((s, t) => s + (Number(t.plan_price) * 12) / (t.plan_duration_months || 12), 0),
    expiring: list.filter((t) => t.expires_at && t.expires_at >= today && t.expires_at <= soon).sort((a, b) => a.expires_at.localeCompare(b.expires_at))
      .map((t) => ({ id: t.id, name: t.name, expires_at: t.expires_at, plan_name: t.plan_name })),
    plans: await master.query('SELECT p.id, p.name, (SELECT COUNT(*) FROM tenants t WHERE t.plan_id=p.id) clients FROM plans p ORDER BY p.sort_order, p.id'),
    activity,
  });
});

/* ------------------------------ Plans ------------------------------ */
const planSchema = z.object({
  name: str(120, 2), description: optStr(500),
  price: z.coerce.number().min(0).max(100000000).default(0), currency: str(8).default('INR'),
  duration_months: z.coerce.number().int().min(1).max(120).default(12),
  storage_mb: z.coerce.number().int().min(50, 'At least 50 MB').max(10000000),
  max_admin_users: z.coerce.number().int().min(0).max(10000),
  max_editions_per_month: z.coerce.number().int().min(0).max(100000),
  modules: z.array(z.enum(KEYS)).default([]),
  is_active: z.coerce.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});
const planOut = (p) => ({ ...p, modules: (() => { try { return JSON.parse(p.modules || '[]'); } catch { return []; } })(), is_active: !!p.is_active, price: Number(p.price) });
const plansList = asyncHandler(async (req, res) => {
  const rows = await master.query('SELECT p.*, (SELECT COUNT(*) FROM tenants t WHERE t.plan_id=p.id) AS clients FROM plans p ORDER BY p.sort_order, p.id');
  ok(res, rows.map(planOut), 'OK', 200, { features: FEATURES });
});
const planSave = asyncHandler(async (req, res) => {
  const b = parse(planSchema, req.body);
  const vals = { ...b, modules: JSON.stringify(b.modules), is_active: b.is_active ? 1 : 0 };
  let id = Number(req.params.id) || 0;
  if (id) {
    if (!(await master.one('SELECT id FROM plans WHERE id=?', [id]))) throw ApiError.notFound('Plan not found');
    await master.query('UPDATE plans SET ? WHERE id=?', [vals, id]);
  } else id = (await master.query('INSERT INTO plans SET ?', [vals])).insertId;
  tenants.forget();
  await log(req, req.params.id ? 'plan.updated' : 'plan.created', null, { id, name: b.name });
  (id && req.params.id ? ok : created)(res, planOut(await master.one('SELECT * FROM plans WHERE id=?', [id])), 'Plan saved');
});
const planDelete = asyncHandler(async (req, res) => {
  const p = await master.one('SELECT p.*, (SELECT COUNT(*) FROM tenants t WHERE t.plan_id=p.id) AS clients FROM plans p WHERE p.id=?', [req.params.id]);
  if (!p) throw ApiError.notFound('Plan not found');
  if (p.clients) throw ApiError.conflict(`${p.clients} client(s) use this plan. Move them to another plan first, or mark the plan inactive.`);
  await master.query('DELETE FROM plans WHERE id=?', [p.id]);
  await log(req, 'plan.deleted', null, { name: p.name });
  ok(res, null, 'Plan deleted');
});

/* ------------------------------ Clients ------------------------------ */
const clientOut = async (t, platformUrl) => ({
  id: t.id, name: t.name, slug: t.slug, domain: t.domain, owner_name: t.owner_name, owner_email: t.owner_email, owner_phone: t.owner_phone,
  plan_id: t.plan_id, plan_name: t.plan_name, status: t.status, starts_at: t.starts_at, expires_at: t.expires_at, is_active: t.is_active, is_expired: t.is_expired,
  storage_mb: t.storage_mb, max_admin_users: t.max_admin_users, max_editions_per_month: t.max_editions_per_month,
  modules: (() => { try { return JSON.parse(t.modules || 'null'); } catch { return null; } })(),
  limits: t.limits, features: t.features, notes: t.notes, storage_used_bytes: Number(t.storage_used_bytes || 0),
  site_url: tenants.siteUrlOf(t, platformUrl), path_url: `${(platformUrl || config.appUrl).replace(/\/$/, '')}/n/${t.slug}`,
  created_at: t.created_at,
});

const clientSchema = (isNew) => z.object({
  name: str(150, 2),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Use 3–40 lowercase letters, numbers and dashes').refine((s) => !RESERVED.includes(s), 'This address is reserved'),
  domain: z.string().trim().max(191).optional().nullable().transform(cleanDomain)
    .refine((d) => !d || /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?$/.test(d), 'Enter a domain like epaper.example.com'),
  owner_name: optStr(120), owner_email: email, owner_phone: optStr(30),
  admin_password: isNew ? password : z.string().optional(),
  plan_id: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional().transform((v) => (v ? Number(v) : null)),
  status: z.enum(['active', 'suspended']).default('active'),
  starts_at: dateOpt, expires_at: dateOpt,
  storage_mb: num(), max_admin_users: num(), max_editions_per_month: num(),
  modules, notes: optStr(1000),
  send_welcome: z.coerce.boolean().optional(),
});

const clientsList = asyncHandler(async (req, res) => {
  const s = await platformSettings.getAll();
  const list = await tenants.all();
  const q = String(req.query.q || '').toLowerCase();
  const st = req.query.status;
  const rows = list.filter((t) => (!q || `${t.name} ${t.slug} ${t.domain || ''} ${t.owner_email}`.toLowerCase().includes(q))
    && (!st || (st === 'active' && t.is_active) || (st === 'suspended' && t.status !== 'active') || (st === 'expired' && t.status === 'active' && t.is_expired)));
  ok(res, await Promise.all(rows.map((t) => clientOut(t, s.platform_url))));
});

const clientGet = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  const s = await platformSettings.getAll();
  await tenants.storageUsed(t, { fresh: true });
  const stats = await tenants.within(t, async () => {
    const { one } = require('../config/db');
    const e = await one("SELECT COUNT(*) total, SUM(status='published') published, MAX(published_at) last_published FROM editions WHERE deleted_at IS NULL");
    const u = await one('SELECT SUM(role_id IS NOT NULL) staff, SUM(role_id IS NULL) readers FROM users WHERE deleted_at IS NULL');
    const admins = await require('../config/db').query("SELECT u.id, u.name, u.email, u.status, u.last_login_at, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL ORDER BY r.id, u.id LIMIT 30");
    return { editions: Number(e.total || 0), published: Number(e.published || 0), last_published: e.last_published, staff: Number(u.staff || 0), readers: Number(u.readers || 0), admins };
  }).catch((err) => ({ error: err.message }));
  // Show the passwords the super admin set (until the client changes them)
  const creds = await require('./credentials').list(t.id);
  for (const a of stats.admins || []) {
    const c = creds[String(a.email).toLowerCase()];
    a.password = c ? c.password : null;
    a.password_set_at = c ? c.set_at : null;
  }
  const activity = await master.query('SELECT a.*, pa.name AS admin_name FROM platform_activity a LEFT JOIN platform_admins pa ON pa.id=a.admin_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT 20', [t.id]);
  ok(res, { ...(await clientOut(t, s.platform_url)), stats, activity });
});

async function assertUnique(b, id = 0) {
  if (await master.one('SELECT id FROM tenants WHERE slug=? AND id<>?', [b.slug, id])) throw ApiError.badRequest('This address is already used', { slug: 'This address is already used by another client' });
  if (b.domain && (await master.one('SELECT id FROM tenants WHERE domain=? AND id<>?', [b.domain, id]))) throw ApiError.badRequest('This domain is already used', { domain: 'This domain is already used by another client' });
  if (b.plan_id && !(await master.one('SELECT id FROM plans WHERE id=?', [b.plan_id]))) throw ApiError.badRequest('Plan not found', { plan_id: 'Plan not found' });
}

const clientCreate = asyncHandler(async (req, res) => {
  const b = parse(clientSchema(true), req.body);
  await assertUnique(b);
  if (!b.starts_at) b.starts_at = tenants.todayISO();
  if (!b.expires_at && b.plan_id) {
    const p = await master.one('SELECT duration_months FROM plans WHERE id=?', [b.plan_id]);
    const d = new Date(`${b.starts_at}T12:00:00`); d.setMonth(d.getMonth() + (p?.duration_months || 12)); d.setDate(d.getDate() - 1);
    b.expires_at = d.toISOString().slice(0, 10);
  }
  const t = await tenants.provision(b);
  await require('./credentials').remember(t.id, b.owner_email, b.admin_password);
  await log(req, 'client.created', t.id, { name: t.name, slug: t.slug, plan_id: t.plan_id });
  const s = await platformSettings.getAll();
  const out = await clientOut(t, s.platform_url);
  if (b.send_welcome) {
    sendMail({
      to: b.owner_email, fromName: s.platform_name,
      subject: `Your ${t.name} ePaper is ready`,
      html: `<p>Hello ${b.owner_name || ''},</p><p>Your ePaper <b>${t.name}</b> has been created on ${s.platform_name}.</p>
        <p><b>Admin panel:</b> <a href="${out.site_url}/admin">${out.site_url}/admin</a><br><b>Email:</b> ${b.owner_email}<br><b>Password:</b> ${b.admin_password}</p>
        <p>Please change your password after your first login.${t.expires_at ? `<br>Your plan is valid until <b>${t.expires_at}</b>.` : ''}</p>`,
    }).catch((e) => console.warn('[platform] welcome email failed:', e.message));
  }
  created(res, out, 'Client created. Their newspaper and admin account are ready.');
});

const clientUpdate = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  const b = parse(clientSchema(false), req.body);
  await assertUnique(b, t.id);
  await master.query(`UPDATE tenants SET name=?, slug=?, domain=?, owner_name=?, owner_email=?, owner_phone=?, plan_id=?, status=?, starts_at=?, expires_at=?,
    storage_mb=?, max_admin_users=?, max_editions_per_month=?, modules=?, notes=?, last_reminder=IF(expires_at<=>?, last_reminder, NULL) WHERE id=?`,
  [b.name, b.slug, b.domain || null, b.owner_name, b.owner_email, b.owner_phone, b.plan_id, b.status, b.starts_at, b.expires_at,
    b.storage_mb, b.max_admin_users, b.max_editions_per_month, b.modules ? JSON.stringify(b.modules) : null, b.notes, b.expires_at, t.id]);
  tenants.forget();
  await log(req, 'client.updated', t.id, { name: b.name, plan_id: b.plan_id, status: b.status, expires_at: b.expires_at });
  const s = await platformSettings.getAll();
  if (b.slug !== t.slug || (b.domain || null) !== (t.domain || null)) await tenants.syncSiteUrl(await tenants.byId(t.id), s.platform_url);
  ok(res, await clientOut(await tenants.byId(t.id), s.platform_url), 'Client saved');
});

const clientStatus = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  const status = req.body?.status === 'active' ? 'active' : 'suspended';
  await master.query('UPDATE tenants SET status=? WHERE id=?', [status, t.id]);
  tenants.forget();
  await log(req, status === 'active' ? 'client.activated' : 'client.deactivated', t.id);
  ok(res, { status }, status === 'active' ? `${t.name} is active again` : `${t.name} has been deactivated`);
});

const clientRenew = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  const blankToUndef = (v) => (v === '' || v === null || v === undefined ? undefined : v);
  const b = parse(z.object({
    plan_id: z.preprocess(blankToUndef, z.coerce.number().int().positive().optional()),
    months: z.preprocess(blankToUndef, z.coerce.number().int().min(1, 'At least 1 month').max(120).optional()),
    expires_at: z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional()),
    use_plan_limits: z.coerce.boolean().optional(),
  }), req.body);
  const planId = b.plan_id || t.plan_id;
  const plan = planId ? await master.one('SELECT * FROM plans WHERE id=?', [planId]) : null;
  if (b.plan_id && !plan) throw ApiError.badRequest('Plan not found', { plan_id: 'Plan not found' });
  let expires = b.expires_at;
  let months = null;
  if (!expires) {
    months = b.months || plan?.duration_months || 12;
    expires = renewedExpiry(t.expires_at, months);
  }
  const reset = b.use_plan_limits ? ', storage_mb=NULL, max_admin_users=NULL, max_editions_per_month=NULL, modules=NULL' : '';
  await master.query(`UPDATE tenants SET plan_id=?, expires_at=?, status='active', last_reminder=NULL${reset} WHERE id=?`, [planId, expires, t.id]);
  tenants.forget();
  await log(req, 'client.renewed', t.id, { plan_id: planId, months, expires_at: expires, use_plan_limits: !!b.use_plan_limits });
  ok(res, { expires_at: expires }, `${plan ? `${plan.name} plan, ` : ''}valid until ${expires}`);
});

/** Extend from the current expiry if it's still running, otherwise from today. */
function renewedExpiry(current, months) {
  const today = tenants.todayISO();
  const running = current && current >= today;
  const d = new Date(`${running ? current : today}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  if (!running) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const clientResetPassword = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  const b = parse(z.object({ email: email.optional(), password }), req.body);
  const target = b.email || t.owner_email;
  const done = await tenants.within(t, async () => {
    const { one, query } = require('../config/db');
    const u = await one('SELECT id FROM users WHERE email=? AND deleted_at IS NULL AND role_id IS NOT NULL', [target]);
    if (!u) return false;
    await query("UPDATE users SET password_hash=?, token_version=token_version+1, failed_logins=0, locked_until=NULL, status='active' WHERE id=?", [await bcrypt.hash(b.password, config.bcryptRounds), u.id]);
    return true;
  });
  if (!done) throw ApiError.notFound(`No admin account with ${target} in this newspaper`);
  await require('./credentials').remember(t.id, target, b.password);
  await log(req, 'client.password_reset', t.id, { email: target });
  ok(res, null, `Password changed for ${target}`);
});

/** "Login as client": a short-lived token for the client's main admin account. */
const clientImpersonate = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  const s = await platformSettings.getAll();
  const token = await tenants.within(t, async () => {
    const { one } = require('../config/db');
    const { signToken } = require('../middleware/auth');
    const u = await one(`SELECT u.id, u.token_version FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL AND u.status='active'
      ORDER BY (u.email=?) DESC, (r.slug='super-admin') DESC, u.id LIMIT 1`, [t.owner_email]);
    if (!u) throw ApiError.notFound('This newspaper has no active admin account');
    return signToken(u, { imp: req.platformAdmin.id });
  });
  await log(req, 'client.login_as', t.id);
  const out = await clientOut(t, s.platform_url);
  // Path address works from the platform domain without any DNS setup
  ok(res, { token, slug: t.slug, url: `${out.path_url}/admin#imp=${token}`, domain_url: t.domain ? `${out.site_url}/admin#imp=${token}` : null });
});

const clientDelete = asyncHandler(async (req, res) => {
  const t = await tenants.byId(req.params.id);
  if (!t) throw ApiError.notFound('Client not found');
  if (String(req.body?.confirm || '').trim().toLowerCase() !== t.slug) throw ApiError.badRequest(`Type "${t.slug}" to confirm`);
  await tenants.destroy(t);
  await log(req, 'client.deleted', null, { name: t.name, slug: t.slug });
  ok(res, null, `${t.name} and all its data were deleted`);
});

/* ------------------------------ Platform settings ------------------------------ */
const settingsGet = asyncHandler(async (req, res) => {
  const list = await tenants.all();
  ok(res, await platformSettings.getPublicForAdmin(), 'OK', 200, { clients: list.map((t) => ({ id: t.id, name: t.name })) });
});
const settingsSave = asyncHandler(async (req, res) => {
  const b = parse(z.object({
    platform_name: str(120, 2), platform_url: z.string().trim().max(200).regex(/^https?:\/\/[^\s]+$/, 'Start with http:// or https://').transform((v) => v.replace(/\/$/, '')),
    support_email: z.union([email, z.literal('')]).optional(), support_phone: optStr(40),
    home_tenant_id: z.coerce.number().int().min(0).default(0),
    unavailable_message: str(500).optional(), reminder_days: z.string().trim().max(40).regex(/^[\d,\s]*$/, 'Numbers separated by commas').optional(),
    smtp_host: optStr(191), smtp_port: z.coerce.number().int().min(1).max(65535).default(587), smtp_secure: z.coerce.boolean().default(false),
    smtp_user: optStr(191), smtp_pass: z.string().max(255).optional().nullable(),
    mail_from_name: str(120).optional(), mail_from_email: z.union([email, z.literal('')]).optional(),
  }), req.body);
  const before = (await platformSettings.getAll()).platform_url;
  await platformSettings.update(b);
  tenants.forget();
  // New platform address: update the stored address of every newspaper that has no own domain
  if (b.platform_url && b.platform_url !== before) for (const t of await tenants.all()) if (!t.domain) await tenants.syncSiteUrl(t, b.platform_url);
  await log(req, 'settings.updated', null, { ...b, smtp_pass: b.smtp_pass ? '(changed)' : undefined });
  ok(res, await platformSettings.getPublicForAdmin(), 'Platform settings saved');
});
const testEmail = asyncHandler(async (req, res) => {
  const b = parse(z.object({ to: email }), req.body);
  const s = await platformSettings.getAll();
  if (!s.smtp_host) throw ApiError.badRequest('Enter and save the SMTP server first');
  try {
    await verifySmtp();
    await sendMail({ to: b.to, fromName: s.platform_name, subject: `${s.platform_name}: test email`, html: `<p>This is a test email from <b>${s.platform_name}</b>. Your Platform Email (SMTP) settings work.</p>` });
  } catch (e) { throw ApiError.badRequest(`Could not send: ${require('../services/mail').friendlyError(e)}`); }
  ok(res, null, `Test email sent to ${b.to}`);
});

/* ------------------------------ Super admins ------------------------------ */
const adminsList = asyncHandler(async (req, res) => ok(res, await master.query('SELECT id, name, email, status, last_login_at, created_at FROM platform_admins ORDER BY id')));
const adminSave = asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const b = parse(z.object({ name: str(120, 2), email, status: z.enum(['active', 'disabled']).default('active'), password: id ? z.union([password, z.literal('')]).optional() : password }), req.body);
  if (await master.one('SELECT id FROM platform_admins WHERE email=? AND id<>?', [b.email, id])) throw ApiError.badRequest('Email already used', { email: 'Email already used' });
  if (id === req.platformAdmin.id && b.status !== 'active') throw ApiError.badRequest('You cannot disable your own account');
  const vals = { name: b.name, email: b.email, status: b.status };
  if (b.password) vals.password_hash = await bcrypt.hash(b.password, config.bcryptRounds);
  if (id) {
    const cur = await master.one('SELECT * FROM platform_admins WHERE id=?', [id]);
    if (!cur) throw ApiError.notFound('Not found');
    if (b.password || b.status !== cur.status) vals.token_version = cur.token_version + 1;
    await master.query('UPDATE platform_admins SET ? WHERE id=?', [vals, id]);
  } else await master.query('INSERT INTO platform_admins SET ?', [vals]);
  await log(req, id ? 'superadmin.updated' : 'superadmin.created', null, { email: b.email });
  ok(res, null, 'Saved');
});
const adminDelete = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.platformAdmin.id) throw ApiError.badRequest('You cannot delete your own account');
  const { n } = await master.one("SELECT COUNT(*) n FROM platform_admins WHERE status='active' AND id<>?", [id]);
  if (!n) throw ApiError.badRequest('At least one active super admin is required');
  await master.query('DELETE FROM platform_admins WHERE id=?', [id]);
  await log(req, 'superadmin.deleted', null, { id });
  ok(res, null, 'Deleted');
});

const activity = asyncHandler(async (req, res) => ok(res, await master.query(`SELECT a.*, pa.name AS admin_name, t.name AS tenant_name FROM platform_activity a
  LEFT JOIN platform_admins pa ON pa.id=a.admin_id LEFT JOIN tenants t ON t.id=a.tenant_id ORDER BY a.id DESC LIMIT 200`)));

/** Public: list of active newspapers for the platform home page. */
const directory = asyncHandler(async (req, res) => {
  const s = await platformSettings.getAll();
  const list = (await tenants.all()).filter((t) => t.is_active);
  ok(res, { platform_name: s.platform_name, support_email: s.support_email, support_phone: s.support_phone,
    newspapers: list.map((t) => ({ name: t.name, slug: t.slug, url: t.domain ? tenants.siteUrlOf(t) : `/n/${t.slug}` })) });
});

module.exports = {
  login, me, updateMe, dashboard, plansList, planSave, planDelete,
  clientsList, clientGet, clientCreate, clientUpdate, clientStatus, clientRenew, clientResetPassword, clientImpersonate, clientDelete,
  settingsGet, settingsSave, testEmail, adminsList, adminSave, adminDelete, activity, directory,
};
