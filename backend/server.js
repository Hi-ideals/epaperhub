const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { master } = require('./config/db');
const { resolveTenant, requireTenant } = require('./middleware/tenant');
const tenants = require('./platform/tenants');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');
const { authenticate } = require('./middleware/auth');
const settings = require('./services/settings');
const settingsCtrl = require('./controllers/settingsController');
const seoCtrl = require('./controllers/seoController');
const { renderIndex } = require('./services/meta');
const { startScheduler } = require('./jobs/scheduler');
const push = require('./services/push');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://www.google.com', 'https://www.gstatic.com', 'https://accounts.google.com', 'https://apis.google.com'],
      'frame-src': ["'self'", 'https://www.google.com', 'https://accounts.google.com', 'https://www.youtube.com', 'https://maps.google.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'", 'https://www.google.com', 'https://accounts.google.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'worker-src': ["'self'", 'blob:'],
    },
  },
}));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')),
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
if (!config.isProd) app.use(morgan('dev'));

// Which newspaper is this request for? (/n/<slug>, X-Tenant header, or the domain)
app.use(resolveTenant);

// Global API rate limit
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: true, legacyHeaders: false }));

// Super admin (platform) API — platform database only
app.use('/api/v1/platform', require('./platform/routes'));
// Health check for uptime monitors / load balancers: works without a newspaper and checks the database
app.get(['/api/health', '/api/v1/health'], async (req, res) => {
  try {
    await require('./config/db').master.query('SELECT 1');
    res.json({ success: true, message: 'ok', database: 'up', tenant: req.tenant?.slug || null, uptime_s: Math.round(process.uptime()), time: new Date() });
  } catch (e) {
    res.status(503).json({ success: false, message: 'database unavailable', database: 'down', time: new Date() });
  }
});

// Everything else under /api/v1 belongs to one newspaper
app.use('/api/v1', requireTenant);

// Maintenance mode: public reading APIs return 503 unless an admin is logged in
app.use(['/api/v1/editions/public', '/api/v1/clippings', '/api/v1/comments/public'], authenticate(false), async (req, res, next) => {
  try {
    const s = await settings.getGroup('website_settings');
    if (s.maintenance_mode && !req.user?.is_admin) return res.status(503).json({ success: false, maintenance: true, message: s.maintenance_message });
    next();
  } catch (e) { next(e); }
});

// Uploaded public files (originals are stored outside this folder)
// Page images: smaller sizes made on the fly from the one stored file ("...-large.webp?w=1400")
app.use('/uploads', require('./services/pageSizes'));
app.use('/uploads', express.static(config.paths.uploadsRoot, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

// API
app.use('/api/v1', routes);
app.use('/api', notFound);

// PWA + SEO endpoints served from the site root (per newspaper)
const forTenant = (h, fallback) => (req, res, next) => (req.tenant ? h(req, res, next) : fallback ? fallback(req, res) : res.status(404).end());
app.get('/manifest.webmanifest', forTenant(settingsCtrl.manifest));
app.get('/pwa-icon-192.png', forTenant(settingsCtrl.pwaIcon(192)));
app.get('/pwa-icon-512.png', forTenant(settingsCtrl.pwaIcon(512)));
app.get('/robots.txt', forTenant(seoCtrl.robots, (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /superadmin\n')));
app.get('/sitemap.xml', forTenant(seoCtrl.sitemap));

// Production: serve the React build with server-side SEO meta
const dist = config.paths.frontendDist;
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (/sw\.js$|index\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^\/(?!api\/|uploads\/).*/, async (req, res, next) => {
    try {
      // Platform pages (super admin, newspaper list) and closed newspapers get the plain app shell
      const html = req.tenant && req.tenant.is_active && !req.path.startsWith('/superadmin')
        ? await renderIndex(req.path).catch(() => null) || fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
        : fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
      if (!html) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    } catch (e) { next(e); }
  });
  console.log(`✓ Serving frontend build from ${dist}`);
}

app.use(notFound);
app.use(errorHandler);

async function start() {
  try {
    await master.query('SELECT 1');
  } catch (e) {
    console.error(`✗ Cannot connect to MySQL at ${config.db.host}:${config.db.port} (${e.message}). Check backend/.env`);
    process.exit(1);
  }
  await require('./platform/schema').ensurePlatformSchema();
  await require('./platform/settings').ensureDefaults();
  if (!(await master.one('SELECT id FROM platform_admins LIMIT 1'))) console.warn('! No super admin yet. Run: npm run setup');
  // Bring every newspaper's database up to date
  for (const t of await tenants.all()) {
    if (!t.db_name) continue;
    try {
      await tenants.upgrade(t);
      await tenants.within(t, () => push.ensureVapid()).catch(() => {});
    } catch (e) { console.error(`✗ ${t.name} (${t.db_name}): ${e.message}`); }
  }
  for (const d of [config.paths.uploadsRoot, config.paths.originalsRoot, config.paths.backupsRoot, config.paths.tmp]) fs.mkdirSync(d, { recursive: true });
  app.listen(config.port, process.env.HOST || '0.0.0.0', () => console.log(`✓ ePaper API running on ${config.apiUrl} (port ${config.port}, ${config.env})`));
  startScheduler();
}

if (require.main === module) start();
module.exports = app;
