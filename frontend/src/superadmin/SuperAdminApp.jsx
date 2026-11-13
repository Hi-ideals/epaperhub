import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { pget, ppost, platformToken, onPlatformUnauthorized } from '../services/api';
import { Spinner, Field } from '../components/common';
import '../styles/superadmin.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientForm = lazy(() => import('./pages/ClientForm'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const Plans = lazy(() => import('./pages/Plans'));
const PlatformSettings = lazy(() => import('./pages/PlatformSettings'));
const Admins = lazy(() => import('./pages/Admins'));
const Activity = lazy(() => import('./pages/Activity'));
const Account = lazy(() => import('./pages/Account'));

/* ------------------------------ Auth ------------------------------ */
const Ctx = createContext(null);
export const usePlatformAuth = () => useContext(Ctx);

function PlatformAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    if (!platformToken.get()) { setAdmin(null); setReady(true); return; }
    try { setAdmin((await pget('/auth/me')).data); } catch { platformToken.set(null); setAdmin(null); }
    setReady(true);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onPlatformUnauthorized(() => { platformToken.set(null); setAdmin(null); }), []);
  const value = useMemo(() => ({
    admin, ready, setAdmin,
    login: async (email, password) => { const r = await ppost('/auth/login', { email, password }); platformToken.set(r.data.token); setAdmin(r.data.admin); return r; },
    logout: () => { platformToken.set(null); setAdmin(null); },
  }), [admin, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------ Login ------------------------------ */
function usePlatformName() {
  const [d, setD] = useState({ platform_name: 'ePaper Platform' });
  useEffect(() => { pget('/directory').then((r) => setD(r.data || {})).catch(() => {}); }, []);
  return d;
}

function Login() {
  const { admin, login } = usePlatformAuth();
  const info = usePlatformName();
  const [f, setF] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [caps, setCaps] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { document.title = `Super Admin login · ${info.platform_name || 'ePaper Platform'}`; }, [info.platform_name]);
  if (admin) return <Navigate to="/superadmin" replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try { await login(f.email, f.password); navigate('/superadmin', { replace: true }); } catch (err) { setErrors({ ...(err.errors || {}), form: err.message }); }
    setBusy(false);
  };
  const count = info.newspapers?.length;
  return (
    <div className="sl">
      <section className="sl-brand" aria-hidden="false">
        <div className="sl-orb o1" /><div className="sl-orb o2" /><div className="sl-grid" />
        <div className="sl-brand-in">
          <div className="sl-logo"><i className="bi bi-newspaper" /><span>{info.platform_name || 'ePaper Platform'}</span></div>
          <div className="sl-hero">
            <h1>Every newspaper.<br /><span>One control room.</span></h1>
            <p>Manage clients, plans, modules and storage for all your ePapers from a single, secure panel.</p>
          </div>
          <ul className="sl-points">
            <li><i className="bi bi-buildings" /><div><b>Clients & newspapers</b><span>{count ? `${count} newspaper${count === 1 ? '' : 's'} live on this platform` : 'Each with its own database and files'}</span></div></li>
            <li><i className="bi bi-gem" /><div><b>Subscription plans</b><span>Limits, modules and renewals</span></div></li>
            <li><i className="bi bi-shield-lock" /><div><b>Separate secure login</b><span>Not shared with newspaper staff</span></div></li>
          </ul>
          <div className="sl-foot">© {new Date().getFullYear()} {info.platform_name || 'ePaper Platform'}</div>
        </div>
      </section>

      <section className="sl-form-side">
        <form className="sl-card" onSubmit={submit} noValidate>
          <div className="sl-mark"><i className="bi bi-shield-lock-fill" /></div>
          <h2>Welcome back</h2>
          <p className="sl-sub">Sign in to the <b>Super Admin</b> panel</p>

          {errors.form && <div className="sl-alert" role="alert"><i className="bi bi-exclamation-circle" />{errors.form}</div>}

          <label className="sl-label" htmlFor="sl-email">Email</label>
          <div className={`sl-input ${errors.email ? 'err' : ''}`}>
            <i className="bi bi-envelope" />
            <input id="sl-email" type="email" autoComplete="username" placeholder="you@company.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoFocus />
          </div>
          {errors.email && <div className="sl-err">{errors.email}</div>}

          <label className="sl-label" htmlFor="sl-pass">Password</label>
          <div className={`sl-input ${errors.password ? 'err' : ''}`}>
            <i className="bi bi-lock" />
            <input id="sl-pass" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })} onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock'))} required />
            <button type="button" className="sl-eye" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide password' : 'Show password'}><i className={`bi bi-eye${show ? '-slash' : ''}`} /></button>
          </div>
          {errors.password && <div className="sl-err">{errors.password}</div>}
          {caps && <div className="sl-hint"><i className="bi bi-capslock" /> Caps Lock is on</div>}

          <button className="sl-btn" disabled={busy || !f.email || !f.password}>
            {busy ? <span className="spinner-border spinner-border-sm" /> : <>Sign in <i className="bi bi-arrow-right" /></>}
          </button>

          <div className="sl-note"><i className="bi bi-info-circle" /><span>Newspaper staff? Sign in on your newspaper's own <code>/admin</code> page.</span></div>
          {(info.support_email || info.support_phone) && <div className="sl-help">Need help? {info.support_email && <a href={`mailto:${info.support_email}`}>{info.support_email}</a>}{info.support_email && info.support_phone ? ' · ' : ''}{info.support_phone}</div>}
        </form>
      </section>
    </div>
  );
}

