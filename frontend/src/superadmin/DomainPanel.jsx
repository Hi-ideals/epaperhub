import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Panel } from '../components/admin';
import { ppost } from '../services/api';
import { timeAgo } from '../utils/format';
import { usePFetch } from './shared';

const STEPS = [
  { key: 'dns', label: 'DNS points to server' },
  { key: 'site', label: 'Website created' },
  { key: 'ssl', label: 'SSL certificate (https)' },
];
const STATUS = {
  none: { label: 'Not set', cls: 'muted', icon: 'dash-circle' },
  pending_dns: { label: 'Waiting for DNS', cls: 'warn', icon: 'hourglass-split' },
  configuring: { label: 'Setting up…', cls: 'info', icon: 'arrow-repeat spin' },
  live: { label: 'Live', cls: 'ok', icon: 'check-circle-fill' },
  ssl_error: { label: 'Live without SSL', cls: 'warn', icon: 'shield-exclamation' },
  manual: { label: 'Needs server setup', cls: 'warn', icon: 'tools' },
  error: { label: 'Setup failed', cls: 'bad', icon: 'x-circle-fill' },
};
const stepState = (st) => ({
  dns: st === 'pending_dns' ? 'wait' : ['none'].includes(st) ? 'off' : 'done',
  site: ['live', 'ssl_error'].includes(st) ? 'done' : st === 'configuring' ? 'run' : st === 'error' ? 'fail' : 'off',
  ssl: st === 'live' ? 'done' : st === 'ssl_error' ? 'fail' : st === 'configuring' ? 'run' : 'off',
});

const copy = (t, msg = 'Copied') => navigator.clipboard?.writeText(t).then(() => toast.success(msg)).catch(() => {});

/** Super admin: a client's own domain, with automatic DNS check, web-server setup and SSL. */
export default function DomainPanel({ client }) {
  const { data: d, reload } = usePFetch(`/clients/${client.id}/domain`, null, [client.domain]);
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const st = d?.status || (client.domain ? 'pending_dns' : 'none');

  // While setting up, refresh every 4 seconds
  useEffect(() => {
    if (!d || !(d.busy || st === 'configuring')) return undefined;
    const t = setInterval(() => reload(true), 4000);
    return () => clearInterval(t);
  }, [d, st, reload]);

  const check = async (force = false) => {
    setBusy(true);
    try { const r = await ppost(`/clients/${client.id}/domain/check`, { force }); (r.data.status === 'live' ? toast.success : toast)(r.message, { duration: 6000 }); }
    catch (e) { toast.error(e.message); }
    setBusy(false); reload(true);
  };

  if (!client.domain) {
    return (
      <Panel title={<><i className="bi bi-globe2 me-2" />Own domain</>} className="mt-4">
        <p className="small text-muted mb-2">This newspaper opens on the platform address only.</p>
        <Link to={`/superadmin/clients/${client.id}/edit`} className="btn btn-sm btn-light"><i className="bi bi-plus-lg me-1" />Add own domain</Link>
      </Panel>
    );
  }
  const S = STATUS[st] || STATUS.error;
  const steps = stepState(st);
  const srv = d?.server;

  return (
    <Panel title={<><i className="bi bi-globe2 me-2" />Own domain</>} className="mt-4"
      actions={<span className={`dom-badge ${S.cls}`}><i className={`bi bi-${S.icon}`} />{S.label}</span>}>
      <a className="dom-name" href={`https://${client.domain}`} target="_blank" rel="noreferrer">{client.domain}<i className="bi bi-box-arrow-up-right" /></a>

      <ol className="dom-steps">
        {STEPS.map((s) => (
          <li key={s.key} className={steps[s.key]}>
            <span className="dot">{steps[s.key] === 'done' ? <i className="bi bi-check-lg" /> : steps[s.key] === 'fail' ? <i className="bi bi-exclamation-lg" /> : steps[s.key] === 'run' ? <i className="bi bi-arrow-repeat spin" /> : steps[s.key] === 'wait' ? <i className="bi bi-hourglass-split" /> : null}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {d?.message && <div className={`dom-msg ${S.cls}`}>{d.message}</div>}

      {steps.dns !== 'done' && d?.records?.length > 0 && (
        <div className="dom-dns">
          <div className="small fw-semibold mb-1">Add this record at the domain registrar ({d.records[0].zone}):</div>
          <table className="table table-sm mb-1">
            <thead><tr><th>Type</th><th>Name</th><th>Value</th><th>TTL</th></tr></thead>
            <tbody>{d.records.map((r, i) => (
              <tr key={i}><td>{r.type}</td><td><code>{r.host}</code></td>
                <td><code>{r.value}</code>{!r.value.startsWith('<') && <button className="btn btn-link btn-sm p-0 ms-1" title="Copy" onClick={() => copy(r.value, 'IP copied')}><i className="bi bi-copy" /></button>}</td><td>600</td></tr>
            ))}</tbody>
          </table>
          {d.dns_found?.length > 0 && <div className="small text-muted">Found now: {d.dns_found.join(', ')}</div>}
          {!d.server_ips?.length && <div className="small text-warning">Set the server IP in <Link to="/superadmin/settings">Platform settings → Own domains</Link>.</div>}
        </div>
      )}

      {srv && !srv.ready && st !== 'live' && (
        <div className="dom-msg warn"><i className="bi bi-tools me-1" />Automatic setup: {srv.message}</div>
      )}

      <div className="d-flex flex-wrap gap-2 mt-3">
        <button className="btn btn-sm btn-primary" disabled={busy || d?.busy} onClick={() => check(false)}>
          {busy || d?.busy ? <><span className="spinner-border spinner-border-sm me-1" />Checking…</> : <><i className="bi bi-arrow-clockwise me-1" />Check now</>}</button>
        {['ssl_error', 'error', 'manual', 'live'].includes(st) && srv?.ready && (
          <button className="btn btn-sm btn-light" disabled={busy || d?.busy} onClick={() => check(true)} title="Create the website and SSL again"><i className="bi bi-wrench me-1" />Redo setup</button>)}
        {d?.log && <button className="btn btn-sm btn-link" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide' : 'Show'} server log</button>}
      </div>
      {showLog && d?.log && <pre className="dom-log">{d.log}</pre>}
      <div className="small text-muted mt-2">
        {d?.checked_at ? <>Checked {timeAgo(d.checked_at)}. </> : null}
        {st !== 'live' ? 'Re-checked automatically every 10 minutes.' : 'Re-checked daily.'}
      </div>
    </Panel>
  );
}
