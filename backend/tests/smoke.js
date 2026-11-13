/*
 * End-to-end API smoke test. Run against a running server with a seeded DB:
 *   node tests/smoke.js [http://localhost:5000]
 * Logs in as the platform super admin (from .env), creates a throw-away client
 * "smoketest" with its own database, runs every check inside it, then deletes it.
 */
require('../config');
const sharp = require('sharp');
const config = require('../config');

const ROOT = process.argv[2] || `http://localhost:${config.port}`;
const BASE = `${ROOT}/api/v1`;
const SLUG = 'smoketest';
const CLIENT = { email: 'smoke-admin@example.com', password: 'Smoke@12345' };
let pass = 0; let fail = 0;
const results = [];

async function call(method, path, { token, json, form, raw, tenant = SLUG } = {}) {
  const headers = {};
  if (tenant) headers['X-Tenant'] = tenant;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(BASE + path, { method, headers, body });
  if (raw) return r;
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ...data };
}
function check(name, cond, info = '') {
  if (cond) { pass++; results.push(`  ✓ ${name}`); } else { fail++; results.push(`  ✗ ${name} ${info}`); }
}
async function pageImage(n) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="2100"><rect width="100%" height="100%" fill="#f7f3ea"/><text x="80" y="200" font-size="110" font-family="Georgia">SMOKE PAGE ${n}</text></svg>`;
  return new Blob([await sharp(Buffer.from(svg)).jpeg().toBuffer()], { type: 'image/jpeg' });
}

async function platform(method, path, { token, json } = {}) {
  const r = await fetch(`${BASE}/platform${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

(async () => {
  // ---- Platform: super admin creates a fresh test client
  let r = await platform('POST', '/auth/login', { json: { email: config.admin.email, password: config.admin.password } });
  check('Super admin login', r.success && r.data?.token, r.message);
  const PT = r.data?.token;
  const old = (await platform('GET', '/clients', { token: PT })).data?.find((c) => c.slug === SLUG);
  if (old) await platform('POST', `/clients/${old.id}/delete`, { token: PT, json: { confirm: SLUG } });
  const premium = (await platform('GET', '/plans', { token: PT })).data?.sort((a, b) => b.modules.length - a.modules.length)[0];
  r = await platform('POST', '/clients', { token: PT, json: { name: 'Smoke Test Daily', slug: SLUG, owner_email: CLIENT.email, admin_password: CLIENT.password, plan_id: premium?.id } });
  check('Create client (own database)', r.success && r.data?.id, r.message);
  const CID = r.data?.id;
  r = await call('GET', '/settings/public', { tenant: null }); check('No newspaper → 404 NO_TENANT', r.status === 404 && r.code === 'NO_TENANT');
  r = await call('GET', '/settings/public', { tenant: 'does-not-exist' }); check('Unknown newspaper → TENANT_NOT_FOUND', r.code === 'TENANT_NOT_FOUND');

  // ---- Auth (the client's own admin)
  r = await call('POST', '/auth/admin/login', { json: CLIENT });
  check('Admin login', r.success && r.data?.token, r.message);
  const T = r.data?.token;
  r = await call('GET', '/admin/dashboard'); check('Dashboard requires auth (401)', r.status === 401);
  r = await call('GET', '/admin/dashboard', { token: T }); check('Dashboard stats from DB', r.success && typeof r.data.stats.total_editions === 'number');

  // ---- Category
  let f = new FormData(); f.append('name', `SMOKE Category ${Date.now()}`); f.append('status', 'active');
  r = await call('POST', '/categories', { token: T, form: f }); check('Create category', r.success, r.message);
  const catId = r.data?.id;

  // ---- Workflow 1: edition publishing
  f = new FormData(); f.append('title', 'SMOKE Edition'); f.append('category_id', catId); f.append('edition_date', new Date().toISOString().slice(0, 10)); f.append('status', 'draft');
  r = await call('POST', '/editions', { token: T, form: f }); check('Create edition (draft)', r.success, r.message);
  const ed = r.data;
  r = await call('POST', `/editions/${ed.id}/actions/publish`, { token: T }); check('Publishing without pages is rejected', r.status === 400);
  f = new FormData(); for (const i of [1, 2, 3]) f.append('files', await pageImage(i), `p${i}.jpg`);
  r = await call('POST', `/pages/edition/${ed.id}/upload`, { token: T, form: f }); check('Upload 3 pages', r.success && r.data.length === 3, r.message);
  const pages = r.data || [];
  check('Variants generated (large/medium/thumb)', pages.every((p) => p.images.large && p.images.medium && p.images.thumb));
  r = await call('PUT', `/pages/edition/${ed.id}/reorder`, { token: T, json: { order: [pages[2].id, pages[0].id, pages[1].id] } });
  check('Reorder pages', r.success && r.data[0].id === pages[2].id);
  r = await call('POST', `/pages/${pages[0].id}/set-first`, { token: T }); check('Set first page', r.success && r.data[0].id === pages[0].id);
  r = await call('PUT', `/pages/${pages[1].id}`, { token: T, json: { title: 'Sports', description: 'Sports page' } }); check('Edit page details', r.success);
  r = await call('GET', `/pages/edition/${ed.id}/validate`, { token: T }); check('Validate edition', r.success && r.data.valid, JSON.stringify(r.data));
  r = await call('POST', `/editions/${ed.id}/actions/publish`, { token: T }); check('Publish edition', r.success && r.data.status === 'published', r.message);
  r = await call('GET', `/editions/public/${ed.slug}`); check('Published edition visible publicly', r.success && r.data.pages.length === 3);
  r = await call('GET', `/editions/public?category=${catId}`); check('Public list by category', r.success && r.data.length >= 1);
  r = await call('GET', '/editions/public/latest'); check('Latest editions', r.success && r.data.length >= 1);
  r = await call('GET', '/editions/public/dates'); check('Available dates', r.success && r.data.length >= 1);

  // ---- Clipping
  r = await call('POST', '/clippings', { json: { page_id: pages[0].id, x: 0.1, y: 0.05, w: 0.5, h: 0.2 } });
  check('Create clipping', r.success && r.data.code, r.message);
  const code = r.data?.code;
  r = await call('GET', `/clippings/${code}`); check('Open shared clipping', r.success && r.data.edition_slug === ed.slug);
  const dl = await call('GET', `/pages/${pages[0].id}/download`, { raw: true }); check('Page download (allowed)', dl.status === 200 && dl.headers.get('content-type') === 'image/jpeg');

  // ---- Workflow 2: scheduled edition
  f = new FormData(); f.append('title', 'SMOKE Scheduled'); f.append('category_id', catId); f.append('edition_date', new Date().toISOString().slice(0, 10)); f.append('status', 'draft');
  r = await call('POST', '/editions', { token: T, form: f }); const ed2 = r.data;
  f = new FormData(); f.append('files', await pageImage(9), 'p9.jpg');
  await call('POST', `/pages/edition/${ed2.id}/upload`, { token: T, form: f });
  r = await call('POST', '/schedules', { token: T, json: { edition_id: ed2.id, publish_at: new Date(Date.now() + 3600e3).toISOString(), notify_on_publish: false } });
  check('Schedule edition', r.success && r.data.status === 'pending', r.message);
  const sched = r.data;
  r = await call('GET', `/editions/public/${ed2.slug}`); check('Scheduled edition hidden publicly', r.status === 404);
  r = await call('PUT', `/schedules/${sched.id}`, { token: T, json: { publish_at: new Date(Date.now() + 1500).toISOString() } });
  check('Reschedule', r.success, r.message);
  await new Promise((res) => setTimeout(res, 2500));
  r = await call('POST', '/schedules/run-now', { token: T }); check('Scheduler run', r.success);
  r = await call('GET', `/editions/public/${ed2.slug}`); check('Scheduled edition auto-published', r.success);

  // ---- Workflow 4: comments
  const email = `smoke${Date.now()}@example.com`;
  r = await call('POST', '/auth/register', { json: { name: 'Smoke Reader', email, password: 'Reader12345', subscribe: true } });
  check('Reader registration (+subscribe)', r.success && r.data.token, r.message);
  const U = r.data?.token;
  r = await call('POST', '/comments', { token: U, json: { edition_id: ed.id, page_id: pages[0].id, body: 'Great coverage today!' } });
  check('Post comment (pending)', r.success && r.data.status === 'pending', r.message);
  const cid = r.data?.id;
  r = await call('POST', '/comments', { token: U, json: { edition_id: ed.id, body: 'x'.repeat(201) } }); check('200 character limit enforced', r.status === 400);
  r = await call('GET', `/comments/public?page_id=${pages[0].id}`); check('Pending comment not public', r.success && !r.data.comments.some((c) => c.id === cid));
  r = await call('PATCH', `/comments/${cid}/status`, { token: T, json: { status: 'approved' } }); check('Admin approves comment', r.success);
  r = await call('GET', `/comments/public?page_id=${pages[0].id}`); check('Approved comment displayed', r.data.comments.some((c) => c.id === cid));

  // ---- Workflow 6: subscribers
  const subEmail = `sub${Date.now()}@example.com`;
  r = await call('POST', '/subscribers/subscribe', { json: { email: subEmail, name: 'Sub' } }); check('Public subscribe', r.success, r.message);
  r = await call('GET', `/subscribers?q=${subEmail}`, { token: T }); check('Admin search subscriber', r.success && r.data.length === 1);
  const subId = r.data?.[0]?.id;
  const csv = await call('GET', `/subscribers/export?q=${subEmail}`, { token: T, raw: true }); const csvText = await csv.text();
  check('Export CSV', csv.status === 200 && csvText.includes(subEmail));
  r = await call('POST', '/subscribers/status', { token: T, json: { ids: [subId], status: 'unsubscribed' } }); check('Unsubscribe (admin)', r.success);

  // ---- Workflow 5: settings affect public site
  f = new FormData(); f.append('site_name', 'SMOKE Times'); f.append('maintenance_mode', 'false');
  r = await call('PUT', '/settings/website', { token: T, form: f }); check('Save website settings', r.success, r.message);
  f = new FormData(); f.append('primary_color', '#123456');
  r = await call('PUT', '/settings/theme', { token: T, form: f }); check('Save theme', r.success);
  r = await call('GET', '/settings/public'); check('Public settings reflect changes', r.data.site.site_name === 'SMOKE Times' && r.data.theme.primary_color === '#123456');
  f = new FormData(); f.append('site_name', 'Vachana Kranti'); await call('PUT', '/settings/website', { token: T, form: f });
  f = new FormData(); f.append('primary_color', '#c8102e'); await call('PUT', '/settings/theme', { token: T, form: f });
  r = await call('POST', '/settings/social', { token: T, json: { platform: 'linkedin', label: 'LinkedIn', url: 'https://linkedin.com/', status: 'active' } }); check('Add social link', r.success, r.message);
  await call('DELETE', `/settings/social/${r.data?.id}`, { token: T });
  f = new FormData(); f.append('meta_title', 'SMOKE SEO title');
  r = await call('PUT', `/seo/edition/${ed.id}`, { token: T, form: f }); check('Save edition SEO', r.success);
  const wm = await call('POST', '/settings/watermark/preview', { token: T, raw: true, form: (() => { const x = new FormData(); x.append('text', 'Preview'); x.append('type', 'text'); return x; })() });
  check('Watermark preview image', wm.status === 200 && wm.headers.get('content-type') === 'image/jpeg');
  const sm = await fetch(`${ROOT}/n/${SLUG}/sitemap.xml`); check('sitemap.xml', sm.status === 200 && (await sm.text()).includes(ed.slug));
  const rb = await fetch(`${ROOT}/n/${SLUG}/robots.txt`); check('robots.txt', rb.status === 200);
  const mf = await fetch(`${ROOT}/n/${SLUG}/manifest.webmanifest`); check('PWA manifest', mf.status === 200 && (await mf.json()).name);

  // ---- Workflow 7: notifications
  f = new FormData(); f.append('title', 'SMOKE push'); f.append('message', 'Hello'); f.append('send_now', 'true');
  r = await call('POST', '/notifications', { token: T, form: f }); check('Send push notification', r.success, r.message);
  r = await call('GET', '/notifications', { token: T }); check('Notification history', r.success && r.data.length >= 1);

  // ---- CMS
  f = new FormData(); f.append('title', `SMOKE Page ${Date.now()}`); f.append('content', '<p>Hello <script>alert(1)</script>world</p>');
  r = await call('POST', '/cms', { token: T, form: f }); check('Create CMS page (XSS sanitised)', r.success && !r.data.content.includes('<script'), r.message);
  r = await call('GET', `/cms/public/${r.data.slug}`); check('CMS page public', r.success);
  r = await call('GET', '/cms/public/about-us'); check('Seeded About Us page', r.success);

  // ---- Roles & permissions
  r = await call('GET', '/admin/roles', { token: T }); const editor = r.data.find((x) => x.slug === 'editor');
  r = await call('POST', '/admin/users', { token: T, json: { name: 'Smoke Editor', email: `ed${Date.now()}@example.com`, password: 'Editor12345', role_id: editor.id, status: 'active' } });
  check('Create editor user', r.success, r.message);
  r = await call('POST', '/auth/admin/login', { json: { email: r.data.email, password: 'Editor12345' } });
  const E = r.data?.token;
  r = await call('PUT', '/settings/website', { token: E, form: new FormData() }); check('Editor blocked from settings (403)', r.status === 403);
  r = await call('POST', `/editions/${ed.id}/actions/delete`, { token: E }); check('Editor cannot delete editions (403)', r.status === 403);
  r = await call('GET', '/editions', { token: E }); check('Editor can list editions', r.success);
  r = await call('POST', '/auth/admin/login', { json: { email, password: 'Reader12345' } }); check('Reader cannot log into admin', r.status === 403);

  // ---- Edition actions & duplicate
  r = await call('POST', `/editions/${ed.id}/duplicate`, { token: T }); check('Duplicate edition', r.success && r.data.status === 'draft' && r.data.page_count === 3, r.message);
  const dupId = r.data?.id;
  r = await call('POST', '/editions/bulk', { token: T, json: { ids: [ed.id, ed2.id], action: 'unpublish' } }); check('Bulk unpublish', r.success && r.data.success.length === 2);
  r = await call('GET', `/editions/public/${ed.slug}`); check('Unpublished edition hidden', r.status === 404);

  // ---- Audit log
  r = await call('GET', '/admin/audit-logs?q=edition', { token: T }); check('Audit log entries', r.success && r.data.length > 0);

  // ---- Platform: isolation, plan modules, deactivation, login as client
  const basic = (await platform('GET', '/plans', { token: PT })).data?.find((p) => !p.modules.includes('comments'));
  r = await platform('POST', '/clients', { token: PT, json: { name: 'Smoke Two', slug: `${SLUG}2`, owner_email: 'two@example.com', admin_password: 'Smoke@12345', plan_id: basic?.id } });
  check('Create second client', r.success, r.message);
  const CID2 = r.data?.id;
  r = await call('GET', '/auth/me', { token: T, tenant: `${SLUG}2` }); check("Client A's login rejected on client B (401)", r.status === 401);
  r = await call('GET', '/categories/public', { tenant: `${SLUG}2` }); check("Client B can't see client A's data", r.success && !r.data.some((c) => /SMOKE/i.test(c.name)));
  r = await call('GET', '/comments/public?edition_id=1', { tenant: `${SLUG}2` }); check('Module not in plan → 403', r.status === 403);
  r = await call('POST', '/auth/admin/login', { json: { email: 'two@example.com', password: 'Smoke@12345' }, tenant: `${SLUG}2` });
  const T2 = r.data?.token;
  r = await call('GET', '/auth/me', { token: T2, tenant: `${SLUG}2` }); check('Plan modules removed from permissions', r.success && r.data.disabled_modules.includes('comments') && !r.data.permissions.some((p) => p.startsWith('comments.')));
  r = await call('GET', '/subscription', { token: T2, tenant: `${SLUG}2` }); check('Client sees its plan & usage', r.success && r.data.plan === basic?.name && typeof r.data.usage.storage_bytes === 'number');
  r = await platform('PATCH', `/clients/${CID}/status`, { token: PT, json: { status: 'suspended' } }); check('Deactivate client', r.success);
  r = await call('GET', '/settings/public'); check('Deactivated → readers get TENANT_INACTIVE', r.status === 403 && r.code === 'TENANT_INACTIVE');
  r = await call('GET', '/auth/me', { token: T }); check("Deactivated → client's staff locked out", r.status === 403);
  r = await platform('POST', `/clients/${CID}/login-as`, { token: PT }); const IMP = r.data?.token;
  r = await call('GET', '/auth/me', { token: IMP }); check('Super admin "login as client" still works', r.success && r.data.impersonated === true);
  r = await platform('PATCH', `/clients/${CID}/status`, { token: PT, json: { status: 'active' } });
  r = await call('GET', '/settings/public'); check('Re-activate client', r.success);
  r = await platform('POST', `/clients/${CID}/renew`, { token: PT, json: { months: 1 } }); check('Renew plan', r.success && r.data.expires_at);

  // ---- Cleanup: delete both test clients (their databases and files)
  for (const id of [ed.id, ed2.id, dupId]) await call('DELETE', `/editions/${id}`, { token: T });
  await call('DELETE', `/categories/${catId}`, { token: T });
  r = await platform('POST', `/clients/${CID2}/delete`, { token: PT, json: { confirm: `${SLUG}2` } }); check('Delete client', r.success);
  await platform('POST', `/clients/${CID}/delete`, { token: PT, json: { confirm: SLUG } });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(results.join('\n')); console.error(e); process.exit(1); });
