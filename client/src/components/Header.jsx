import React, { useState } from 'react';
import { Navigation, Settings, LogIn, LogOut, ShieldCheck, Server } from 'lucide-react';
import { getUser, removeToken, getApiBase, setApiBase } from '../services/api';

export default function Header({ user, onAuthChange, onOpenLogin }) {
  const [showSettings, setShowSettings] = useState(false);
  const [customApi, setCustomApi] = useState(getApiBase());

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
          <div className="logo-icon">
            <Navigation size={18} />
          </div>
          <span>ACED Route</span>
        </div>

        <div className="header-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSettings(true)}
            title="Backend Settings"
          >
            <Server size={14} />
            <span style={{ fontSize: '0.75rem' }}>API</span>
          </button>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 500 }}>
                {user.name || user.email || 'Driver'}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleLogout}
                title="Sign Out"
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
    </>
  );
}
