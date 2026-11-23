import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PageHeader, Panel } from '../../components/admin';
import { Field, Modal, Spinner, ErrorState } from '../../components/common';
import { formatBytes } from '../../pages/admin/Backups';
import { formatDateTime, timeAgo } from '../../utils/format';
import { ppost } from '../../services/api';
import { usePFetch, ClientStatus, fmtDate, money, mbText, daysLeft, siteHref, sitePath } from '../shared';
import { loginAsClient, toggleClient } from './Clients';
import DomainPanel from '../DomainPanel';
import StoragePanel from '../../components/admin/StoragePanel';
import { pget } from '../../services/api';

async function copy(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast.success(what); } catch { toast.error('Could not copy'); }
}

/** Password shown as dots, with show/hide and copy. */
function Secret({ value }) {
  const [show, setShow] = useState(false);
  return (
    <span className="sa-secret">
      <code>{show ? value : '•'.repeat(Math.min(12, value.length))}</code>
      <button type="button" className="btn btn-sm btn-light btn-icon" title={show ? 'Hide' : 'Show password'} aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((x) => !x)}><i className={`bi bi-eye${show ? '-slash' : ''}`} /></button>
      <button type="button" className="btn btn-sm btn-light btn-icon" title="Copy password" aria-label="Copy password" onClick={() => copy(value, 'Password copied')}><i className="bi bi-copy" /></button>
    </span>
  );
}

