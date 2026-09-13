import React, { useState } from 'react';
import { Smartphone, DownloadCloud, ExternalLink, X, Navigation, ShieldCheck } from 'lucide-react';

const APK_DOWNLOAD_URL = 'https://route.aceddivision.com/download/acedroute.apk';

export default function NativeHandoffModal({
  isOpen,
  onClose,
  schemeUri = 'acedroute://',
  title = 'Native App Required',
  message = 'To download offline maps and use turn-by-turn navigation, you must use the ACED Route mobile app.'
}) {
  const [opening, setOpening] = useState(false);
  const [didAttemptOpen, setDidAttemptOpen] = useState(false);

  if (!isOpen) return null;

  const handleOpenApp = () => {
    setOpening(true);
    setDidAttemptOpen(true);

    // Attempt to invoke the native deep link scheme
    window.location.href = schemeUri;

    // Reset opening indicator after timeout
    setTimeout(() => {
      setOpening(false);
    }, 2000);
  };

  const handleDownloadApp = () => {
    window.location.href = APK_DOWNLOAD_URL;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '440px', textAlign: 'center', padding: '1.75rem 1.5rem' }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '-0.5rem -0.5rem 0.5rem 0' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.25rem'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Device icon badge */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(56, 189, 248, 0.15)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#38bdf8',
            marginBottom: '1rem',
            border: '1px solid rgba(56, 189, 248, 0.3)'
          }}
        >
          <Smartphone size={32} />
        </div>

        <h3
          className="card-title"
          style={{
            fontSize: '1.25rem',
            justifyContent: 'center',
            marginBottom: '0.5rem',
            color: '#f8fafc'
          }}
        >
          {title}
        </h3>

        <p
          style={{
            fontSize: '0.9rem',
            color: '#94a3b8',
            lineHeight: 1.5,
            marginBottom: '1.5rem'
          }}
        >
          {message}
        </p>

        {didAttemptOpen && (
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: '#38bdf8',
              fontSize: '0.8rem',
              marginBottom: '1.25rem',
              textAlign: 'left'
            }}
          >
            If the ACED Route app didn't open automatically, download the latest APK below.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Button 1: Open App */}
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={handleOpenApp}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            <Navigation size={18} />
            <span>{opening ? 'Launching App...' : 'Open App'}</span>
          </button>

          {/* Button 2: Download App */}
          <button
            className="btn btn-secondary btn-block"
            onClick={handleDownloadApp}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              borderColor: didAttemptOpen ? '#38bdf8' : undefined
            }}
          >
            <DownloadCloud size={18} color="#38bdf8" />
            <span>Download App (APK)</span>
          </button>
        </div>

        <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1.25rem' }}>
          ACED Route Mobile • Offline MapLibre & Valhalla Engine
        </p>
      </div>
    </div>
  );
}
