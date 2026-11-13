import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../common';
import { get, tokenStore } from '../../services/api';
import { formatBytes } from '../../pages/admin/Backups';
import { Panel } from './index';

let memo = null;
/** This newspaper's plan, limits and usage (cached for the session). */
export function useSubscription(refreshKey = 0) {
  const [s, setS] = useState(memo);
  useEffect(() => {
    let alive = true;
    get('/subscription', refreshKey ? { fresh: 1 } : undefined).then((r) => { memo = r.data; if (alive) setS(r.data); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  return s;
}

const storagePct = (s) => {
  const max = (s?.limits?.storage_mb || 0) * 1048576;
  return max ? Math.round((s.usage.storage_bytes / max) * 100) : 0;
};

/**
 * Popup when storage is almost full (90%+) or full (100%). Shown once per login session
 * for each level, and always right away when an upload is refused for lack of space.
 */
export function StoragePopup() {
  const [refresh, setRefresh] = useState(0);
  const s = useSubscription(refresh);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const pct = storagePct(s);
  const level = pct >= 100 ? 'full' : pct >= 90 ? 'warn' : null;

  useEffect(() => {
    if (!level) return;
    const key = `ep_storage_popup:${s?.slug}:${level}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* private mode */ }
    setOpen(true);
  }, [level, s?.slug]);

  useEffect(() => {
    const h = (e) => { setReason(e.detail || ''); setRefresh((n) => n + 1); setOpen(true); };
    window.addEventListener('ep:storage-full', h);
    return () => window.removeEventListener('ep:storage-full', h);
  }, []);

  if (!s) return null;
  const full = level === 'full' || !!reason;
  const max = s.limits.storage_mb * 1048576;
  return (
    <Modal show={open} onClose={() => setOpen(false)} title={null} footer={<>
      <button className="btn btn-light" onClick={() => setOpen(false)}>Close</button>
      <Link to="/admin/editions" className="btn btn-primary" onClick={() => setOpen(false)}><i className="bi bi-trash3 me-1" />Free up space</Link>
    </>}>
      <div className={`st-pop ${full ? 'full' : 'warn'}`}>
        <div className="st-ic"><i className={`bi bi-${full ? 'hdd-fill' : 'hdd'}`} /></div>
        <h3>{full ? 'Storage full' : 'Storage almost full'}</h3>
        <p className="text-muted mb-3">
          {full
            ? 'You have used all the storage in your plan. New pages, logos and images can\'t be uploaded until you free up space or upgrade your plan.'
            : `You have used ${pct}% of the storage in your plan. When it is full, new pages can't be uploaded.`}
        </p>
        {reason && <div className="st-reason"><i className="bi bi-exclamation-octagon me-1" />{reason}</div>}
        <div className="st-meter">
          <div className="d-flex justify-content-between small fw-semibold"><span>{formatBytes(s.usage.storage_bytes)} used</span><span>{formatBytes(max)} total</span></div>
          <div className="plan-bar"><span className={pct >= 100 ? 'hot' : 'warm'} style={{ width: `${Math.min(100, Math.max(pct, 3))}%` }} /></div>
          <div className="small text-muted text-center mt-1">{Math.min(pct, 999)}% of your {s.plan} plan</div>
        </div>
        <ul className="st-tips">
          <li><i className="bi bi-trash3" />Delete old editions you no longer need — their page images are removed.</li>
          <li><i className="bi bi-gem" />Ask the platform administrator to upgrade your plan{s.support?.email || s.support?.phone ? ':' : '.'}
            {s.support?.email && <> <a href={`mailto:${s.support.email}`}>{s.support.email}</a></>}{s.support?.email && s.support?.phone ? ' · ' : ''}{s.support?.phone && <a href={`tel:${s.support.phone}`}>{s.support.phone}</a>}</li>
        </ul>
      </div>
    </Modal>
  );
}

const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Bars at the top of the admin panel: super admin view, closed newspaper, plan expiring. */
export function PlanBanners({ user }) {
  const s = useSubscription();
  const out = [];
  if (user?.impersonated) {
    out.push(
      <div key="imp" className="plan-banner imp">
        <i className="bi bi-incognito" /><span><b>Super admin view</b> — you are managing <b>{s?.name || 'this newspaper'}</b> as its administrator.</span>
        <button className="btn btn-sm" onClick={() => { tokenStore.set(null); window.close(); window.location.reload(); }}>Exit</button>
      </div>,
    );
  }
  const pct = storagePct(s);
  if (s && pct >= 90) {
    out.push(<div key="st" className={`plan-banner ${pct >= 100 ? 'off' : 'warn'}`}><i className="bi bi-hdd" /><span><b>{pct >= 100 ? 'Storage full' : `Storage ${pct}% used`}</b> — {formatBytes(s.usage.storage_bytes)} of {formatBytes(s.limits.storage_mb * 1048576)}. {pct >= 100 ? 'Uploads are blocked.' : 'Uploads will stop when it is full.'} Delete old editions or ask for a bigger plan.</span></div>);
  }
  if (s && !s.is_active) {
    out.push(<div key="off" className="plan-banner off"><i className="bi bi-pause-circle" /><span>This newspaper is <b>{s.status !== 'active' ? 'deactivated' : 'expired'}</b> — readers see an "unavailable" page.</span></div>);
  } else if (s && s.days_left !== null && s.days_left <= 15) {
    out.push(<div key="exp" className="plan-banner warn"><i className="bi bi-hourglass-split" /><span>Your <b>{s.plan}</b> plan expires {s.days_left <= 0 ? 'today' : `in ${s.days_left} day${s.days_left === 1 ? '' : 's'}`} ({fmtDate(s.expires_at)}). Please contact the platform administrator to renew.</span></div>);
  }
  return out.length ? <div className="plan-banners">{out}</div> : null;
}

function Meter({ label, used, max, fmt = (n) => n, unlimited = 'Unlimited' }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="plan-meter">
      <div className="d-flex justify-content-between small"><span className="fw-semibold">{label}</span><span className="text-muted">{fmt(used)} / {max ? fmt(max) : unlimited}</span></div>
      <div className="plan-bar"><span style={{ width: `${max ? pct : 6}%` }} className={pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : ''} /></div>
    </div>
  );
}

/** Dashboard panel: plan, validity, usage meters and included modules. */
export function PlanPanel() {
  const s = useSubscription();
  if (!s) return null;
  return (
    <Panel title={<><i className="bi bi-gem me-2" />Your plan</>} className="mb-4">
      <div className="row g-4 align-items-center">
        <div className="col-lg-4">
          <div className="plan-name">{s.plan}</div>
          <div className="text-muted small">Valid {s.starts_at ? `from ${fmtDate(s.starts_at)} ` : ''}until <b>{fmtDate(s.expires_at)}</b>{s.days_left !== null && s.days_left >= 0 ? ` · ${s.days_left} days left` : ''}</div>
        </div>
        <div className="col-lg-8">
          <div className="row g-3">
            <div className="col-md-4"><Meter label="Storage" used={s.usage.storage_bytes} max={s.limits.storage_mb * 1048576} fmt={formatBytes} /></div>
            <div className="col-md-4"><Meter label="Admin users" used={s.usage.staff} max={s.limits.max_admin_users} /></div>
            <div className="col-md-4"><Meter label="Editions this month" used={s.usage.editions_this_month} max={s.limits.max_editions_per_month} /></div>
          </div>
        </div>
      </div>
      <div className="plan-features mt-3">
        {s.features.map((f) => <span key={f.key} className={f.enabled ? 'on' : 'off'}><i className={`bi bi-${f.enabled ? 'check-circle-fill' : 'x-circle'}`} />{f.label}</span>)}
      </div>
    </Panel>
  );
}
