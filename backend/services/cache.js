/** Tiny in-memory TTL cache for frequently-read public data. */
const store = new Map();
const ctx = require('../platform/context');
// Keys are kept separate per newspaper
const k = (key) => `${ctx.keyOf(ctx.current())}|${key}`;

function get(key) {
  const hit = store.get(k(key));
  if (!hit) return undefined;
  if (hit.exp < Date.now()) { store.delete(k(key)); return undefined; }
  return hit.val;
}
function set(key, val, ttlSec = 60) { store.set(k(key), { val, exp: Date.now() + ttlSec * 1000 }); return val; }
async function remember(key, ttlSec, fn) {
  const v = get(key);
  if (v !== undefined) return v;
  return set(key, await fn(), ttlSec);
}
/** Delete this newspaper's keys starting with any of the prefixes (or all of its keys). */
function invalidate(...prefixes) {
  const own = k('');
  const full = prefixes.length ? prefixes.map((p) => own + p) : [own];
  for (const key of store.keys()) if (full.some((p) => key.startsWith(p))) store.delete(key);
}

module.exports = { get, set, remember, invalidate };
