import { PageHeader, Panel, DataTable } from '../../components/admin';
import { formatDateTime } from '../../utils/format';
import { usePFetch } from '../shared';

export default function Activity() {
  const { data, loading, error, reload } = usePFetch('/activity');
  const cols = [
    { key: 'when', label: 'When', render: (a) => formatDateTime(a.created_at) },
    { key: 'who', label: 'Super admin', render: (a) => a.admin_name || 'System' },
    { key: 'action', label: 'Action', render: (a) => <span className="text-capitalize">{a.action.replace(/[._]/g, ' ')}</span> },
    { key: 'client', label: 'Client', render: (a) => a.tenant_name || '—' },
    { key: 'ip', label: 'IP', render: (a) => <span className="small text-muted">{a.ip_address || ''}</span> },
  ];
  return (<><PageHeader title="Activity log" subtitle="Everything super admins have done on the platform" /><Panel bodyClass=""><DataTable columns={cols} rows={data || []} loading={loading} error={error} onRetry={reload} /></Panel></>);
}
