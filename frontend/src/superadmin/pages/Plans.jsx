import { useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, runAction, Switch } from '../../components/admin';
import { Field, Modal, Spinner, EmptyState } from '../../components/common';
import { ppost, pput, pdel } from '../../services/api';
import { usePFetch, ModulePicker, money, mbText } from '../shared';

const EMPTY = { name: '', description: '', price: 0, currency: 'INR', duration_months: 12, storage_gb: 5, max_admin_users: 5, max_editions_per_month: 0, modules: [], is_active: true, sort_order: 0 };

export default function Plans() {
  const { data, meta, loading, reload } = usePFetch('/plans');
  const features = meta?.features || [];
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setEdit((x) => ({ ...x, [k]: v }));

  const openPlan = (p) => { setErrors({}); setEdit(p ? { ...p, storage_gb: +(p.storage_mb / 1024).toFixed(2) } : { ...EMPTY, modules: features.map((f) => f.key), sort_order: (data?.length || 0) + 1 }); };
  const save = async () => {
    setBusy(true); setErrors({});
    const body = { ...edit, storage_mb: Math.round(Number(edit.storage_gb) * 1024) };
    try { const r = edit.id ? await pput(`/plans/${edit.id}`, body) : await ppost('/plans', body); toast.success(r.message); setEdit(null); reload(true); } catch (e) { setErrors(e.errors || {}); toast.error(e.message); }
    setBusy(false);
  };

  return (
    <>
      <PageHeader title="Subscription plans" subtitle="Create as many plans as you like. Each client is assigned one; you can still give a client custom limits."
        actions={<button className="btn btn-primary" onClick={() => openPlan(null)}><i className="bi bi-plus-lg me-1" />New plan</button>} />
      {loading && !data ? <Spinner className="py-5" /> : !data?.length ? <EmptyState icon="gem" title="No plans yet" action={<button className="btn btn-primary" onClick={() => openPlan(null)}>Create a plan</button>} /> : (
        <div className="sa-plans">
          {data.map((p) => (
            <div key={p.id} className={`sa-plan-card ${p.is_active ? '' : 'inactive'}`}>
              <div className="sa-plan-top">
                <div><h3>{p.name}</h3>{!p.is_active && <span className="sa-pill off">Inactive</span>}</div>
                <div className="sa-price">{money(p.price, p.currency)}<span>/ {p.duration_months === 12 ? 'year' : `${p.duration_months} months`}</span></div>
                {p.description && <p>{p.description}</p>}
              </div>
              <ul className="sa-plan-limits">
                <li><i className="bi bi-hdd" />{mbText(p.storage_mb)} storage</li>
                <li><i className="bi bi-people" />{p.max_admin_users ? `${p.max_admin_users} admin users` : 'Unlimited admin users'}</li>
                <li><i className="bi bi-journal-text" />{p.max_editions_per_month ? `${p.max_editions_per_month} editions / month` : 'Unlimited editions'}</li>
              </ul>
              <div className="sa-plan-mods">{features.map((f) => <span key={f.key} className={p.modules.includes(f.key) ? 'on' : 'off'}><i className={`bi bi-${p.modules.includes(f.key) ? 'check-lg' : 'x-lg'}`} />{f.label}</span>)}</div>
              <div className="sa-plan-foot">
                <span className="small text-muted">{p.clients} client{p.clients === 1 ? '' : 's'}</span>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-light text-danger" onClick={() => runAction(() => pdel(`/plans/${p.id}`), { confirmText: `Delete the ${p.name} plan?`, button: 'Delete', onDone: () => reload(true) })}><i className="bi bi-trash" /></button>
                  <button className="btn btn-sm btn-primary" onClick={() => openPlan(p)}><i className="bi bi-pencil me-1" />Edit</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal show={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? `Edit plan: ${edit.name}` : 'New plan'} footer={<>
        <button className="btn btn-light" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner-border spinner-border-sm me-2" />}Save plan</button></>}>
        {edit && (<>
          <div className="row g-3">
            <div className="col-md-6"><Field label="Plan name" error={errors.name} className="mb-0"><input className="form-control" value={edit.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Standard" /></Field></div>
            <div className="col-md-3"><Field label="Price" error={errors.price} className="mb-0"><input type="number" min="0" className="form-control" value={edit.price} onChange={(e) => set('price', e.target.value)} /></Field></div>
            <div className="col-md-3"><Field label="Duration (months)" error={errors.duration_months} className="mb-0"><input type="number" min="1" className="form-control" value={edit.duration_months} onChange={(e) => set('duration_months', e.target.value)} /></Field></div>
            <div className="col-12"><Field label="Short description" error={errors.description} className="mb-0"><input className="form-control" value={edit.description || ''} onChange={(e) => set('description', e.target.value)} /></Field></div>
            <div className="col-md-4"><Field label="Storage (GB)" error={errors.storage_mb} className="mb-0" help="Page images, originals, logos, clips"><input type="number" min="0.05" step="0.5" className="form-control" value={edit.storage_gb} onChange={(e) => set('storage_gb', e.target.value)} /></Field></div>
            <div className="col-md-4"><Field label="Admin users" error={errors.max_admin_users} className="mb-0" help="0 = unlimited"><input type="number" min="0" className="form-control" value={edit.max_admin_users} onChange={(e) => set('max_admin_users', e.target.value)} /></Field></div>
            <div className="col-md-4"><Field label="Editions per month" error={errors.max_editions_per_month} className="mb-0" help="0 = unlimited"><input type="number" min="0" className="form-control" value={edit.max_editions_per_month} onChange={(e) => set('max_editions_per_month', e.target.value)} /></Field></div>
          </div>
          <label className="form-label mt-3">Modules included</label>
          <ModulePicker features={features} value={edit.modules} onChange={(m) => set('modules', m)} />
          <div className="mt-3"><Switch label="Available for new clients" checked={edit.is_active} onChange={(v) => set('is_active', v)} help="Inactive plans stay on existing clients but can't be chosen for new ones." /></div>
        </>)}
      </Modal>
    </>
  );
}
