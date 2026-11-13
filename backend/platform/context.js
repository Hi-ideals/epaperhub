/**
 * Request-scoped "current newspaper" (tenant). Everything that touches the database,
 * the uploads folder, the cache or login tokens reads the tenant from here, so the
 * existing feature code works unchanged inside each client's own database and folder.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/** Current tenant row (or null when serving the platform / super admin). */
const current = () => als.getStore()?.tenant || null;

/** Run fn with `tenant` as the current tenant (null = platform). */
const run = (tenant, fn) => als.run({ tenant }, fn);

/** Folder/cache key for a tenant, e.g. "c7". */
const keyOf = (t) => (t ? `c${t.id}` : 'platform');

module.exports = { als, current, run, keyOf };
