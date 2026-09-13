import React, { useState, useEffect } from 'react';
import { UploadCloud, ListOrdered, Navigation, Clock, ShieldCheck } from 'lucide-react';
import Header from './components/Header';
import LoginScreen from './components/LoginModal';
import UploadPage from './pages/UploadPage';
import SequencerPage from './pages/SequencerPage';
import NavigationPage from './pages/NavigationPage';
import HistoryPage from './pages/HistoryPage';
import { getUser, getToken, setToken } from './services/api';

export default function App() {
  const [user, setUser] = useState(getUser());
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' | 'sequencer' | 'navigation' | 'history'

  const [activeManifest, setActiveManifest] = useState(null);
  const [sequencedStops, setSequencedStops] = useState([]);

  // Check for Capacitor deep link or Web query param token
  useEffect(() => {
    // 1. Web query param check (?token=...)
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setToken(token);
      setUser(getUser());
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Capacitor native deep link check
    if (window.Capacitor) {
      import('@capacitor/app')
        .then(({ App: CapApp }) => {
          CapApp.addListener('appUrlOpen', (data) => {
            try {
              const url = new URL(data.url);
              if (url.host === 'auth-callback') {
                const deepToken = url.searchParams.get('token');
                if (deepToken) {
                  setToken(deepToken);
                  setUser(getUser());
                }
              }
            } catch (e) {
              console.warn('Error parsing deep link url:', e);
            }
          });
        })
        .catch(() => {});
    }
  }, []);

  // Strict Authentication Gate: Never render internal app components if not authenticated
  if (!user) {
    return (
      <LoginScreen
        onLoginSuccess={() => setUser(getUser())}
      />
    );
  }

  const handleManifestUploaded = (manifest) => {
    setActiveManifest(manifest);
    setSequencedStops(manifest.stops || []);
    setActiveTab('sequencer');
  };

  const handleStartRoute = (stops) => {
    setSequencedStops(stops);
    setActiveTab('navigation');
  };

  const handleResumeRoute = (manifest) => {
    setActiveManifest(manifest);
    setSequencedStops(manifest.stops || []);
    if (manifest.status === 'in_progress') {
      setActiveTab('navigation');
    } else {
      setActiveTab('sequencer');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        user={user}
        onAuthChange={(u) => {
          setUser(u);
        }}
      />

      {/* Navigation Bar */}
      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          <UploadCloud size={16} />
          <span>Upload</span>
        </button>

        <button
          className={`nav-tab ${activeTab === 'sequencer' ? 'active' : ''}`}
          onClick={() => {
            if (!activeManifest) {
              alert('Please upload or open a manifest first.');
              return;
            }
            setActiveTab('sequencer');
          }}
        >
          <ListOrdered size={16} />
          <span>Sequencer {activeManifest ? `(${sequencedStops.length})` : ''}</span>
        </button>

        <button
          className={`nav-tab ${activeTab === 'navigation' ? 'active' : ''}`}
          onClick={() => {
            if (!activeManifest) {
              alert('Please upload or open a manifest first.');
              return;
            }
            setActiveTab('navigation');
          }}
        >
          <Navigation size={16} />
          <span>Navigation</span>
        </button>

        <button
          className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <Clock size={16} />
          <span>History</span>
        </button>
      </nav>

      {/* Main Content Pages */}
      <main style={{ flex: 1, paddingBottom: '2rem' }}>
        {activeTab === 'upload' && (
          <UploadPage onManifestUploaded={handleManifestUploaded} />
        )}

        {activeTab === 'sequencer' && activeManifest && (
          <SequencerPage
            manifest={activeManifest}
            onStartRoute={handleStartRoute}
          />
        )}

        {activeTab === 'navigation' && activeManifest && (
          <NavigationPage
            manifest={activeManifest}
            stops={sequencedStops}
            onRouteComplete={() => setActiveTab('history')}
          />
        )}

        {activeTab === 'history' && (
          <HistoryPage onResumeRoute={handleResumeRoute} />
        )}
      </main>
    </div>
  );
}
