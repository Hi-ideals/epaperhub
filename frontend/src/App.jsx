import AppRoutes from './routes/AppRoutes';
import { useSettings } from './context/SettingsContext';
import { NewspaperUnavailable, NewspaperNotFound } from './pages/public/PlatformPages';

export default function App() {
  const { error, loaded } = useSettings();
  // Wait for the newspaper's settings first: avoids a flash of default colours and
  // stops pages from calling the API before we know which newspaper this is.
  if (!loaded && !error) return <div className="app-boot" aria-busy="true" />;
  const code = !loaded && error?.data?.code;
  // Platform address without a newspaper → straight to the Super Admin login
  if (code === 'NO_TENANT') { window.location.replace('/superadmin'); return null; }
  if (code === 'TENANT_NOT_FOUND') return <NewspaperNotFound />;
  if (code === 'TENANT_INACTIVE') return <NewspaperUnavailable message={error.message} />;
  return <AppRoutes />;
}
