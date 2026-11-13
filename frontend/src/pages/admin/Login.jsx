import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useTitle } from '../../hooks';
import { AdminBrandMark } from '../../components/admin';
import { appHref } from '../../services/tenant';
import { get, post, mediaUrl } from '../../services/api';
import '../../styles/admin-login.css';

const fmtDate = (d) => { try { return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };

export default function AdminLogin() {
  const { adminLogin, user } = useAuth();
  const { site } = useSettings();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caps, setCaps] = useState(false);
  const name = site.site_name || 'ePaper';
  useTitle(`Admin login | ${name}`);
  const next = params.get('next')?.startsWith('/admin') ? params.get('next') : '/admin/dashboard';
  if (user?.is_admin) return <Navigate to={next} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await adminLogin(form); toast.success('Welcome back'); navigate(next, { replace: true }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const capsCheck = (e) => setCaps(!!e.getModifierState?.('CapsLock'));

  return (
    <AdminAuthShell>
        <form className="al-card" onSubmit={submit} noValidate>
          <div className="al-card-top">
            <AdminBrandMark className="al-mark" />
            <span className="al-badge"><i className="bi bi-shield-check" /> Secure admin</span>
          </div>
          <h2>Welcome back</h2>
          <p className="al-sub">Sign in to manage <b>{name}</b> ePaper</p>

          {error && <div className="al-alert" role="alert"><i className="bi bi-exclamation-circle" />{error}</div>}

          <label className="al-label" htmlFor="al-email">Email</label>
          <div className="al-input">
            <i className="bi bi-envelope" />
            <input id="al-email" type="email" autoComplete="username" placeholder="you@newspaper.com" required autoFocus
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>

          <div className="al-label-row">
            <label className="al-label" htmlFor="al-pass">Password</label>
            <Link to="/admin/forgot-password" className="al-link">Forgot password?</Link>
          </div>
          <div className="al-input">
            <i className="bi bi-lock" />
            <input id="al-pass" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" required
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} onKeyUp={capsCheck} onKeyDown={capsCheck} />
            <button type="button" className="al-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}><i className={`bi bi-eye${show ? '-slash' : ''}`} /></button>
          </div>
          {caps && <div className="al-hint"><i className="bi bi-capslock" /> Caps Lock is on</div>}

          <button className="al-btn" disabled={busy || !form.email || !form.password}>
            {busy ? <><span className="spinner-border spinner-border-sm me-2" />Signing in…</> : <>Sign in <i className="bi bi-arrow-right" /></>}
          </button>

          <a className="al-back" href={appHref('/')}><i className="bi bi-arrow-left" /> Back to website</a>
        </form>
    </AdminAuthShell>
  );
}

/** Shared split-screen frame for the admin login, forgot-password and reset-password pages. */
export function AdminAuthShell({ children }) {
  const { site } = useSettings();
  const name = site.site_name || 'ePaper';
  const [latest, setLatest] = useState(null);
  useEffect(() => { get('/editions/public/latest', { limit: 1 }).then((r) => setLatest(r.data?.[0] || null)).catch(() => {}); }, []);
  return (
    <div className="al-wrap">
      <section className="al-brand">
        <div className="al-orb o1" /><div className="al-orb o2" /><div className="al-lines" />
        <div className="al-brand-in">
          <div className="al-logo"><AdminBrandMark className="al-logo-mark" /><div><b>{name}</b>{site.tagline && <span>{site.tagline}</span>}</div></div>

          <div className="al-hero">
            <div className="al-chip"><i className="bi bi-stars" /> Newsroom control panel</div>
            <h1>Today's paper,{' '}<br /><span>live in minutes.</span></h1>
            <p>Upload pages, map articles, schedule editions and reach every reader of {name} from one place.</p>
          </div>

          <div className="al-showcase">
            {latest?.thumb_url ? (
              <a className="al-paper" href={appHref(`/edition/${latest.slug}`)} target="_blank" rel="noreferrer" title="Open the latest edition">
                <img src={mediaUrl(latest.thumb_url)} alt="" />
                <div className="al-paper-tag"><i className="bi bi-broadcast" /> Latest · {fmtDate(latest.edition_date)}</div>
              </a>
            ) : (
              <div className="al-paper al-paper-empty"><i className="bi bi-newspaper" /><span>Your first edition will show here</span></div>
            )}
            <ul className="al-points">
              <li><i className="bi bi-cloud-arrow-up" /><div><b>Upload & publish</b><span>Images or PDF, every page</span></div></li>
              <li><i className="bi bi-bounding-box-circles" /><div><b>Map articles</b><span>Clickable stories with popups</span></div></li>
              <li><i className="bi bi-bell" /><div><b>Reach readers</b><span>Email, push & sharing</span></div></li>
            </ul>
          </div>

          <div className="al-foot">© {new Date().getFullYear()} {name}</div>
        </div>
      </section>

      <section className="al-form-side">
        {children}
      </section>
    </div>
  );
}

/** Card header used on every admin auth page. */
function CardHead({ icon, badge, title, sub }) {
  return (
    <>
      <div className="al-card-top">
        {icon ? <span className="al-mark al-mark-ic"><i className={`bi bi-${icon}`} /></span> : <AdminBrandMark className="al-mark" />}
        <span className="al-badge"><i className="bi bi-shield-check" /> {badge}</span>
      </div>
      <h2>{title}</h2>
      <p className="al-sub">{sub}</p>
    </>
  );
}

