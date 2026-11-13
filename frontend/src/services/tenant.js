/**
 * Which newspaper this browser tab is showing.
 *  - yourplatform.com/n/<slug>/…  → path mode: router base "/n/<slug>", API calls send X-Tenant
 *  - a newspaper's own domain     → domain mode: the server knows the newspaper from the domain
 *  - yourplatform.com/superadmin  → the platform's super admin panel
 */
const m = window.location.pathname.match(/^\/n\/([a-z0-9][a-z0-9-]*)(?=\/|$)/i);

export const TENANT_SLUG = m ? m[1].toLowerCase() : null;
export const BASENAME = m ? `/n/${TENANT_SLUG}` : '';
export const IS_SUPERADMIN = !m && /^\/superadmin(\/|$)/.test(window.location.pathname);
/** Keeps logins of different newspapers apart in the same browser. */
export const TENANT_KEY = TENANT_SLUG || window.location.host;

/** Link for a plain <a href> / window.location inside this newspaper. */
export const appHref = (path = '/') => `${BASENAME}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * "Login as client" from the super admin panel arrives as …/admin#imp=<token>.
 * Store it as this newspaper's login and remove it from the address bar.
 */
export function takeImpersonationToken(store) {
  const h = window.location.hash || '';
  if (!h.startsWith('#imp=')) return;
  store(decodeURIComponent(h.slice(5)));
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
