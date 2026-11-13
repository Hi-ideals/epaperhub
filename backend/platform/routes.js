const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('./controller');
const { requirePlatformAdmin: A } = require('./auth');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { success: false, message: 'Too many login attempts. Try again later.' } });

router.get('/directory', c.directory);
router.post('/auth/login', loginLimiter, c.login);
router.get('/auth/me', A, c.me);
router.put('/auth/me', A, c.updateMe);

router.get('/dashboard', A, c.dashboard);
router.get('/activity', A, c.activity);

router.get('/plans', A, c.plansList);
router.post('/plans', A, c.planSave);
router.put('/plans/:id', A, c.planSave);
router.delete('/plans/:id', A, c.planDelete);

router.get('/clients', A, c.clientsList);
router.post('/clients', A, c.clientCreate);
router.get('/clients/:id', A, c.clientGet);
router.put('/clients/:id', A, c.clientUpdate);
router.patch('/clients/:id/status', A, c.clientStatus);
router.post('/clients/:id/renew', A, c.clientRenew);
router.post('/clients/:id/reset-password', A, c.clientResetPassword);
router.post('/clients/:id/login-as', A, c.clientImpersonate);
router.post('/clients/:id/delete', A, c.clientDelete);

router.get('/settings', A, c.settingsGet);
router.put('/settings', A, c.settingsSave);
router.post('/settings/test-email', A, c.testEmail);

router.get('/admins', A, c.adminsList);
router.post('/admins', A, c.adminSave);
router.put('/admins/:id', A, c.adminSave);
router.delete('/admins/:id', A, c.adminDelete);

module.exports = router;
