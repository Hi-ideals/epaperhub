import { useCallback, useEffect, useRef, useState } from 'react';
import { pget } from '../services/api';

/** Like useFetch, for the platform API. */
export function usePFetch(url, params, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, loading: !!url, error: null });
  const seq = useRef(0);
  const key = JSON.stringify(params || {});
  const load = useCallback(async (silent) => {
    if (!url) return;
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await pget(url, params);
      if (id === seq.current) setState({ data: r.data, meta: r.meta || null, loading: false, error: null });
    } catch (e) { if (id === seq.current) setState((s) => ({ ...s, loading: false, error: e })); }
  }, [url, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

/** A client's website: its own domain, else this platform address + /n/<slug>. */
export const sitePath = (c) => `${window.location.origin}/n/${c.slug}`;
export const siteHref = (c) => (c.domain ? c.site_url : sitePath(c));

export const money = (n, cur = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0); } catch { return `${cur} ${n}`; }
};
export const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const mbText = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`);
export const daysLeft = (d) => (d ? Math.ceil((new Date(`${String(d).slice(0, 10)}T23:59:59`) - Date.now()) / 86400000) : null);

/** Client status pill: Active / Expired / Deactivated (+ days left). */
export function ClientStatus({ c }) {
  if (c.status !== 'active') return <span className="sa-pill off"><i className="bi bi-pause-circle" />Deactivated</span>;
  if (c.is_expired) return <span className="sa-pill exp"><i className="bi bi-hourglass-bottom" />Expired</span>;
  const d = daysLeft(c.expires_at);
  if (d !== null && d <= 15) return <span className="sa-pill warn"><i className="bi bi-hourglass-split" />{d} day{d === 1 ? '' : 's'} left</span>;
  return <span className="sa-pill on"><i className="bi bi-check-circle" />Active</span>;
}

/** Tick-box list of plan modules. */
export function ModulePicker({ features, value, onChange, disabled }) {
  const set = new Set(value || []);
  const toggle = (k) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); onChange([...n]); };
  return (
    <div className="sa-modules">
      <div className="sa-mod core"><i className="bi bi-lock-fill" /><div><b>Always included</b><div className="small text-muted">Editions, pages, categories, users, settings</div></div></div>
      {features.map((f) => (
        <label key={f.key} className={`sa-mod ${set.has(f.key) ? 'on' : ''}`}>
          <input type="checkbox" className="form-check-input" checked={set.has(f.key)} disabled={disabled} onChange={() => toggle(f.key)} />
          <span>{f.label}</span>
        </label>
      ))}
      {!disabled && (
        <div className="sa-mod-actions">
          <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onChange(features.map((f) => f.key))}>Select all</button>
          <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onChange([])}>Clear</button>
        </div>
      )}
    </div>
  );
}
