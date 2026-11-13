import { useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, Panel } from '../../components/admin';
import { Field } from '../../components/common';
import { pput, platformToken } from '../../services/api';
import { usePlatformAuth } from '../SuperAdminApp';

export default function Account() {
  const { admin, setAdmin } = usePlatformAuth();
  const [v, setV] = useState({ name: admin.name, email: admin.email, current_password: '', new_password: '' });
  const [errors, setErrors] = useState({});
  const save = async (e) => {
    e.preventDefault(); setErrors({});
    try {
      const r = await pput('/auth/me', v);
      if (r.data.token) platformToken.set(r.data.token);
      setAdmin(r.data.admin); setV((x) => ({ ...x, current_password: '', new_password: '' })); toast.success(r.message);
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); }
  };
  return (
    <form onSubmit={save}>
      <PageHeader title="My account" />
      <div className="row"><div className="col-lg-7">
        <Panel title="Profile & password">
          <Field label="Name" error={errors.name}><input className="form-control" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Email (login)" error={errors.email}><input type="email" className="form-control" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="New password" error={errors.new_password} help="Leave empty to keep your password"><input type="password" className="form-control" autoComplete="new-password" value={v.new_password} onChange={(e) => setV({ ...v, new_password: e.target.value })} /></Field>
          <Field label="Current password" error={errors.current_password} help="Needed to change your email or password"><input type="password" className="form-control" autoComplete="current-password" value={v.current_password} onChange={(e) => setV({ ...v, current_password: e.target.value })} /></Field>
          <button className="btn btn-primary">Save</button>
        </Panel>
      </div></div>
    </form>
  );
}
