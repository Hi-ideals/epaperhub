/** The newspaper's own plan, limits and usage (shown in its admin dashboard). */
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { one } = require('../config/db');
const { ok, asyncHandler } = require('../utils/http');
const tenants = require('../platform/tenants');
const ctx = require('../platform/context');
const { FEATURES } = require('../platform/features');

router.get('/', authenticate(true), requireAdmin, asyncHandler(async (req, res) => {
  const t = ctx.current();
  const used = await tenants.storageUsed(t, { fresh: req.query.fresh === '1' });
  const ps = await require('../platform/settings').getAll().catch(() => ({}));
  const { staff } = await one('SELECT COUNT(*) staff FROM users WHERE role_id IS NOT NULL AND deleted_at IS NULL');
  const { month } = await one("SELECT COUNT(*) month FROM editions WHERE deleted_at IS NULL AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')");
  const days = t.expires_at ? Math.ceil((new Date(`${t.expires_at}T23:59:59`) - Date.now()) / 86400000) : null;
  ok(res, {
    name: t.name, slug: t.slug, plan: t.plan_name || 'Custom', status: t.status, starts_at: t.starts_at, expires_at: t.expires_at, days_left: days,
    is_active: t.is_active, impersonated: !!req.user.impersonated_by,
    support: { email: ps.support_email || '', phone: ps.support_phone || '' },
    limits: t.limits,
    usage: { storage_bytes: used, staff: Number(staff), editions_this_month: Number(month) },
    features: FEATURES.map((f) => ({ key: f.key, label: f.label, enabled: t.features.includes(f.key) })),
  });
}));

module.exports = router;