function Meter({ label, used, max, fmt = (n) => n }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="plan-meter mb-3">
      <div className="d-flex justify-content-between small"><span className="fw-semibold">{label}</span><span className="text-muted">{fmt(used)} / {max ? fmt(max) : 'Unlimited'}</span></div>
      <div className="plan-bar"><span style={{ width: `${max ? Math.max(pct, 2) : 4}%` }} className={pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : ''} /></div>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: c, error, reload } = usePFetch(`/clients/${id}`);
  const { data: plans, meta: plansMeta } = usePFetch('/plans');
  const features = plansMeta?.features || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!c) return <Spinner className="py-5" />;
  const open = (m, init = {}) => { setForm(init); setErrors({}); setModal(m); };
  const submit = async (url, body, after) => {
    setBusy(true); setErrors({});
    try { const r = await ppost(url, body); toast.success(r.message); setModal(null); after ? after(r) : reload(true); } catch (e) { setErrors(e.errors || {}); toast.error(e.message); }
    setBusy(false);
  };
  const d = daysLeft(c.expires_at);
  const s = c.stats || {};

  return (
    <>
      <PageHeader title={c.name} crumbs={[{ label: 'Clients', to: '/superadmin/clients' }]} subtitle={<><ClientStatus c={c} /> <span className="ms-2 text-muted">Client since {fmtDate(c.created_at)}</span></>}
        actions={<>
          <a href={siteHref(c)} target="_blank" rel="noreferrer" className="btn btn-light"><i className="bi bi-box-arrow-up-right me-1" />Open website</a>
          <button className="btn btn-light" onClick={() => loginAsClient(c)}><i className="bi bi-person-gear me-1" />Login as client</button>
          <Link to={`/superadmin/clients/${c.id}/edit`} className="btn btn-primary"><i className="bi bi-pencil me-1" />Edit</Link>
        </>} />

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="row g-3 mb-4">
            <div className="col-md-4"><div className="sa-tile"><span>Plan</span><b>{c.plan_name || 'Custom'}</b><button className="btn btn-sm btn-link p-0" onClick={() => open('renew', { plan_id: c.plan_id || plans?.[0]?.id || '', months: '', mode: 'months', use_plan_limits: false })}>Renew / change plan</button></div></div>
            <div className="col-md-4"><div className="sa-tile"><span>Valid until</span><b>{fmtDate(c.expires_at)}</b><small className={d !== null && d < 0 ? 'text-danger' : 'text-muted'}>{d === null ? 'No expiry' : d < 0 ? `Expired ${-d} day${d === -1 ? '' : 's'} ago` : `${d} day${d === 1 ? '' : 's'} left`}</small></div></div>
            <div className="col-md-4"><div className="sa-tile"><span>Editions</span><b>{s.editions ?? '—'}</b><small className="text-muted">{s.published ?? 0} published{s.last_published ? ` · last ${timeAgo(s.last_published)}` : ''}</small></div></div>
          </div>

          <Panel title={<><i className="bi bi-speedometer me-2" />Usage & limits</>}>
            <Meter label="Storage" used={c.storage_used_bytes} max={c.limits.storage_mb * 1048576} fmt={formatBytes} />
            <Meter label="Admin users" used={s.staff || 0} max={c.limits.max_admin_users} />
            <div className="small text-muted">Editions per month: <b>{c.limits.max_editions_per_month || 'Unlimited'}</b> · Readers registered: <b>{s.readers ?? 0}</b>
              {(c.storage_mb !== null || c.max_admin_users !== null || c.max_editions_per_month !== null) && <span className="sa-pill warn ms-2">Custom limits</span>}</div>
          </Panel>

          <StoragePanel className="mt-4" load={() => pget(`/clients/${c.id}/storage`).then((r) => r.data)} run={() => ppost(`/clients/${c.id}/storage/optimize`, {})} />

          <Panel title={<><i className="bi bi-grid-3x3-gap me-2" />Modules</>} className="mt-4" actions={Array.isArray(c.modules) ? <span className="sa-pill warn">Custom for this client</span> : <span className="small text-muted">From the plan</span>}>
            <div className="plan-features">
              {features.map((f) => <span key={f.key} className={c.features.includes(f.key) ? 'on' : 'off'}><i className={`bi bi-${c.features.includes(f.key) ? 'check-circle-fill' : 'x-circle'}`} />{f.label}</span>)}
            </div>
          </Panel>

          <Panel title={<><i className="bi bi-people me-2" />Admin accounts in this newspaper</>} className="mt-4" bodyClass=""
            actions={<button className="btn btn-sm btn-light" onClick={() => open('password', { email: c.owner_email, password: '' })}><i className="bi bi-key me-1" />Reset a password</button>}>
            <div className="sa-login-box">
              <div><span className="small text-muted d-block">Admin login page</span><a href={`${siteHref(c)}/admin`} target="_blank" rel="noreferrer" className="text-break">{siteHref(c).replace(/^https?:\/\//, '')}/admin</a></div>
              {(() => { const o = (s.admins || []).find((u) => u.password); return o ? (
                <button className="btn btn-sm btn-primary" onClick={() => copy(`${c.name} – admin login\nLink: ${siteHref(c)}/admin\nUsername: ${o.email}\nPassword: ${o.password}`, 'Login details copied')}><i className="bi bi-clipboard-check me-1" />Copy login details</button>
              ) : null; })()}
            </div>
            <div className="table-responsive"><table className="table align-middle mb-0 rt">
              <thead><tr><th>Name</th><th>Username (email)</th><th>Password</th><th>Role</th><th>Last login</th></tr></thead>
              <tbody>{(s.admins || []).map((u) => (
                <tr key={u.id}>
                  <td className="rt-head fw-semibold">{u.name}</td>
                  <td data-label="Username"><span className="sa-secret"><span className="text-break">{u.email}</span><button type="button" className="btn btn-sm btn-light btn-icon" title="Copy username" aria-label="Copy username" onClick={() => copy(u.email, 'Username copied')}><i className="bi bi-copy" /></button></span></td>
                  <td data-label="Password">{u.password ? <Secret value={u.password} /> : (
                    <span className="small text-muted">Changed by the client · <button className="btn btn-link btn-sm p-0 align-baseline" onClick={() => open('password', { email: u.email, password: '' })}>set a new one</button></span>
                  )}</td>
                  <td data-label="Role">{u.role_name}</td>
                  <td data-label="Last login">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="small text-muted px-3 py-2"><i className="bi bi-shield-lock me-1" />Only passwords you set here are shown. If the client changes their password, it is hidden and you can set a new one.</div>
          </Panel>
        </div>

        <div className="col-lg-4">
          <Panel title={<><i className="bi bi-link-45deg me-2" />Addresses</>}>
            <div className="sa-kv"><span>Platform address</span><a href={sitePath(c)} target="_blank" rel="noreferrer" className="text-break">{sitePath(c).replace(/^https?:\/\//, '')}</a></div>
            <div className="sa-kv"><span>Own domain</span>{c.domain ? <a href={`${c.site_url}`} target="_blank" rel="noreferrer">{c.domain}</a> : <span className="text-muted">Not set</span>}</div>
            <div className="sa-kv"><span>Admin panel</span><span className="text-break small">{siteHref(c).replace(/^https?:\/\//, '')}/admin</span></div>
          </Panel>
          <DomainPanel client={c} />
          <Panel title={<><i className="bi bi-person-badge me-2" />Owner</>} className="mt-4">
            <div className="sa-kv"><span>Name</span><b>{c.owner_name || '—'}</b></div>
            <div className="sa-kv"><span>Email</span><a href={`mailto:${c.owner_email}`}>{c.owner_email}</a></div>
            <div className="sa-kv"><span>Phone</span><span>{c.owner_phone || '—'}</span></div>
            {c.notes && <div className="sa-note mt-2"><i className="bi bi-sticky me-1" />{c.notes}</div>}
          </Panel>
          <Panel title={<><i className="bi bi-toggles me-2" />Actions</>} className="mt-4">
            <div className="d-grid gap-2">
              <button className={`btn ${c.status === 'active' ? 'btn-outline-danger' : 'btn-success'}`} onClick={() => toggleClient(c, () => reload(true))}>
                <i className={`bi bi-${c.status === 'active' ? 'pause-circle' : 'play-circle'} me-1`} />{c.status === 'active' ? 'Deactivate client' : 'Activate client'}</button>
              <button className="btn btn-light" onClick={() => open('renew', { plan_id: c.plan_id || plans?.[0]?.id || '', months: '', mode: 'months', use_plan_limits: false })}><i className="bi bi-arrow-repeat me-1" />Renew plan</button>
              <button className="btn btn-light text-danger" onClick={() => open('delete', { confirm: '' })}><i className="bi bi-trash me-1" />Delete client permanently</button>
            </div>
          </Panel>
          <Panel title={<><i className="bi bi-clock-history me-2" />History</>} className="mt-4">
            {!c.activity?.length ? <p className="text-muted small mb-0">No activity yet.</p> : <ul className="sa-activity">{c.activity.map((a) => <li key={a.id}>{a.action.replace(/[._]/g, ' ')}<span className="d-block small text-muted">{a.admin_name || 'System'} · {formatDateTime(a.created_at)}</span></li>)}</ul>}
          </Panel>
        </div>
      </div>

      <Modal show={modal === 'renew'} onClose={() => setModal(null)} title="Renew / change plan" footer={<>
        <button className="btn btn-light" onClick={() => setModal(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || (form.mode === 'date' && !form.expires_at)} onClick={() => submit(`/clients/${c.id}/renew`, {
          plan_id: form.plan_id, use_plan_limits: !!form.use_plan_limits,
          ...(form.mode === 'date' ? { expires_at: form.expires_at } : { months: form.months }),
        })}>{busy && <span className="spinner-border spinner-border-sm me-2" />}Save</button></>}>
        {(() => {
          const plan = (plans || []).find((p) => String(p.id) === String(form.plan_id));
          const months = Number(form.months) || plan?.duration_months || 12;
          const today = new Date().toISOString().slice(0, 10);
          const running = c.expires_at && c.expires_at >= today;
          const nd = new Date(`${running ? c.expires_at : today}T12:00:00`); nd.setMonth(nd.getMonth() + months); if (!running) nd.setDate(nd.getDate() - 1);
          const preview = form.mode === 'date' ? form.expires_at : nd.toISOString().slice(0, 10);
          const hasCustom = c.storage_mb !== null || c.max_admin_users !== null || c.max_editions_per_month !== null || Array.isArray(c.modules);
          return (<>
            <Field label="Plan" error={errors.plan_id}><select className="form-select" value={form.plan_id || ''} onChange={(e) => setForm({ ...form, plan_id: e.target.value, months: '' })}>
              {(plans || []).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price, p.currency)} / {p.duration_months} months · {mbText(p.storage_mb)}</option>)}</select></Field>
            <div className="btn-group w-100 mb-3" role="group" aria-label="How to set validity">
              <button type="button" className={`btn btn-sm ${form.mode !== 'date' ? 'btn-primary' : 'btn-light border'}`} onClick={() => setForm({ ...form, mode: 'months' })}>Extend by months</button>
              <button type="button" className={`btn btn-sm ${form.mode === 'date' ? 'btn-primary' : 'btn-light border'}`} onClick={() => setForm({ ...form, mode: 'date', expires_at: form.expires_at || c.expires_at || today })}>Set exact date</button>
            </div>
            {form.mode === 'date' ? (
              <Field label="Valid until" error={errors.expires_at}><input type="date" className="form-control" value={form.expires_at || ''} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></Field>
            ) : (
              <Field label="Months" error={errors.months} help={`Leave empty for the plan's ${plan?.duration_months || 12} months. Added ${running ? `after the current expiry (${fmtDate(c.expires_at)})` : 'from today'}.`}>
                <input type="number" min="1" max="120" className="form-control" placeholder={plan?.duration_months || 12} value={form.months || ''} onChange={(e) => setForm({ ...form, months: e.target.value })} /></Field>
            )}
            {hasCustom && (
              <label className="sa-mod on mb-3" style={{ cursor: 'pointer' }}>
                <input type="checkbox" className="form-check-input" checked={!!form.use_plan_limits} onChange={(e) => setForm({ ...form, use_plan_limits: e.target.checked })} />
                <span><b>Use this plan's limits & modules</b><span className="d-block small text-muted">This client has custom {[c.storage_mb !== null && `storage (${mbText(c.storage_mb)})`, (c.max_admin_users !== null || c.max_editions_per_month !== null) && 'user/edition limits', Array.isArray(c.modules) && 'modules'].filter(Boolean).join(', ')} that override the plan. Tick to remove them.</span></span>
              </label>
            )}
            <div className="sa-renew-preview"><span>New valid until</span><b>{preview ? fmtDate(preview) : '—'}</b>{plan && <small>{plan.name} · {mbText(form.use_plan_limits || !hasCustom || c.storage_mb === null ? plan.storage_mb : c.storage_mb)} storage</small>}</div>
          </>);
        })()}
      </Modal>

      <Modal show={modal === 'password'} onClose={() => setModal(null)} title="Reset an admin password" footer={<>
        <button className="btn btn-light" onClick={() => setModal(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => submit(`/clients/${c.id}/reset-password`, form)}>Set password</button></>}>
        <Field label="Admin email" error={errors.email}><select className="form-select" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })}>{(s.admins || []).map((u) => <option key={u.id} value={u.email}>{u.name} — {u.email}</option>)}</select></Field>
        <Field label="New password" error={errors.password} help="At least 8 characters with a letter and a number. They will be logged out everywhere."><input className="form-control" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
      </Modal>

      <Modal show={modal === 'delete'} onClose={() => setModal(null)} title={<span className="text-danger">Delete {c.name}?</span>} footer={<>
        <button className="btn btn-light" onClick={() => setModal(null)}>Cancel</button>
        <button className="btn btn-danger" disabled={busy || form.confirm !== c.slug} onClick={() => submit(`/clients/${c.id}/delete`, form, () => navigate('/superadmin/clients'))}>Delete everything</button></>}>
        <div className="alert alert-danger small">This permanently deletes the newspaper's <b>database, all editions, page images, users and backups</b>. It cannot be undone. To pause a client instead, use <b>Deactivate</b>.</div>
        <Field label={<>Type <code>{c.slug}</code> to confirm</>}><input className="form-control" value={form.confirm || ''} onChange={(e) => setForm({ ...form, confirm: e.target.value.trim().toLowerCase() })} /></Field>
      </Modal>
    </>
  );
}
