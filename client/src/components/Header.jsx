import React, { useState, useEffect } from 'react';
import { Navigation, Settings, LogIn, LogOut, ShieldCheck, Server, Map, Globe, DownloadCloud, ChevronDown, User, Route as RouteIcon } from 'lucide-react';
import { getUser, removeToken, getApiBase, setApiBase } from '../services/api';
import OfflineMapsModal from './OfflineMapsModal';
import AppUpdateModal from './AppUpdateModal';
import { getLanguage, setLanguage, onLanguageChange, t } from '../utils/i18n';

export default function Header({ user, onAuthChange, onOpenLogin, activeManifest, stops, activeTab }) {
  const [showSettings, setShowSettings] = useState(false);
  const [showOfflineMaps, setShowOfflineMaps] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [customApi, setCustomApi] = useState(getApiBase());
  const [lang, setLangState] = useState(getLanguage());

  const totalStops = stops?.length || 0;
  const deliveredStops = (stops || []).filter((s) => s.status === 'delivered').length;
  const progressPercent = totalStops > 0 ? Math.round((deliveredStops / totalStops) * 100) : 0;
  const routeName = activeManifest?.title ||
                    activeManifest?.name ||
                    (activeManifest?.filename ? activeManifest.filename.replace(/\.[^/.]+$/, '').slice(0, 16) : 'Route 1');

  useEffect(() => {
    return onLanguageChange((newLang) => setLangState(newLang));
  }, []);

  const handleToggleLang = () => {
    const next = lang === 'en' ? 'es' : 'en';
    setLanguage(next);
  };

  const handleSaveApi = () => {
    setApiBase(customApi.trim());
    setShowSettings(false);
    window.location.reload();
  };

  const handleLogout = () => {
    removeToken();
    onAuthChange(null);
  };

  return (
    <>
      <header className="app-header">
        <div className="brand-badge">
          <div className="logo-icon header-logo-dark">
            <Navigation size={17} />
          </div>
          <div>
            <div className="brand-title">ACED Route</div>
            <div className="brand-subtitle">Driver Delivery & Routing</div>
          </div>
        </div>

        {totalStops > 0 && (
          <div className="header-route-center">
            <div className="header-route-pill" title={routeName}>
              <span className="route-pill-dot" />
              <span className="route-pill-name">{routeName}</span>
              <ChevronDown size={13} color="var(--color-gray, #8A8F96)" />
            </div>

            <div
              className="header-progress-pill"
              title={`${deliveredStops} of ${totalStops} delivered (${progressPercent}%)`}
            >
              <span className="header-progress-text">{deliveredStops}/{totalStops}</span>
              <div className="header-progress-track">
                <div
                  className="header-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="header-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleToggleLang}
            title={lang === 'en' ? 'Cambiar a Español' : 'Switch to English'}
            style={{ fontWeight: 600, fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
          >
            <Globe size={13} />
            <span>{lang.toUpperCase()}</span>
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowOfflineMaps(true)}
            title="Offline Map Regions"
          >
            <Map size={14} />
            <span style={{ fontSize: '0.75rem' }}>{t('offlineMaps').split(' ')[0]}</span>
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSettings(true)}
            title="Backend Settings"
          >
            <Server size={14} />
            <span style={{ fontSize: '0.75rem' }}>API</span>
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowUpdateModal(true)}
            title="Check for Software Updates"
            style={{ fontWeight: 600, fontSize: '0.75rem', padding: '0.35rem 0.6rem', color: 'var(--color-orange-action, #F28C28)' }}
          >
            <DownloadCloud size={13} />
            <span>Update</span>
          </button>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div
                className="header-avatar-btn"
                title={`${user.name || user.email || 'Driver'} (Signed in)`}
              >
                <User size={15} />
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleLogout}
                title="Sign Out"
                style={{ padding: '0.35rem 0.5rem', borderRadius: '8px' }}
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onOpenLogin}>
              <LogIn size={14} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>
              <Server size={20} color="#38bdf8" /> Backend Configuration
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
              ACED Route connects to your Express API. Toggle between production domain (<code>route.aceddivision.com</code>) and local testing.
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setCustomApi('https://route.aceddivision.com')}
              >
                Production (aceddivision.com)
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setCustomApi('http://localhost:3000')}
              >
                Localhost:3000
              </button>
            </div>

            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
              API Base URL:
            </label>
            <input
              type="text"
              value={customApi}
              onChange={(e) => setCustomApi(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                fontSize: '0.9rem',
                marginBottom: '1rem'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveApi}>
                Save & Apply
              </button>
            </div>
          </div>
        </div>
      )}

      <OfflineMapsModal
        isOpen={showOfflineMaps}
        onClose={() => setShowOfflineMaps(false)}
      />

      <AppUpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
      />
    </>
  );
}
