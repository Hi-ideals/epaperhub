import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PageHeader, Panel, DataTable, runAction } from '../../components/admin';
import { EmptyState } from '../../components/common';
import { formatBytes } from '../../pages/admin/Backups';
import { ppost, ppatch } from '../../services/api';
import { usePFetch, ClientStatus, fmtDate, siteHref } from '../shared';

export async function loginAsClient(c) {
  const w = window.open('', '_blank');
  try {
    const r = await ppost(`/clients/${c.id}/login-as`);
    // Open the newspaper's admin on this same platform address (works without any DNS setup)
    const url = `${window.location.origin}/n/${r.data.slug}/admin#imp=${encodeURIComponent(r.data.token)}`;
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) { if (w) w.close(); toast.error(e.message); }
}

export const toggleClient = (c, onDone) => runAction(() => ppatch(`/clients/${c.id}/status`, { status: c.status === 'active' ? 'suspended' : 'active' }), c.status === 'active'
  ? { confirmText: `Deactivate ${c.name}? Readers will see an "unavailable" page and its staff can't log in until you activate it again. No data is deleted.`, button: 'Deactivate', onDone }
  : { confirmText: `Activate ${c.name} again?`, button: 'Activate', variant: 'success', onDone });

export default function Clients() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const status = params.get('status') || '';
  const { data, loading, error, reload } = usePFetch('/clients', { q, status });
  const rows = data || [];
  const tabs = [['', 'All'], ['active', 'Active'], ['expired', 'Expired'], ['suspended', 'Deactivated']];

  const cols = [
    { key: 'name', label: 'Newspaper', render: (c) => (
      <div className="d-flex align-items-center gap-2">
        <span className="sa-avatar">{c.name[0]}</span>
        <div className="min-w-0"><Link to={`/superadmin/clients/${c.id}`} className="fw-semibold">{c.name}</Link>
          <div className="small text-muted text-truncate">{c.domain || `/n/${c.slug}`}</div></div>
      </div>) },
    { key: 'owner', label: 'Owner', render: (c) => <><div>{c.owner_name || '—'}</div><div className="small text-muted">{c.owner_email}</div></> },
    { key: 'plan', label: 'Plan', render: (c) => <span className="sa-plan-tag">{c.plan_name || 'Custom'}</span> },
    { key: 'expires', label: 'Valid until', render: (c) => fmtDate(c.expires_at) },
    { key: 'storage', label: 'Storage', render: (c) => {
      const max = c.limits.storage_mb * 1048576; const pct = max ? Math.min(100, Math.round((c.storage_used_bytes / max) * 100)) : 0;
      return <div style={{ minWidth: 120 }}><div className="small">{formatBytes(c.storage_used_bytes)} <span className="text-muted">/ {formatBytes(max)}</span></div><div className="plan-bar"><span className={pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : ''} style={{ width: `${Math.max(pct, 2)}%` }} /></div></div>;
    } },
    { key: 'status', label: 'Status', render: (c) => <ClientStatus c={c} /> },
    { key: 'a', label: '', className: 'text-end text-nowrap', render: (c) => (<>
      <a href={siteHref(c)} target="_blank" rel="noreferrer" className="btn btn-sm btn-light btn-icon me-1" title="Open newspaper website"><i className="bi bi-box-arrow-up-right" /></a>
      <button className="btn btn-sm btn-light btn-icon me-1" title="Login as client (open its admin panel)" aria-label="Login as client" onClick={() => loginAsClient(c)}><i className="bi bi-person-gear" /></button>
      <button className={`btn btn-sm btn-icon me-1 ${c.status === 'active' ? 'btn-light text-danger' : 'btn-success'}`} title={c.status === 'active' ? 'Deactivate' : 'Activate'} aria-label={c.status === 'active' ? 'Deactivate' : 'Activate'} onClick={() => toggleClient(c, () => reload(true))}><i className={`bi bi-${c.status === 'active' ? 'pause-circle' : 'play-circle'}`} /></button>
      <Link to={`/superadmin/clients/${c.id}`} className="btn btn-sm btn-primary">Manage</Link>
    </>) },
  ];

  return (
    <>
      <PageHeader title="Clients (Newspapers)" subtitle="Each client has its own newspaper, admin panel, database and files"
        actions={<Link to="/superadmin/clients/new" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Add client</Link>} />
      <Panel bodyClass="" title={
        <ul className="nav nav-tabs border-0">{tabs.map(([k, l]) => <li key={k} className="nav-item"><button className={`nav-link ${status === k ? 'active' : ''}`} onClick={() => setParams(k ? { status: k } : {})}>{l}</button></li>)}</ul>
      } actions={<div className="input-group input-group-sm search"><span className="input-group-text"><i className="bi bi-search" /></span><input className="form-control" placeholder="Search name, address, email" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
        <DataTable columns={cols} rows={rows} loading={loading} error={error} onRetry={reload}
          empty={<EmptyState icon="buildings" title="No clients yet" text="Add your first newspaper client." action={<Link to="/superadmin/clients/new" className="btn btn-primary">Add client</Link>} />} />
      </Panel>
    </>
  );
}
