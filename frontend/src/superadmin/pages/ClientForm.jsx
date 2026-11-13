import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PageHeader, Panel, Switch } from '../../components/admin';
import { Field, Spinner } from '../../components/common';
import { pget, ppost, pput } from '../../services/api';
import { usePFetch, ModulePicker, money, mbText } from '../shared';

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
const today = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso, m) => { const d = new Date(`${iso}T12:00:00`); d.setMonth(d.getMonth() + m); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const genPassword = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; let p = ''; for (let i = 0; i < 10; i++) p += c[Math.floor(Math.random() * c.length)]; return `${p}@${Math.floor(Math.random() * 90 + 10)}`; };

const EMPTY = {
  name: '', slug: '', domain: '', owner_name: '', owner_email: '', owner_phone: '', admin_password: '', send_welcome: true,
  plan_id: '', status: 'active', starts_at: today(), expires_at: '', notes: '',
  custom_limits: false, storage_mb: '', max_admin_users: '', max_editions_per_month: '',
  custom_modules: false, modules: [],
};

export default function ClientForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { data: plans, meta } = usePFetch('/plans');
  const features = meta?.features || [];
  const [v, setV] = useState(isNew ? EMPTY : null);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [expTouched, setExpTouched] = useState(!isNew);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    pget(`/clients/${id}`).then((r) => {
      const c = r.data;
      setV({
        ...EMPTY, ...c, domain: c.domain || '', owner_name: c.owner_name || '', owner_phone: c.owner_phone || '', notes: c.notes || '', plan_id: c.plan_id || '',
        starts_at: c.starts_at || '', expires_at: c.expires_at || '',
        custom_limits: c.storage_mb !== null || c.max_admin_users !== null || c.max_editions_per_month !== null,
        storage_mb: c.storage_mb ?? '', max_admin_users: c.max_admin_users ?? '', max_editions_per_month: c.max_editions_per_month ?? '',
        custom_modules: Array.isArray(c.modules), modules: c.modules || c.features || [],
      });
    }).catch((e) => toast.error(e.message));
  }, [id, isNew]);

  const plan = useMemo(() => (plans || []).find((p) => String(p.id) === String(v?.plan_id)), [plans, v?.plan_id]);
  // New client: pick the first plan and fill the expiry from its duration
  useEffect(() => { if (isNew && plans?.length && v && !v.plan_id) setV((x) => ({ ...x, plan_id: plans.find((p) => p.is_active)?.id || plans[0].id })); }, [plans]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (v && plan && !expTouched && v.starts_at) setV((x) => ({ ...x, expires_at: addMonths(x.starts_at, plan.duration_months) })); }, [plan?.id, v?.starts_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return <Spinner className="py-5" />;
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErrors({});
    const body = {
      name: v.name, slug: v.slug, domain: v.domain, owner_name: v.owner_name, owner_email: v.owner_email, owner_phone: v.owner_phone,
      plan_id: v.plan_id, status: v.status, starts_at: v.starts_at, expires_at: v.expires_at, notes: v.notes,
      storage_mb: v.custom_limits ? v.storage_mb : null, max_admin_users: v.custom_limits ? v.max_admin_users : null, max_editions_per_month: v.custom_limits ? v.max_editions_per_month : null,
      modules: v.custom_modules ? v.modules : null,
    };
    if (isNew) Object.assign(body, { admin_password: v.admin_password, send_welcome: v.send_welcome });
    try {
      const r = isNew ? await ppost('/clients', body) : await pput(`/clients/${id}`, body);
      toast.success(r.message);
      navigate(`/superadmin/clients/${r.data.id}`);
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); }
    setBusy(false);
  };

  const base = `${window.location.origin}/n/`;
  return (
    <form onSubmit={submit}>
      <PageHeader title={isNew ? 'Add client' : `Edit: ${v.name}`} crumbs={[{ label: 'Clients', to: '/superadmin/clients' }]}
        subtitle={isNew ? 'Creates the newspaper, its own database, and its first admin login' : undefined} />
      <div className="row g-4">
        <div className="col-xl-7">
          <Panel title={<><i className="bi bi-newspaper me-2" />Newspaper</>}>
            <Field label="Newspaper name" error={errors.name} required>
              <input className="form-control" value={v.name} required onChange={(e) => { set('name', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }} placeholder="e.g. Kashi Putra" />
            </Field>
            <Field label="Web address" error={errors.slug} help="Readers can always open the newspaper here — no domain setup needed.">
              <div className="input-group"><span className="input-group-text small">{base}</span>
                <input className="form-control" value={v.slug} required onChange={(e) => { setSlugTouched(true); set('slug', slugify(e.target.value)); }} placeholder="kashiputra" /></div>
            </Field>
            <Field label="Own domain (optional)" error={errors.domain} help="e.g. epaper.kashiputra.com — point this domain's DNS (A record) to your server. The newspaper then also opens on its own domain.">
              <input className="form-control" value={v.domain} onChange={(e) => set('domain', e.target.value)} placeholder="epaper.example.com" />
            </Field>
          </Panel>

          <Panel title={<><i className="bi bi-person-badge me-2" />Owner & admin login</>} className="mt-4">
            <div className="row g-3">
              <div className="col-md-6"><Field label="Owner name" error={errors.owner_name} className="mb-0"><input className="form-control" value={v.owner_name} onChange={(e) => set('owner_name', e.target.value)} /></Field></div>
              <div className="col-md-6"><Field label="Phone" error={errors.owner_phone} className="mb-0"><input className="form-control" value={v.owner_phone} onChange={(e) => set('owner_phone', e.target.value)} /></Field></div>
              <div className="col-md-6"><Field label={isNew ? 'Admin email (login)' : 'Owner email'} error={errors.owner_email} className="mb-0"><input type="email" className="form-control" value={v.owner_email} required onChange={(e) => set('owner_email', e.target.value)} /></Field></div>
              {isNew && <div className="col-md-6"><Field label="Admin password" error={errors.admin_password} className="mb-0">
                <div className="input-group"><input className="form-control" value={v.admin_password} required minLength={8} onChange={(e) => set('admin_password', e.target.value)} />
                  <button type="button" className="btn btn-outline-secondary" onClick={() => set('admin_password', genPassword())}><i className="bi bi-magic me-1" />Generate</button></div></Field></div>}
            </div>
            {isNew && <div className="mt-3"><Switch label="Email the login details to the owner" checked={v.send_welcome} onChange={(x) => set('send_welcome', x)} help="Uses the Platform Email (SMTP) settings." /></div>}
          </Panel>

          <Panel title={<><i className="bi bi-sticky me-2" />Notes</>} className="mt-4">
            <textarea className="form-control" rows="3" value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Payment received, invoice number, contact person… (only super admins see this)" />
          </Panel>
        </div>

        <div className="col-xl-5">
          <Panel title={<><i className="bi bi-gem me-2" />Plan & validity</>}>
            <div className="sa-plan-pick mb-3">
              {(plans || []).filter((p) => p.is_active || String(p.id) === String(v.plan_id)).map((p) => (
                <label key={p.id} className={`sa-plan-opt ${String(v.plan_id) === String(p.id) ? 'on' : ''}`}>
                  <input type="radio" name="plan" className="d-none" checked={String(v.plan_id) === String(p.id)} onChange={() => set('plan_id', p.id)} />
                  <b>{p.name}</b><span>{money(p.price, p.currency)} / {p.duration_months} mo</span><small>{mbText(p.storage_mb)} · {p.max_admin_users || '∞'} admins</small>
                </label>
              ))}
            </div>
            {errors.plan_id && <div className="text-danger small mb-2">{errors.plan_id}</div>}
            <div className="row g-3">
              <div className="col-6"><Field label="Start date" error={errors.starts_at} className="mb-0"><input type="date" className="form-control" value={v.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></Field></div>
              <div className="col-6"><Field label="Valid until" error={errors.expires_at} className="mb-0"><input type="date" className="form-control" value={v.expires_at} onChange={(e) => { setExpTouched(true); set('expires_at', e.target.value); }} /></Field></div>
            </div>
            <div className="form-text">Filled from the plan's duration. Leave empty for no expiry.</div>
            <div className="mt-3"><Switch label="Active" checked={v.status === 'active'} onChange={(x) => set('status', x ? 'active' : 'suspended')} help="Turn off to deactivate: readers see an “unavailable” page and staff can't log in." /></div>
          </Panel>

          <Panel title={<><i className="bi bi-sliders me-2" />Limits</>} className="mt-4">
            <Switch label="Custom limits for this client" checked={v.custom_limits} onChange={(x) => set('custom_limits', x)}
              help={plan ? `Plan limits: ${mbText(plan.storage_mb)} storage, ${plan.max_admin_users || 'unlimited'} admin users, ${plan.max_editions_per_month || 'unlimited'} editions/month` : 'Otherwise the plan limits apply'} />
            {v.custom_limits && (
              <div className="row g-3 mt-1">
                <div className="col-sm-4"><Field label="Storage (MB)" error={errors.storage_mb} className="mb-0"><input type="number" min="50" className="form-control" value={v.storage_mb} placeholder={plan?.storage_mb} onChange={(e) => set('storage_mb', e.target.value)} /></Field></div>
                <div className="col-sm-4"><Field label="Admin users" error={errors.max_admin_users} className="mb-0" help="0 = unlimited"><input type="number" min="0" className="form-control" value={v.max_admin_users} placeholder={plan?.max_admin_users} onChange={(e) => set('max_admin_users', e.target.value)} /></Field></div>
                <div className="col-sm-4"><Field label="Editions / month" error={errors.max_editions_per_month} className="mb-0" help="0 = unlimited"><input type="number" min="0" className="form-control" value={v.max_editions_per_month} placeholder={plan?.max_editions_per_month} onChange={(e) => set('max_editions_per_month', e.target.value)} /></Field></div>
              </div>
            )}
          </Panel>

          <Panel title={<><i className="bi bi-grid-3x3-gap me-2" />Modules</>} className="mt-4">
            <Switch label="Choose modules for this client" checked={v.custom_modules} onChange={(x) => { set('custom_modules', x); if (x && !v.modules.length) set('modules', plan?.modules || []); }}
              help="Otherwise the plan's modules apply." />
            <ModulePicker features={features} value={v.custom_modules ? v.modules : plan?.modules || []} onChange={(m) => set('modules', m)} disabled={!v.custom_modules} />
          </Panel>
        </div>
      </div>
      <div className="sa-savebar">
        <Link to={isNew ? '/superadmin/clients' : `/superadmin/clients/${id}`} className="btn btn-light">Cancel</Link>
        <button className="btn btn-primary px-4" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}{isNew ? (busy ? 'Creating newspaper…' : 'Create client') : 'Save changes'}</button>
      </div>
    </form>
  );
}