export function AdminForgotPassword() {
  const { site } = useSettings();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  useTitle(`Forgot password | ${site.site_name || 'ePaper'}`);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/auth/forgot-password', { email, admin: true }); setSent(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <AdminAuthShell>
      <form className="al-card" onSubmit={submit} noValidate>
        {sent ? (
          <>
            <CardHead icon="envelope-check" badge="Link sent" title="Check your inbox" sub={<>If an admin account exists for <b>{email}</b>, we've sent a link to reset the password.</>} />
            <ul className="al-steps">
              <li><span>1</span><div>Open the email from <b>{site.site_name || 'ePaper'}</b></div></li>
              <li><span>2</span><div>Click <b>Reset password</b> (the link works for 1 hour)</div></li>
              <li><span>3</span><div>Choose a new password and sign in</div></li>
            </ul>
            <div className="al-note"><i className="bi bi-info-circle" /><span>No email after a few minutes? Check the Spam folder, or <button type="button" className="al-inline-btn" onClick={() => setSent(false)}>try another email</button>.</span></div>
            <Link className="al-btn al-btn-link" to="/admin/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
          </>
        ) : (
          <>
            <CardHead icon="key" badge="Account recovery" title="Forgot password?" sub="No worries. Enter your admin email and we'll send you a reset link." />
            {error && <div className="al-alert" role="alert"><i className="bi bi-exclamation-circle" />{error}</div>}
            <label className="al-label" htmlFor="al-femail">Email</label>
            <div className="al-input">
              <i className="bi bi-envelope" />
              <input id="al-femail" type="email" autoComplete="username" placeholder="you@newspaper.com" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="al-btn" disabled={busy || !/^\S+@\S+\.\S+$/.test(email)}>
              {busy ? <><span className="spinner-border spinner-border-sm me-2" />Sending…</> : <>Send reset link <i className="bi bi-send" /></>}
            </button>
            <Link className="al-back" to="/admin/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
          </>
        )}
      </form>
    </AdminAuthShell>
  );
}

const strengthOf = (p) => { let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++; return s; };
const STRENGTH = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];

export function AdminResetPassword() {
  const { site } = useSettings();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm_password: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useTitle(`Set a new password | ${site.site_name || 'ePaper'}`);
  const st = strengthOf(form.password);
  const mismatch = form.confirm_password && form.confirm_password !== form.password;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({}); setError('');
    try { const r = await post('/auth/reset-password', { token, ...form }); toast.success(r.message || 'Password updated'); navigate('/admin/login'); } catch (err) {
      const errs = err.errors || {};
      setErrors(errs);
      setError(errs.token || /token|expired|invalid/i.test(err.message || '') ? 'This reset link is invalid or has expired. Please request a new one.' : err.message);
    } finally { setBusy(false); }
  };
  return (
    <AdminAuthShell>
      <form className="al-card" onSubmit={submit} noValidate>
        {!token ? (
          <>
            <CardHead icon="link-45deg" badge="Account recovery" title="Link not valid" sub="This reset link is incomplete or has expired. Request a new one." />
            <Link className="al-btn al-btn-link" to="/admin/forgot-password">Request a new link <i className="bi bi-arrow-right" /></Link>
            <Link className="al-back" to="/admin/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
          </>
        ) : (
          <>
            <CardHead icon="shield-lock" badge="Account recovery" title="Set a new password" sub="Use at least 8 characters with a letter and a number." />
            {error && <div className="al-alert" role="alert"><i className="bi bi-exclamation-circle" /><span>{error}{/expired/.test(error) && <> <Link to="/admin/forgot-password">Request new link</Link></>}</span></div>}
            <label className="al-label" htmlFor="al-np">New password</label>
            <div className="al-input">
              <i className="bi bi-lock" />
              <input id="al-np" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="New password" required autoFocus value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" className="al-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}><i className={`bi bi-eye${show ? '-slash' : ''}`} /></button>
            </div>
            {form.password && <div className={`al-meter s${st}`}><div><i /><i /><i /><i /><i /></div><span>{STRENGTH[st]}</span></div>}
            {errors.password && <div className="al-err">{errors.password}</div>}
            <label className="al-label" htmlFor="al-cp">Confirm password</label>
            <div className="al-input">
              <i className="bi bi-lock-fill" />
              <input id="al-cp" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Type it again" required value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} />
              {form.confirm_password && !mismatch && <i className="bi bi-check-circle-fill al-ok" />}
            </div>
            {(mismatch || errors.confirm_password) && <div className="al-err">{errors.confirm_password || 'Passwords do not match'}</div>}
            <button className="al-btn" disabled={busy || form.password.length < 8 || form.confirm_password !== form.password}>
              {busy ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : <>Reset password <i className="bi bi-check2" /></>}
            </button>
            <Link className="al-back" to="/admin/login"><i className="bi bi-arrow-left" /> Back to sign in</Link>
          </>
        )}
      </form>
    </AdminAuthShell>
  );
}
