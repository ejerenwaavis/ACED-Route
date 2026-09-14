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

      const assetTimestamp = apkAsset?.updated_at || apkAsset?.created_at || data.published_at || data.created_at;

      setReleaseInfo({
        tag: data.tag_name || 'latest-apk',
        name: data.name || 'Latest Cloud Release',
        publishedAt: assetTimestamp,
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
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
            <RefreshCw size={28} className="spin" style={{ color: 'var(--color-blue-nav, #2676D9)', marginBottom: '0.75rem' }} />
            <div style={{ fontSize: '0.9rem', color: '#FFFFFF', fontWeight: 600 }}>Checking update servers...</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-gray, #8A8F96)', marginTop: '0.25rem' }}>Comparing installed build with GitHub releases</div>
          </div>
        ) : (() => {
          const installedTime = currentVersion.lastUpdateTime
            ? new Date(currentVersion.lastUpdateTime)
            : (typeof __APP_BUILD_TIME__ !== 'undefined' ? new Date(__APP_BUILD_TIME__) : null);
          const cloudTime = releaseInfo?.publishedAt ? new Date(releaseInfo.publishedAt) : null;

          // Difference in ms: positive means cloud is newer
          const diffMs = (cloudTime && installedTime) ? (cloudTime.getTime() - installedTime.getTime()) : 0;
          // Threshold: if cloud build is more than 2 minutes newer, consider it an update
          const isCloudNewer = diffMs > 2 * 60 * 1000;

          const formatTimestamp = (d) => {
            if (!d || isNaN(d.getTime())) return 'Unknown';
            return d.toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
          };

          const formatRelativeDiff = () => {
            if (!isCloudNewer) return null;
            const diffMin = Math.round(diffMs / 60000);
            if (diffMin < 60) return `${diffMin} min newer`;
            const diffHours = Math.round(diffMin / 60);
            if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} newer`;
            const diffDays = Math.round(diffHours / 24);
            return `${diffDays} day${diffDays > 1 ? 's' : ''} newer`;
          };

          return (
            <div>
              {/* Status Comparison Badge Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  background: isCloudNewer ? 'rgba(242, 140, 40, 0.12)' : 'rgba(32, 165, 100, 0.12)',
                  border: `1px solid ${isCloudNewer ? 'rgba(242, 140, 40, 0.35)' : 'rgba(32, 165, 100, 0.35)'}`,
                  marginBottom: '1.25rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  {isCloudNewer ? (
                    <AlertTriangle size={20} style={{ color: 'var(--color-orange-action, #F28C28)', flexShrink: 0 }} />
                  ) : (
                    <CheckCircle2 size={20} style={{ color: 'var(--color-green-success, #20A564)', flexShrink: 0 }} />
                  )}
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: isCloudNewer ? '#FFFFFF' : '#20A564' }}>
                      {isCloudNewer ? 'Newer Build Available' : 'Your App is Up to Date'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: isCloudNewer ? '#FFD4A8' : '#A7F3D0' }}>
                      {isCloudNewer
                        ? `Cloud release is ${formatRelativeDiff()} than installed version.`
                        : 'Installed build matches or is newer than the cloud build.'}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    background: isCloudNewer ? 'var(--color-orange-action, #F28C28)' : 'var(--color-green-success, #20A564)',
                    color: '#FFFFFF'
                  }}
                >
                  {isCloudNewer ? 'Update' : 'Current'}
                </span>
              </div>

              {/* Side-by-Side Comparison Card */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.75rem',
                  marginBottom: '1.25rem'
                }}
              >
                {/* Installed App Card */}
                <div
                  style={{
                    background: 'rgba(23, 25, 28, 0.9)',
                    border: '1px solid #2E3238',
                    borderRadius: '12px',
                    padding: '0.85rem'
                  }}
                >
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-gray, #8A8F96)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Currently Installed
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.35rem' }}>
                    v{currentVersion.versionName} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#8A8F96' }}>(#{currentVersion.versionCode})</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#D1D5DB' }}>
                    Built:
                  </div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: isCloudNewer ? '#8A8F96' : '#20A564' }}>
                    {formatTimestamp(installedTime)}
                  </div>
                </div>

                {/* Cloud Build Card */}
                <div
                  style={{
                    background: isCloudNewer ? 'rgba(38, 118, 217, 0.08)' : 'rgba(23, 25, 28, 0.9)',
                    border: `1px solid ${isCloudNewer ? 'var(--color-blue-nav, #2676D9)' : '#2E3238'}`,
                    borderRadius: '12px',
                    padding: '0.85rem'
                  }}
                >
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: isCloudNewer ? 'var(--color-blue-nav, #2676D9)' : 'var(--color-gray, #8A8F96)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Cloud Release
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.35rem' }}>
                    {releaseInfo?.tag || 'latest-apk'} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#8A8F96' }}>({releaseInfo?.sizeMB || '4.6'} MB)</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#D1D5DB' }}>
                    Built:
                  </div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: isCloudNewer ? 'var(--color-orange-action, #F28C28)' : '#8A8F96' }}>
                    {formatTimestamp(cloudTime)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: '0.78rem',
                  lineHeight: '1.4',
                  color: '#9CA3AF',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  border: '1px solid rgba(255, 255, 255, 0.05)'
                }}
              >
                In-place update supported via permanent signing keystore. Installing updates directly over your installed app without deleting local offline maps or manifest data.
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
                  style={{ flex: '1', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem', padding: '0.7rem' }}
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
                    padding: '0.7rem',
                    background: isCloudNewer ? 'var(--color-orange-action, #F28C28)' : '#2A2E35',
                    borderColor: isCloudNewer ? 'var(--color-orange-action, #F28C28)' : '#3E444E',
                    color: '#FFFFFF',
                    fontWeight: 600
                  }}
                >
                  <DownloadCloud size={16} />
                  <span>
                    {downloading
                      ? 'Downloading...'
                      : isCloudNewer
                        ? 'Install Update'
                        : 'Reinstall Build'}
                  </span>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
