import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, Panel, Switch } from '../../components/admin';
import { Field, Spinner } from '../../components/common';
import { pget, pput, ppost } from '../../services/api';
import { usePlatformAuth } from '../SuperAdminApp';

const PRESETS = {
  gmail: { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_secure: false, hint: 'Use a Google "App password" (Google Account → Security → 2-Step Verification → App passwords), not your normal password.' },
  zoho: { smtp_host: 'smtp.zoho.in', smtp_port: 587, smtp_secure: false, hint: 'Use your Zoho mail address and password (or an app-specific password).' },
  outlook: { smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: false, hint: 'Use your Microsoft 365 email and password.' },
  hostinger: { smtp_host: 'smtp.hostinger.com', smtp_port: 465, smtp_secure: true, hint: 'Use the email account and password created in hPanel.' },
  ses: { smtp_host: 'email-smtp.ap-south-1.amazonaws.com', smtp_port: 587, smtp_secure: false, hint: 'Use SMTP credentials created in the Amazon SES console (not your AWS keys).' },
};

export default function PlatformSettings({ tab }) {
  const { admin } = usePlatformAuth();
  const [v, setV] = useState(null);
  const [clients, setClients] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState(admin.email);
  const [testing, setTesting] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => { pget('/settings').then((r) => { setV({ ...r.data, smtp_pass: '' }); setClients(r.meta?.clients || []); }).catch((e) => toast.error(e.message)); }, []);
  if (!v) return <Spinner className="py-5" />;
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }));

  const save = async (e) => {
    e?.preventDefault(); setBusy(true); setErrors({});
    try { const r = await pput('/settings', v); toast.success(r.message); setV({ ...r.data, smtp_pass: '' }); } catch (err) { setErrors(err.errors || {}); toast.error(err.message); }
    setBusy(false);
  };
  const test = async () => {
    setTesting(true);
    try { await pput('/settings', v); const r = await ppost('/settings/test-email', { to: testTo }); toast.success(r.message); } catch (e) { toast.error(e.message, { duration: 8000 }); }
    setTesting(false);
  };

  return (
    <form onSubmit={save}>
      {tab === 'general' ? (<>
        <PageHeader title="Platform settings" subtitle="Your platform's name, address and what readers see" />
        <div className="row g-4">
          <div className="col-lg-7">
            <Panel title={<><i className="bi bi-globe2 me-2" />Platform</>}>
              <Field label="Platform name" error={errors.platform_name}><input className="form-control" value={v.platform_name} onChange={(e) => set('platform_name', e.target.value)} /></Field>
              <Field label="Platform address" error={errors.platform_url} help="The main address of this server, e.g. https://epaper.yourcompany.com. Newspapers without their own domain open at this address + /n/<name>.">
                <input className="form-control" value={v.platform_url} onChange={(e) => set('platform_url', e.target.value)} /></Field>
              <Field label="Home page of the platform address" error={errors.home_tenant_id} help="What readers see at the platform address itself.">
                <select className="form-select" value={v.home_tenant_id} onChange={(e) => set('home_tenant_id', e.target.value)}>
                  <option value={0}>List of all newspapers</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>Show {c.name}</option>)}
                </select></Field>
            </Panel>
            <Panel title={<><i className="bi bi-pause-circle me-2" />Deactivated & expired newspapers</>} className="mt-4">
              <Field label="Message readers see" error={errors.unavailable_message}><textarea className="form-control" rows="2" value={v.unavailable_message} onChange={(e) => set('unavailable_message', e.target.value)} /></Field>
              <Field label="Send expiry reminders (days before)" error={errors.reminder_days} help="Emails the client owner, e.g. 7,3,1 — and once more on the day the plan expires." className="mb-0">
                <input className="form-control" value={v.reminder_days} onChange={(e) => set('reminder_days', e.target.value)} /></Field>
            </Panel>
          </div>
          <div className="col-lg-5">
            <Panel title={<><i className="bi bi-headset me-2" />Support contact</>}>
              <p className="small text-muted">Shown to clients on expiry emails and on the "unavailable" page.</p>
              <Field label="Support email" error={errors.support_email}><input type="email" className="form-control" value={v.support_email} onChange={(e) => set('support_email', e.target.value)} /></Field>
              <Field label="Support phone" error={errors.support_phone} className="mb-0"><input className="form-control" value={v.support_phone || ''} onChange={(e) => set('support_phone', e.target.value)} /></Field>
            </Panel>
            <Panel title={<><i className="bi bi-globe-americas me-2" />Own domains (automatic setup)</>} className="mt-4">
              <DomainSetupStatus />
              <Field label="Server IP" error={errors.server_ip} help="The public IP of this server. Clients add an A record pointing their domain here. Several IPs: separate with commas.">
                <input className="form-control" value={v.server_ip || ''} onChange={(e) => set('server_ip', e.target.value)} placeholder="e.g. 216.48.177.81" /></Field>
              <Field label="SSL email (Let's Encrypt)" error={errors.ssl_email} className="mb-0" help="Receives certificate expiry notices. Empty = support email.">
                <input type="email" className="form-control" value={v.ssl_email || ''} onChange={(e) => set('ssl_email', e.target.value)} placeholder={v.support_email || 'ops@yourcompany.com'} /></Field>
            </Panel>
          </div>
        </div>
      </>) : (<>
        <PageHeader title="Platform Email (SMTP)" subtitle="One mail server for the whole platform: welcome emails, expiry reminders, and every newspaper's password resets and subscriber emails" />
        <div className="row g-4">
          <div className="col-lg-7">
            <Panel title={<><i className="bi bi-hdd-network me-2" />SMTP server</>}>
              <label className="form-label">Quick setup</label>
              <div className="d-flex flex-wrap gap-2 mb-3">
                {Object.entries({ gmail: 'Gmail', zoho: 'Zoho', outlook: 'Microsoft 365', hostinger: 'Hostinger', ses: 'Amazon SES' }).map(([k, l]) => (
                  <button type="button" key={k} className="btn btn-sm btn-light border" onClick={() => { const { hint: h, ...p } = PRESETS[k]; setV((x) => ({ ...x, ...p })); setHint(h); }}>{l}</button>
                ))}
              </div>
              {hint && <div className="alert alert-info small py-2"><i className="bi bi-info-circle me-1" />{hint}</div>}
              <div className="row g-3">
                <div className="col-md-8"><Field label="SMTP host" error={errors.smtp_host} className="mb-0"><input className="form-control" value={v.smtp_host || ''} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" /></Field></div>
                <div className="col-md-4"><Field label="Port" error={errors.smtp_port} className="mb-0"><input type="number" className="form-control" value={v.smtp_port} onChange={(e) => { const p = e.target.value; setV((x) => ({ ...x, smtp_port: p, smtp_secure: String(p) === '465' ? true : ['587', '25', '2525'].includes(String(p)) ? false : x.smtp_secure })); }} /></Field></div>
                <div className="col-md-6"><Field label="Username" error={errors.smtp_user} className="mb-0"><input className="form-control" autoComplete="off" value={v.smtp_user || ''} onChange={(e) => set('smtp_user', e.target.value)} /></Field></div>
                <div className="col-md-6"><Field label="Password" error={errors.smtp_pass} className="mb-0" help={v.smtp_pass_set ? 'Saved. Leave empty to keep it.' : 'Stored encrypted.'}>
                  <input type="password" className="form-control" autoComplete="new-password" value={v.smtp_pass} placeholder={v.smtp_pass_set ? '••••••••' : ''} onChange={(e) => set('smtp_pass', e.target.value)} /></Field></div>
              </div>
              <div className="mt-3"><Switch label="Use SSL (port 465)" checked={v.smtp_secure} onChange={(x) => setV((y) => ({ ...y, smtp_secure: x, smtp_port: x ? 465 : 587 }))} help="Set automatically from the port: 465 = SSL on, 587 = SSL off." /></div>
            </Panel>
            <Panel title={<><i className="bi bi-person-lines-fill me-2" />Sender</>} className="mt-4">
              <div className="row g-3">
                <div className="col-md-6"><Field label="From name" error={errors.mail_from_name} className="mb-0" help="Newspaper emails use the newspaper's own name"><input className="form-control" value={v.mail_from_name} onChange={(e) => set('mail_from_name', e.target.value)} /></Field></div>
                <div className="col-md-6"><Field label="From email" error={errors.mail_from_email} className="mb-0"><input type="email" className="form-control" value={v.mail_from_email} onChange={(e) => set('mail_from_email', e.target.value)} /></Field></div>
              </div>
            </Panel>
          </div>
          <div className="col-lg-5">
            <Panel title={<><i className="bi bi-send-check me-2" />Send a test email</>}>
              <p className="small text-muted">Saves the settings, checks the login, then sends a test message.</p>
              <div className="input-group">
                <input type="email" className="form-control" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <button type="button" className="btn btn-primary" disabled={testing || !v.smtp_host} onClick={test}>{testing ? <span className="spinner-border spinner-border-sm" /> : 'Send test'}</button>
              </div>
              {!v.smtp_host && <div className="small text-muted mt-2">Without SMTP, emails are only printed in the backend terminal.</div>}
            </Panel>
          </div>
        </div>
      </>)}
      <div className="sa-savebar"><button className="btn btn-primary px-4" disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" />}Save settings</button></div>
    </form>
  );
}

/** Is the server helper for automatic own domains installed? */
function DomainSetupStatus() {
  const [st, setSt] = useState(null);
  useEffect(() => { pget('/domain-setup').then((r) => setSt(r.data)).catch(() => setSt({ server: { ready: false, message: 'Could not check' } })); }, []);
  if (!st) return <div className="small text-muted mb-3"><span className="spinner-border spinner-border-sm me-1" />Checking server…</div>;
  const ok = st.server.ready;
  return (
    <div className={`dom-msg ${ok ? 'ok' : 'warn'} mb-3`}>
      <i className={`bi bi-${ok ? 'check-circle-fill' : 'tools'} me-1`} />
      <b>{ok ? 'Automatic setup is ready' : 'Automatic setup is not ready'}</b> — {st.server.message}
      {!ok && <div className="mt-1">One-time server setup: see <code>deploy/README-domains.md</code> in the project.</div>}
      {ok && <div className="mt-1">Saving a client's own domain creates its website and free SSL automatically.</div>}
    </div>
  );
}
