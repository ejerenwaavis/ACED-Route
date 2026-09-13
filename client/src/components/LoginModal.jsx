import React, { useState } from 'react';
import { LogIn, Key, Shield, Navigation, Server, AlertCircle } from 'lucide-react';
import { getApiBase, setApiBase, setToken } from '../services/api';

export default function LoginScreen({ onLoginSuccess }) {
  const [devEmail, setDevEmail] = useState('driver@aceddivision.com');
  const [manualToken, setManualToken] = useState('');
  const [activeTab, setActiveTab] = useState('google'); // 'google' | 'dev'
  const [showSettings, setShowSettings] = useState(false);
  const [customApi, setCustomApi] = useState(getApiBase());

  const handleGoogleLogin = async () => {
    const apiBase = getApiBase();
    const googleAuthUrl = `${apiBase}/api/auth/google`;

    // Check if running inside native Capacitor
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: googleAuthUrl });
      } catch (err) {
        window.open(googleAuthUrl, '_system');
      }
    } else {
      // Standard browser
      window.location.href = googleAuthUrl;
    }
  };

  const handleDevLogin = () => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        sub: "66e400000000000000000001",
        email: devEmail,
        name: devEmail.split('@')[0],
        role: "driver"
      })
    );
    const fakeDevToken = `${header}.${payload}.dev_signature_for_testing`;
    setToken(manualToken.trim() || fakeDevToken);
    onLoginSuccess();
  };

  const handleSaveApi = () => {
    setApiBase(customApi.trim());
    setShowSettings(false);
    window.location.reload();
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem 1rem',
      background: 'radial-gradient(ellipse at top, #1e293b 0%, #0f172a 100%)',
      boxSizing: 'border-box'
    }}>
      <div style={{
        maxWidth: '440px',
        width: '100%',
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '16px',
        padding: '2rem 1.75rem',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
        position: 'relative'
      }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
            boxShadow: '0 8px 20px rgba(56, 189, 248, 0.3)'
          }}>
            <Navigation size={28} color="#fff" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.02em' }}>
            ACED Route
          </h1>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
            ACED Division LLC • Driver Navigation Portal
          </p>
        </div>

        {/* Secure Access Notice */}
        <div style={{
          background: 'rgba(2, 132, 199, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '8px',
          padding: '0.65rem 0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          fontSize: '0.8rem',
          color: '#38bdf8'
        }}>
          <Shield size={16} style={{ flexShrink: 0 }} />
          <span>Strictly authorized access. Sign in to view manifests & routes.</span>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid #334155', marginBottom: '1.5rem' }}>
          <button
            onClick={() => setActiveTab('google')}
            style={{
              flex: 1,
              padding: '0.65rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'google' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === 'google' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            Google Sign In
          </button>
          <button
            onClick={() => setActiveTab('dev')}
            style={{
              flex: 1,
              padding: '0.65rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'dev' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === 'dev' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            Dev / Fast Login
          </button>
        </div>

        {activeTab === 'google' ? (
          <div>
            <p style={{ fontSize: '0.88rem', color: '#94a3b8', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Use your Google account to access dispatch manifests, automated sequencing, and Google Maps turn-by-turn navigation.
            </p>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={handleGoogleLogin}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                fontSize: '1rem',
                padding: '0.85rem'
              }}
            >
              <LogIn size={20} />
              <span>Continue with Google</span>
            </button>
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1rem', textAlign: 'center' }}>
              Authorized OAuth callback: <code>route.aceddivision.com</code>
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
              Fast testing mode for local testing without Google OAuth credentials.
            </p>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
              Driver Email:
            </label>
            <input
              type="email"
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                fontSize: '0.9rem',
                marginBottom: '1rem',
                boxSizing: 'border-box'
              }}
            />

            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
              Or Paste Existing JWT Token:
            </label>
            <input
              type="text"
              placeholder="eyJhbGciOi..."
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                fontSize: '0.8rem',
                marginBottom: '1.25rem',
                boxSizing: 'border-box'
              }}
            />

            <button className="btn btn-success btn-block" onClick={handleDevLogin}>
              <Key size={18} />
              <span>Enter as Driver</span>
            </button>
          </div>
        )}

        {/* Footer with API Server Config */}
        <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            API: {getApiBase().replace('https://', '').replace('http://', '')}
          </span>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '0.75rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Server size={13} />
            <span>Configure</span>
          </button>
        </div>
      </div>

      {/* Backend API Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>
              <Server size={20} color="#38bdf8" /> API Configuration
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
              Select target backend environment:
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setCustomApi('https://route.aceddivision.com')}
              >
                Production
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setCustomApi('http://localhost:3000')}
              >
                Localhost:3000
              </button>
            </div>

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
                marginBottom: '1rem',
                boxSizing: 'border-box'
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
    </div>
  );
}