/* ------------------------------ Layout ------------------------------ */
const NAV = [
  { to: '/superadmin', icon: 'speedometer2', label: 'Dashboard', end: true },
  { section: 'Clients' },
  // Active on the list and on a client's pages, but not on "Add client"
  { to: '/superadmin/clients', icon: 'buildings', label: 'Clients (Newspapers)', match: (p) => /^\/superadmin\/clients(\/(?!new$)[^/]+.*)?$/.test(p) },
  { to: '/superadmin/clients/new', icon: 'plus-circle', label: 'Add client', end: true },
  { to: '/superadmin/plans', icon: 'gem', label: 'Subscription plans' },
  { section: 'Platform' },
  { to: '/superadmin/settings', icon: 'gear', label: 'Platform settings', end: true },
  { to: '/superadmin/settings/email', icon: 'envelope-at', label: 'Platform Email (SMTP)' },
  { to: '/superadmin/admins', icon: 'person-badge', label: 'Super admins' },
  { to: '/superadmin/activity', icon: 'clock-history', label: 'Activity log' },
];

function Layout() {
  const { admin, ready, logout } = usePlatformAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setOpen(false); setMenu(false); }, [location.pathname]);
  if (!ready) return <Spinner className="vh-100" />;
  if (!admin) return <Navigate to={`/superadmin/login`} replace />;
  return (
    <div className="admin sa">
      <aside className={`admin-sidebar ${open ? 'open' : ''}`} aria-label="Super admin navigation">
        <div className="brand-row"><span className="logo-dot sa-dot"><i className="bi bi-shield-lock-fill" /></span><div className="min-w-0"><div className="text-truncate">Super Admin</div><div className="small fw-normal sa-sub">Platform control</div></div></div>
        <nav>
          {NAV.map((n, i) => (n.section ? <div key={i} className="nav-section">{n.section}</div> : (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => ((n.match ? n.match(location.pathname) : isActive) ? 'active' : '')}><i className={`bi bi-${n.icon}`} /><span className="flex-grow-1">{n.label}</span></NavLink>
          )))}
        </nav>
      </aside>
      <div className={`admin-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-light d-lg-none" onClick={() => setOpen(true)} aria-label="Open menu"><i className="bi bi-list" /></button>
            <span className="sa-chip"><i className="bi bi-shield-check me-1" />Super admin</span>
          </div>
          <div className="position-relative">
            <button className="btn btn-light d-flex align-items-center gap-2" onClick={() => setMenu((m) => !m)}>
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{admin.name?.[0]?.toUpperCase()}</span>
              <span className="d-none d-md-inline text-start lh-sm"><span className="d-block small fw-semibold">{admin.name}</span><span className="d-block" style={{ fontSize: 11, color: '#64748b' }}>{admin.email}</span></span>
              <i className="bi bi-chevron-down small" />
            </button>
            {menu && (
              <div className="dropdown-menu dropdown-menu-end show" style={{ right: 0, left: 'auto' }}>
                <Link className="dropdown-item" to="/superadmin/account"><i className="bi bi-person me-2" />My account & password</Link>
                <hr className="dropdown-divider" />
                <button className="dropdown-item text-danger" onClick={() => { logout(); navigate('/superadmin/login'); }}><i className="bi bi-box-arrow-right me-2" />Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="admin-content"><Suspense fallback={<Spinner className="py-5" />}><Outlet /></Suspense></main>
      </div>
    </div>
  );
}

export default function SuperAdminApp() {
  return (
    <PlatformAuthProvider>
      <Routes>
        <Route path="/superadmin/login" element={<Login />} />
        <Route path="/superadmin" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/new" element={<ClientForm />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="clients/:id/edit" element={<ClientForm />} />
          <Route path="plans" element={<Plans />} />
          <Route path="settings" element={<PlatformSettings tab="general" />} />
          <Route path="settings/email" element={<PlatformSettings tab="email" />} />
          <Route path="admins" element={<Admins />} />
          <Route path="activity" element={<Activity />} />
          <Route path="account" element={<Account />} />
        </Route>
        <Route path="*" element={<Navigate to="/superadmin" replace />} />
      </Routes>
    </PlatformAuthProvider>
  );
}
