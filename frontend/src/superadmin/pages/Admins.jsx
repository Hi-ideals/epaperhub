import { useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, Panel, DataTable, runAction, Switch } from '../../components/admin';
import { Field, Modal } from '../../components/common';
import { timeAgo } from '../../utils/format';
import { ppost, pput, pdel } from '../../services/api';
import { usePFetch } from '../shared';
import { usePlatformAuth } from '../SuperAdminApp';

export default function Admins() {
  const { admin: me } = usePlatformAuth();
  const { data, loading, error, reload } = usePFetch('/admins');
  const [edit, setEdit] = useState(null);
  const [errors, setErrors] = useState({});
  const save = async () => {
    setErrors({});
    try { const r = edit.id ? await pput(`/admins/${edit.id}`, edit) : await ppost('/admins', edit); toast.success(r.message); setEdit(null); reload(true); } catch (e) { setErrors(e.errors || {}); toast.error(e.message); }
  };
  const cols = [
    { key: 'name', label: 'Name', render: (a) => <><b>{a.name}</b>{a.id === me.id && <span className="sa-pill on ms-2">You</span>}</> },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status', render: (a) => <span className={`sa-pill ${a.status === 'active' ? 'on' : 'off'}`}>{a.status === 'active' ? 'Active' : 'Disabled'}</span> },
    { key: 'last', label: 'Last login', render: (a) => (a.last_login_at ? timeAgo(a.last_login_at) : 'Never') },
    { key: 'x', label: '', className: 'text-end text-nowrap', render: (a) => (<>
      <button className="btn btn-sm btn-light me-1" onClick={() => { setErrors({}); setEdit({ ...a, password: '' }); }}><i className="bi bi-pencil" /></button>
      {a.id !== me.id && <button className="btn btn-sm btn-light text-danger" onClick={() => runAction(() => pdel(`/admins/${a.id}`), { confirmText: `Remove super admin ${a.name}?`, button: 'Remove', onDone: () => reload(true) })}><i className="bi bi-trash" /></button>}
    </>) },
  ];
  return (
    <>
      <PageHeader title="Super admins" subtitle="People who can manage the whole platform and every newspaper"
        actions={<button className="btn btn-primary" onClick={() => { setErrors({}); setEdit({ name: '', email: '', password: '', status: 'active' }); }}><i className="bi bi-plus-lg me-1" />Add super admin</button>} />
      <Panel bodyClass=""><DataTable columns={cols} rows={data || []} loading={loading} error={error} onRetry={reload} /></Panel>
      <Modal show={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit super admin' : 'Add super admin'} footer={<><button className="btn btn-light" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
        {edit && (<>
          <Field label="Name" error={errors.name}><input className="form-control" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Email" error={errors.email}><input type="email" className="form-control" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label={edit.id ? 'New password (optional)' : 'Password'} error={errors.password}><input className="form-control" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          {edit.id !== me.id && <Switch label="Active" checked={edit.status === 'active'} onChange={(v) => setEdit({ ...edit, status: v ? 'active' : 'disabled' })} />}
        </>)}
      </Modal>
    </>
  );
}
