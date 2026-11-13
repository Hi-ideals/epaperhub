/**
 * Modules a plan can switch on/off for a client. `perm` = the admin permission module it
 * controls (its menu items and APIs disappear when off). Editions, pages, categories,
 * users and settings are always included.
 */
const FEATURES = [
  { key: 'area_mapping', label: 'Article area mapping & popups', perm: null },
  { key: 'clippings', label: 'Clip & share articles', perm: null },
  { key: 'comments', label: 'Reader comments', perm: 'comments' },
  { key: 'schedules', label: 'Scheduled publishing', perm: 'schedules' },
  { key: 'subscribers', label: 'Subscribers & newsletter', perm: 'subscribers' },
  { key: 'notifications', label: 'Push notifications', perm: 'notifications' },
  { key: 'locations', label: 'Location mapping (states, districts)', perm: 'areas' },
  { key: 'cms', label: 'CMS pages', perm: 'cms' },
  { key: 'seo', label: 'SEO tools', perm: 'seo' },
  { key: 'roles', label: 'Custom roles & permissions', perm: 'roles' },
  { key: 'audit_logs', label: 'Audit logs', perm: 'audit_logs' },
  { key: 'backups', label: 'Backups', perm: 'backups' },
];
const KEYS = FEATURES.map((f) => f.key);

/** Permission modules that are switched off for the given enabled feature list. */
function disabledPermModules(enabled) {
  const on = new Set(enabled || KEYS);
  return FEATURES.filter((f) => f.perm && !on.has(f.key)).map((f) => f.perm);
}

module.exports = { FEATURES, KEYS, disabledPermModules };
