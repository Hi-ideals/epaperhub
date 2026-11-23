import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Panel } from './index';

const fmt = (n) => {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
};
const PARTS = [
  { key: 'page_images', label: 'Page images (what readers see)', color: '#6366f1' },
  { key: 'originals', label: 'Original uploads', color: '#f59e0b' },
  { key: 'backups', label: 'Backups', color: '#0891b2' },
  { key: 'other_uploads', label: 'Logos, clips & other', color: '#94a3b8' },
];

/**
 * Storage breakdown + "Optimize now". Works for the client admin and the super admin:
 * pass load() → { usage, job } and run() → starts the optimizer.
 */
export default function StoragePanel({ load, run, canRun = true, className = '' }) {
  const [d, setD] = useState(null);
  const [starting, setStarting] = useState(false);
  const refresh = useCallback(() => load().then(setD).catch(() => {}), [load]);
  useEffect(() => { refresh(); }, [refresh]);
  const job = d?.job;
  useEffect(() => {
    if (!job?.running) return undefined;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [job?.running, refresh]);
  useEffect(() => {
    if (job && !job.running && starting === 'wait') {
      setStarting(false);
      toast.success(job.saved_bytes > 0 ? `Done — freed ${fmt(job.saved_bytes)}. Page quality is unchanged.` : 'Done — files were already optimized.', { duration: 6000 });
    }
  }, [job, starting]);

  const optimize = async () => {
    setStarting(true);
    try { await run(); setStarting('wait'); refresh(); } catch (e) { toast.error(e.message); setStarting(false); }
  };

  const u = d?.usage;
  const total = u ? PARTS.reduce((s, p) => s + Math.max(0, u[p.key] || 0), 0) : 0;
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <Panel className={className} title={<><i className="bi bi-hdd me-2" />Storage</>}
      actions={u && <span className="small fw-semibold text-muted">{fmt(total)} used</span>}>
      {!u ? <div className="text-muted small">Loading…</div> : (<>
        <div className="st-bar" role="img" aria-label="Storage breakdown">
          {PARTS.map((p) => (u[p.key] > 0 ? <span key={p.key} style={{ width: `${Math.max(1.5, (u[p.key] / (total || 1)) * 100)}%`, background: p.color }} title={`${p.label}: ${fmt(u[p.key])}`} /> : null))}
        </div>
        <ul className="st-legend">
          {PARTS.map((p) => <li key={p.key}><i style={{ background: p.color }} /><span>{p.label}</span><b>{fmt(u[p.key])}</b></li>)}
        </ul>

        {job?.running ? (
          <div className="st-job">
            <div className="d-flex justify-content-between small mb-1"><span><span className="spinner-border spinner-border-sm me-2" />{job.phase}{job.total ? ` · ${job.done} of ${job.total}` : ''}</span><b>{fmt(job.saved_bytes)} freed</b></div>
            <div className="progress" style={{ height: 6 }}><div className="progress-bar" style={{ width: `${job.phase.startsWith('Compressing') ? pct : 100}%` }} /></div>
          </div>
        ) : job?.finished_at ? (
          <div className="st-done"><i className="bi bi-check-circle-fill" />
            <span>Last optimized: freed <b>{fmt(job.saved_bytes)}</b> · {job.files_compressed} original{job.files_compressed === 1 ? '' : 's'} compressed · {job.files_removed} unused file{job.files_removed === 1 ? '' : 's'} removed</span></div>
        ) : null}

        {canRun && (
          <button className="btn btn-primary w-100 mt-3" disabled={!!starting || job?.running} onClick={optimize}>
            {job?.running ? 'Optimizing…' : <><i className="bi bi-magic me-1" />Optimize storage now</>}</button>
        )}
        <div className="st-note mt-3">
          <div className="fw-semibold mb-1"><i className="bi bi-shield-check me-1" />Quality stays the same</div>
          <ul className="mb-0 ps-3">
            <li>Pages from PDF / PNG are stored as <b>lossless WebP</b>: pixel-for-pixel identical, usually 50–80% smaller.</li>
            <li>Only very heavy JPEG photos are re-saved at quality 95 with full colour detail; others are left as they are.</li>
            <li>Removes temporary and leftover files no page uses.</li>
            <li>Images readers see are not changed. Runs automatically every night too.</li>
          </ul>
        </div>
      </>)}
    </Panel>
  );
}
