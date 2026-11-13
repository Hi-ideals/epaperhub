/** Plan limits for the current newspaper (staff accounts, editions per month). */
const { one } = require('../config/db');
const { ApiError } = require('../utils/http');
const ctx = require('./context');

/** Call before giving a user an admin role (new staff, or reader promoted to staff). */
async function assertStaffSlot(excludeUserId = 0) {
  const t = ctx.current();
  const max = t?.limits?.max_admin_users || 0;
  if (!max) return;
  const { n } = await one('SELECT COUNT(*) n FROM users WHERE role_id IS NOT NULL AND deleted_at IS NULL AND id<>?', [excludeUserId || 0]);
  if (n >= max) throw new ApiError(403, `Your plan allows ${max} admin user${max === 1 ? '' : 's'}. Remove a staff account or ask the platform administrator to upgrade your plan.`);
}

/** Call before creating a new edition. */
async function assertEditionSlot() {
  const t = ctx.current();
  const max = t?.limits?.max_editions_per_month || 0;
  if (!max) return;
  const { n } = await one("SELECT COUNT(*) n FROM editions WHERE deleted_at IS NULL AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')");
  if (n >= max) throw new ApiError(403, `Your plan allows ${max} new editions per month. This month's limit is used up — ask the platform administrator to upgrade your plan.`);
}

module.exports = { assertStaffSlot, assertEditionSlot };
