import { useEffect, useState } from 'react';
import { API_ORIGIN } from '../../services/api';

function usePlatformDirectory() {
  const [d, setD] = useState(null);
  useEffect(() => {
    fetch(`${API_ORIGIN}/api/v1/platform/directory`).then((r) => r.json()).then((j) => setD(j.data || {})).catch(() => setD({}));
  }, []);
  return d;
}

function Shell({ children }) {
  return (
    <div className="pf-shell">
      <div className="pf-card">{children}</div>
    </div>
  );
}

/** Platform home: the list of newspapers on this platform. */
export function PlatformHome() {
  const d = usePlatformDirectory();
  useEffect(() => { if (d?.platform_name) document.title = d.platform_name; }, [d]);
  return (
    <Shell>
      <div className="pf-mark"><i className="bi bi-newspaper" /></div>
      <h1>{d?.platform_name || 'ePaper Platform'}</h1>
      <p className="text-muted">Read your favourite newspapers online.</p>
      {!d ? <div className="spinner-border text-primary my-3" /> : d.newspapers?.length ? (
        <div className="pf-list">
          {d.newspapers.map((n) => (
            <a key={n.slug} href={n.url} className="pf-item"><span className="pf-ic">{n.name.slice(0, 1).toUpperCase()}</span><span>{n.name}</span><i className="bi bi-arrow-right ms-auto" /></a>
          ))}
        </div>
      ) : <p className="text-muted">No newspapers are published yet.</p>}
      <a className="pf-admin" href="/superadmin"><i className="bi bi-shield-lock me-1" />Super admin</a>
    </Shell>
  );
}

export function NewspaperUnavailable({ message }) {
  const d = usePlatformDirectory();
  return (
    <Shell>
      <div className="pf-mark warn"><i className="bi bi-pause-circle" /></div>
      <h1>Temporarily unavailable</h1>
      <p className="text-muted">{message || 'This newspaper is temporarily unavailable. Please check back soon.'}</p>
      {(d?.support_email || d?.support_phone) && (
        <p className="small text-muted mb-0">Publisher? Contact {d.support_email && <a href={`mailto:${d.support_email}`}>{d.support_email}</a>}{d.support_email && d.support_phone ? ' · ' : ''}{d.support_phone}</p>
      )}
    </Shell>
  );
}

export function NewspaperNotFound() {
  return (
    <Shell>
      <div className="pf-mark warn"><i className="bi bi-question-circle" /></div>
      <h1>Newspaper not found</h1>
      <p className="text-muted">There is no newspaper at this address.</p>
      <a className="btn btn-primary" href="/">See all newspapers</a>
    </Shell>
  );
}
