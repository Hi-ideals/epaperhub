import { Link } from 'react-router-dom';
import { PageHeader, Panel, StatCard } from '../../components/admin';
import { formatBytes } from '../../pages/admin/Backups';
import { timeAgo } from '../../utils/format';
import { usePFetch, money, fmtDate, daysLeft } from '../shared';
import { usePlatformAuth } from '../SuperAdminApp';

export default function Dashboard() {
  const { admin } = usePlatformAuth();
  const { data: d } = usePFetch('/dashboard');
  return (
    <>
      <PageHeader title="Platform dashboard" subtitle={`Welcome, ${admin.name}. All newspapers at a glance.`}
        actions={<Link to="/superadmin/clients/new" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Add client</Link>} />
      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard icon="buildings" label="Total clients" value={d?.clients.total ?? '…'} color="#6366f1" to="/superadmin/clients" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard icon="check2-circle" label="Active" value={d?.clients.active ?? '…'} color="#16a34a" to="/superadmin/clients?status=active" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard icon="hourglass-bottom" label="Expired" value={d?.clients.expired ?? '…'} color="#ea580c" to="/superadmin/clients?status=expired" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard icon="pause-circle" label="Deactivated" value={d?.clients.suspended ?? '…'} color="#e11d48" to="/superadmin/clients?status=suspended" /></div>
      </div>
      <div className="row g-4">
        <div className="col-lg-7">
          <Panel title={<><i className="bi bi-alarm me-2" />Plans expiring in the next 30 days</>}>
            {!d ? <div className="text-muted">Loading…</div> : !d.expiring.length ? <p className="text-muted mb-0">No plans expire in the next 30 days.</p> : (
              <div className="sa-list">
                {d.expiring.map((c) => { const n = daysLeft(c.expires_at); return (
                  <Link key={c.id} to={`/superadmin/clients/${c.id}`} className="sa-list-item">
                    <span className="sa-avatar">{c.name[0]}</span>
                    <span className="flex-grow-1"><b>{c.name}</b><span className="d-block small text-muted">{c.plan_name || 'No plan'} · expires {fmtDate(c.expires_at)}</span></span>
                    <span className={`sa-pill ${n <= 7 ? 'exp' : 'warn'}`}>{n} day{n === 1 ? '' : 's'}</span>
                  </Link>
                ); })}
              </div>
            )}
          </Panel>
          <Panel title={<><i className="bi bi-clock-history me-2" />Recent activity</>} className="mt-4" actions={<Link to="/superadmin/activity" className="btn btn-sm btn-light">View all</Link>}>
            {!d ? null : !d.activity.length ? <p className="text-muted mb-0">No activity yet.</p> : (
              <ul className="sa-activity">{d.activity.map((a) => <li key={a.id}><b>{a.admin_name || 'System'}</b> {a.action.replace(/[._]/g, ' ')}{a.tenant_name ? <> · <span className="text-muted">{a.tenant_name}</span></> : null}<span className="float-end small text-muted">{timeAgo(a.created_at)}</span></li>)}</ul>
            )}
          </Panel>
        </div>
        <div className="col-lg-5">
          <Panel title={<><i className="bi bi-graph-up-arrow me-2" />Platform</>}>
            <div className="sa-kv"><span>Yearly value of active plans</span><b>{d ? money(d.yearly_value) : '…'}</b></div>
            <div className="sa-kv"><span>Storage used by all clients</span><b>{d ? formatBytes(d.storage_bytes) : '…'}</b></div>
          </Panel>
          <Panel title={<><i className="bi bi-gem me-2" />Clients per plan</>} className="mt-4" actions={<Link to="/superadmin/plans" className="btn btn-sm btn-light">Manage plans</Link>}>
            {d?.plans.map((p) => {
              const pct = d.clients.total ? Math.round((p.clients / d.clients.total) * 100) : 0;
              return <div key={p.id} className="mb-3"><div className="d-flex justify-content-between small"><b>{p.name}</b><span className="text-muted">{p.clients} client{p.clients === 1 ? '' : 's'}</span></div><div className="plan-bar mt-1"><span style={{ width: `${Math.max(pct, 3)}%` }} /></div></div>;
            })}
          </Panel>
        </div>
      </div>
    </>
  );
}
