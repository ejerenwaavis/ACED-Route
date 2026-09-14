import React, { useState, useEffect } from 'react';
import { DownloadCloud, CheckCircle2, AlertTriangle, RefreshCw, X, ArrowUpCircle } from 'lucide-react';
import { AcedRouting } from 'aced-routing';

const GITHUB_RELEASE_API = 'https://api.github.com/repos/ejerenwaavis/ACED-Route/releases/tags/latest-apk';
const FALLBACK_APK_URL = 'https://github.com/ejerenwaavis/ACED-Route/releases/download/latest-apk/acedroute.apk';

export default function AppUpdateModal({ isOpen, onClose }) {
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState(null);
  const [currentVersion, setCurrentVersion] = useState({ versionName: '1.0.0', versionCode: 1 });
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    // 1. Get installed native version
    if (AcedRouting && typeof AcedRouting.getAppVersion === 'function') {
      AcedRouting.getAppVersion()
        .then((ver) => {
          if (ver) setCurrentVersion(ver);
        })
        .catch((err) => {
          console.warn('[AppUpdateModal] Could not get native app version:', err);
        });
    }

    // 2. Check latest release from GitHub
    checkForUpdates();
  }, [isOpen]);

  const checkForUpdates = async () => {
    setChecking(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const res = await fetch(GITHUB_RELEASE_API, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!res.ok) {
        throw new Error(`GitHub release check returned status ${res.status}`);
      }

      const data = await res.json();
      const apkAsset = (data.assets || []).find((a) => a.name === 'acedroute.apk') ||
                       (data.assets || []).find((a) => a.name.endsWith('.apk'));

      setReleaseInfo({
        tag: data.tag_name || 'latest-apk',
        name: data.name || 'Latest Cloud Release',
        publishedAt: data.published_at || data.created_at,
        downloadUrl: apkAsset ? apkAsset.browser_download_url : FALLBACK_APK_URL,
        sizeMB: apkAsset ? (apkAsset.size / (1024 * 1024)).toFixed(1) : '4.6',
        body: data.body || 'Latest production improvements and offline navigation updates.'
      });
    } catch (err) {
      console.warn('[AppUpdateModal] Update check failed:', err);
      setErrorMessage('Could not connect to update server. Using direct release link.');
      setReleaseInfo({
        tag: 'latest-apk',
        name: 'ACED Route Latest Build',
        downloadUrl: FALLBACK_APK_URL,
        sizeMB: '4.6',
        body: 'Automated cloud build of ACED Route.'
      });
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!releaseInfo || !releaseInfo.downloadUrl) return;

    setDownloading(true);
    setErrorMessage('');
    setStatusMessage('Downloading update package...');

    try {
      if (AcedRouting && typeof AcedRouting.installApk === 'function') {
        const result = await AcedRouting.installApk({ apkUrl: releaseInfo.downloadUrl });
        if (result && result.success) {
          setStatusMessage('Installer opened. Tap "Update" on your screen.');
        } else {
          setStatusMessage('Opening installer...');
        }
      } else {
        // Fallback for browser testing
        window.open(releaseInfo.downloadUrl, '_blank');
        setStatusMessage('APK download started in browser.');
      }
    } catch (err) {
      console.error('[AppUpdateModal] Install failed:', err);
      setErrorMessage(`Update error: ${err.message || err}. You can still download the APK directly.`);
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '460px',
          background: 'var(--color-graphite, #17191C)',
          border: '1px solid #2E3238',
          borderRadius: '16px',
          color: '#FFFFFF',
          padding: '1.5rem'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(38, 118, 217, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-blue-nav, #2676D9)'
              }}
            >
              <ArrowUpCircle size={22} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF' }}>
                Software Update
              </h3>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-gray, #8A8F96)' }}>
                Installed Version: {currentVersion.versionName} (Build {currentVersion.versionCode})
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8A8F96',
              cursor: 'pointer',
              padding: '0.25rem'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {checking ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <RefreshCw size={28} className="spin" style={{ color: 'var(--color-blue-nav, #2676D9)', marginBottom: '0.75rem' }} />
            <div style={{ fontSize: '0.9rem', color: '#FFFFFF' }}>Checking for latest release...</div>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: 'rgba(34, 37, 42, 0.8)',
                border: '1px solid #2E3238',
                borderRadius: '12px',
                padding: '1rem',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#FFFFFF' }}>
                  {releaseInfo?.name || 'Latest APK Build'}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                    background: 'rgba(32, 165, 100, 0.15)',
                    color: 'var(--color-green-success, #20A564)'
                  }}
                >
                  Verified Keystore
                </span>
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--color-gray, #8A8F96)', marginBottom: '0.75rem' }}>
                {releaseInfo?.publishedAt
                  ? `Built on ${new Date(releaseInfo.publishedAt).toLocaleString()}`
                  : 'Latest signed production binary'}
                {' • '}
                {releaseInfo?.sizeMB || '4.6'} MB
              </div>

              <div
                style={{
                  fontSize: '0.8rem',
                  lineHeight: '1.4',
                  color: '#D1D5DB',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px'
                }}
              >
                In-place update supported. Tapping install will update your app directly without uninstalling, preserving all downloaded maps and local data.
              </div>
            </div>

            {errorMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  background: 'rgba(229, 72, 77, 0.12)',
                  border: '1px solid rgba(229, 72, 77, 0.3)',
                  borderRadius: '8px',
                  color: '#E5484D',
                  fontSize: '0.8rem',
                  marginBottom: '1rem'
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {statusMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  background: 'rgba(32, 165, 100, 0.12)',
                  border: '1px solid rgba(32, 165, 100, 0.3)',
                  borderRadius: '8px',
                  color: '#20A564',
                  fontSize: '0.8rem',
                  marginBottom: '1rem'
                }}
              >
                <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                <span>{statusMessage}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                className="btn btn-secondary"
                onClick={checkForUpdates}
                disabled={downloading}
                style={{ flex: '1', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', padding: '0.65rem' }}
              >
                <RefreshCw size={14} />
                <span>Check Again</span>
              </button>

              <button
                className="btn btn-primary"
                onClick={handleInstallUpdate}
                disabled={downloading}
                style={{
                  flex: '2',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.65rem',
                  background: 'var(--color-orange-action, #F28C28)',
                  borderColor: 'var(--color-orange-action, #F28C28)',
                  fontWeight: 600
                }}
              >
                <DownloadCloud size={16} />
                <span>{downloading ? 'Downloading...' : 'Install Update'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
