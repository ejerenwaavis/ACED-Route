import React, { useState } from 'react';
import { LogIn, Key, X, Shield } from 'lucide-react';
import { getApiBase, setToken } from '../services/api';

export default function LoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [devEmail, setDevEmail] = useState('driver@aceddivision.com');
  const [manualToken, setManualToken] = useState('');
  const [activeTab, setActiveTab] = useState('google'); // 'google' | 'dev'

  if (!isOpen) return null;

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
    // Generate a development JWT token payload for testing routes immediately
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        sub: "66e400000000000000000001",
        email: devEmail,
        name: devEmail.split('@')[0],
        role: "driver"
      })
    );
    // Dummy signature format for dev mode
    const fakeDevToken = `${header}.${payload}.dev_signature_for_testing`;
    setToken(manualToken.trim() || fakeDevToken);
    onLoginSuccess();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            <Shield size={20} color="#38bdf8" /> Driver Sign In
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid #334155', marginBottom: '1.25rem' }}>
          <button
            onClick={() => setActiveTab('google')}
            style={{
              flex: 1,
              padding: '0.6rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'google' ? '2px solid #38bdf8' : 'none',
              color: activeTab === 'google' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Google OAuth
          </button>
          <button
            onClick={() => setActiveTab('dev')}
            style={{
              flex: 1,
              padding: '0.6rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'dev' ? '2px solid #38bdf8' : 'none',
              color: activeTab === 'dev' ? '#38bdf8' : '#94a3b8',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Dev / Fast Login
          </button>
        </div>

        {activeTab === 'google' ? (
          <div>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
              Sign in with your Google Workspace or authorized ACED driver account via Google OAuth.
            </p>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={handleGoogleLogin}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}
            >
              <LogIn size={20} />
              <span>Continue with Google</span>
            </button>
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1rem', textAlign: 'center' }}>
              Redirects to <code>https://route.aceddivision.com/api/auth/googleLoggedIn</code>
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
              Instant local testing mode for testing manifests and routes without waiting for Google OAuth credentials.
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
                marginBottom: '1rem'
              }}
            />

            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
              Or Paste Existing JWT Bearer Token:
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
                marginBottom: '1.25rem'
              }}
            />

            <button className="btn btn-success btn-block" onClick={handleDevLogin}>
              <Key size={18} />
              <span>Enter as Driver</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
