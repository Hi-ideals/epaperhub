import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/app.css';
import './styles/depth.css';
import './styles/classic.css';
import './styles/admin-modern.css';
import './styles/public-modern.css';
import App from './App';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider } from './context/AuthContext';
import { ConfirmHost } from './components/common';
import { registerSW } from './services/push';
import { BASENAME, IS_SUPERADMIN } from './services/tenant';

const SuperAdminApp = React.lazy(() => import('./superadmin/SuperAdminApp'));
const toaster = <Toaster position="top-center" toastOptions={{ duration: 3500, style: { fontSize: 14 } }} />;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {IS_SUPERADMIN ? (
      // Platform super admin panel (separate login, no newspaper)
      <BrowserRouter>
        <React.Suspense fallback={null}><SuperAdminApp /></React.Suspense>
        <ConfirmHost />
        {toaster}
      </BrowserRouter>
    ) : (
      // A newspaper: /n/<slug>/… on the platform domain, or its own domain
      <BrowserRouter basename={BASENAME}>
        <SettingsProvider>
          <AuthProvider>
            <App />
            <ConfirmHost />
            {toaster}
          </AuthProvider>
        </SettingsProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>
);

if (!IS_SUPERADMIN) {
  // Each newspaper is its own installable app with its own notifications
  const link = document.querySelector('link[rel="manifest"]');
  const slug = BASENAME.replace(/^\/n\//, '');
  if (link) link.href = BASENAME ? `/manifest.webmanifest?_t=${encodeURIComponent(slug)}` : '/manifest.webmanifest';
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__epInstallPrompt = e; window.dispatchEvent(new Event('ep:installable')); });
  window.addEventListener('load', () => registerSW());
}
