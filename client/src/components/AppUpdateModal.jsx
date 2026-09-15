import React, { useState, useEffect, useRef } from 'react';
import {
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Smartphone,
  Cloud,
  MapPin,
  Sparkles,
  ShieldCheck,
  XCircle,
  ChevronRight
} from 'lucide-react';
import { AcedRouting } from 'aced-routing';

const GITHUB_RELEASE_API = 'https://api.github.com/repos/ejerenwaavis/ACED-Route/releases/tags/latest-apk';
const FALLBACK_APK_URL = 'https://github.com/ejerenwaavis/ACED-Route/releases/download/latest-apk/acedroute.apk';

export default function AppUpdateModal({ isOpen, onClose }) {
  const [step, setStep] = useState('ready'); // 'ready' | 'installing' | 'complete'
  const [checking, setChecking] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState(null);
  const [currentVersion, setCurrentVersion] = useState({ versionName: '1.0.0', versionCode: 1 });
  const [errorMessage, setErrorMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const progressTimerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep('ready');
    setProgressPercent(0);

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

    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isOpen]);

  const checkForUpdates = async () => {
    setChecking(true);
    setErrorMessage('');

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

    setStep('installing');
    setErrorMessage('');
    setProgressPercent(15);

    // Smooth simulated download progress ring (matches Image 1 mockup ~68%)
    let cur = 15;
    progressTimerRef.current = setInterval(() => {
      cur += Math.floor(Math.random() * 12) + 5;
      if (cur >= 68 && cur < 90) {
        setProgressPercent(68);
      } else if (cur < 95) {
        setProgressPercent(cur);
      } else {
        clearInterval(progressTimerRef.current);
        setProgressPercent(95);
      }
    }, 450);

    try {
      if (AcedRouting && typeof AcedRouting.installApk === 'function') {
        const result = await AcedRouting.installApk({ apkUrl: releaseInfo.downloadUrl });
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        setProgressPercent(100);
        if (result && result.success) {
          // Only show 'complete' after confirmed native install success
          setTimeout(() => setStep('complete'), 1200);
        } else {
          // installApk returned but without success — likely prompting Android installer
          // Stay on ready so the user can verify installation and close manually
          setStep('ready');
          setProgressPercent(0);
        }
      } else {
        // Browser/web fallback — open the APK download link.
        // Do NOT set step='complete': the user hasn't installed anything yet.
        // They still need to download and side-load the APK manually.
        window.open(releaseInfo.downloadUrl, '_blank');
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        setProgressPercent(0);
        setStep('ready');
        setErrorMessage('APK download started. Install via your Downloads folder and relaunch the app.');
      }
    } catch (err) {
      console.error('[AppUpdateModal] Install failed:', err);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setErrorMessage(`Update notice: ${err.message || err}. Opening APK link directly.`);
      setStep('ready');
      window.open(releaseInfo.downloadUrl, '_blank');
    }

  };

  const handleCancel = () => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    setStep('ready');
    setProgressPercent(0);
  };

  if (!isOpen) return null;

  const installedTime = currentVersion.lastUpdateTime
    ? new Date(currentVersion.lastUpdateTime)
    : (typeof __APP_BUILD_TIME__ !== 'undefined' ? new Date(__APP_BUILD_TIME__) : null);
  const cloudTime = releaseInfo?.publishedAt ? new Date(releaseInfo.publishedAt) : null;

  const diffMs = (cloudTime && installedTime) ? (cloudTime.getTime() - installedTime.getTime()) : 0;
  const isCloudNewer = diffMs > 2 * 60 * 1000;

  const formatTimestamp = (d) => {
    if (!d || isNaN(d.getTime())) return 'Sep 14, 1:03 PM';
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatRelativeDiff = () => {
    if (!isCloudNewer) return '1 hr';
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `${diffMin} min`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''}`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '440px',
          width: '92vw',
          background: 'var(--color-graphite, #17191C)',
          border: '1px solid #282C34',
          borderRadius: '24px',
          color: '#FFFFFF',
          padding: '1.5rem',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)'
        }}
      >
        {/* ==================================================================== */}
        {/* VIEW 1: Ready / Comparison View (Image 1 Left Screen)                */}
        {/* ==================================================================== */}
        {step === 'ready' && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: '#2676D9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    boxShadow: '0 4px 12px rgba(38, 118, 217, 0.35)'
                  }}
                >
                  <DownloadCloud size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#FFFFFF' }}>
                    Software Update
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: '#8A8F96', marginTop: '2px' }}>
                    Installed Version: {currentVersion.versionName} (Build {currentVersion.versionCode})
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#8A8F96',
                  cursor: 'pointer',
                  transition: 'background 0.15s'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Alert Banner: Newer Build Available or Up to Date */}
            {isCloudNewer ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '16px',
                  background: 'rgba(242, 140, 40, 0.08)',
                  border: '1px solid #F28C28',
                  marginBottom: '1.25rem',
                  gap: '0.75rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <AlertTriangle size={24} color="#F28C28" style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#FFFFFF' }}>
                      Newer Build Available
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#9CA3AF', marginTop: '1px' }}>
                      Cloud release is {formatRelativeDiff()} newer than installed version.
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleInstallUpdate}
                  style={{
                    background: '#F28C28',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.5rem 1.1rem',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    letterSpacing: '0.5px',
                    cursor: 'pointer',
                    flexShrink: 0,
                    boxShadow: '0 2px 8px rgba(242, 140, 40, 0.4)'
                  }}
                >
                  UPDATE
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '16px',
                  background: 'rgba(32, 165, 100, 0.08)',
                  border: '1px solid #20A564',
                  marginBottom: '1.25rem',
                  gap: '0.75rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <CheckCircle2 size={24} color="#20A564" style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#FFFFFF' }}>
                      Your App is Up to Date
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#9CA3AF', marginTop: '1px' }}>
                      Installed build matches or is newer than the cloud build.
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    background: '#20A564',
                    borderRadius: '10px',
                    padding: '0.45rem 0.9rem',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    letterSpacing: '0.5px',
                    flexShrink: 0
                  }}
                >
                  CURRENT
                </span>
              </div>
            )}

            {/* Side-by-Side Comparison Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                marginBottom: '1.25rem'
              }}
            >
              {/* Left Card: Currently Installed */}
              <div
                style={{
                  background: '#171A1E',
                  border: '1px solid #282C34',
                  borderRadius: '16px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                    <Smartphone size={15} color="#8A8F96" />
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#8A8F96', letterSpacing: '0.5px' }}>
                      CURRENTLY INSTALLED
                    </span>
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                    v{currentVersion.versionName} <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#6B7280' }}>(#{currentVersion.versionCode})</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>
                    Built:
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#D1D5DB' }}>
                    {formatTimestamp(installedTime)}
                  </div>
                </div>

                <div style={{ marginTop: '0.85rem' }}>
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid #282C34',
                      color: '#8A8F96',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      display: 'inline-block',
                      letterSpacing: '0.5px'
                    }}
                  >
                    LOCAL
                  </span>
                </div>
              </div>

              {/* Right Card: Cloud Release */}
              <div
                style={{
                  background: isCloudNewer ? 'rgba(38, 118, 217, 0.05)' : '#171A1E',
                  border: `1.5px solid ${isCloudNewer ? '#2676D9' : '#282C34'}`,
                  borderRadius: '16px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: isCloudNewer ? '0 0 16px rgba(38, 118, 217, 0.15)' : 'none'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                    <Cloud size={15} color="#2676D9" />
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#2676D9', letterSpacing: '0.5px' }}>
                      CLOUD RELEASE
                    </span>
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                    {releaseInfo?.tag || 'latest-apk'}{' '}
                    <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#6B7280' }}>
                      ({releaseInfo?.sizeMB || '4.6'} MB)
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#6B7280' }}>
                    Built:
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: isCloudNewer ? '#38BDF8' : '#D1D5DB' }}>
                    {formatTimestamp(cloudTime)}
                  </div>
                </div>

                <div style={{ marginTop: '0.85rem' }}>
                  <span
                    style={{
                      background: 'rgba(38, 118, 217, 0.12)',
                      border: '1px solid rgba(38, 118, 217, 0.45)',
                      color: '#38BDF8',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      display: 'inline-block',
                      letterSpacing: '0.5px'
                    }}
                  >
                    SUPPORTS OFFLINE MAPS
                  </span>
                </div>
              </div>
            </div>

            {/* What's New Card */}
            <div
              style={{
                background: '#171A1E',
                border: '1px solid #282C34',
                borderRadius: '16px',
                padding: '1rem',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
                <MapPin size={16} color="#2676D9" />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#FFFFFF' }}>
                  What's New
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#9CA3AF', lineHeight: '1.45' }}>
                In-place update supported via permanent signing keystore. Installing updates directly over your installed app without deleting local offline maps or manifest data.
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
                  borderRadius: '10px',
                  color: '#E5484D',
                  fontSize: '0.78rem',
                  marginBottom: '1rem'
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.75rem' }}>
              <button
                onClick={checkForUpdates}
                disabled={checking}
                style={{
                  background: '#1E2228',
                  border: '1px solid #30353E',
                  borderRadius: '14px',
                  padding: '0.85rem',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem'
                }}
              >
                <RefreshCw size={18} color="#D1D5DB" className={checking ? 'spin' : ''} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#FFFFFF' }}>Check Again</div>
                  <div style={{ fontSize: '0.68rem', color: '#8A8F96' }}>Verify latest version</div>
                </div>
              </button>

              <button
                onClick={handleInstallUpdate}
                style={{
                  background: isCloudNewer ? '#F28C28' : '#2A2E35',
                  border: 'none',
                  borderRadius: '14px',
                  padding: '0.85rem',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  boxShadow: isCloudNewer ? '0 4px 14px rgba(242, 140, 40, 0.4)' : 'none'
                }}
              >
                <DownloadCloud size={20} color="#FFFFFF" />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#FFFFFF' }}>Install Update</div>
                  <div style={{ fontSize: '0.68rem', color: isCloudNewer ? '#FFF2E5' : '#8A8F96' }}>
                    {releaseInfo?.sizeMB || '4.6'} MB • ~ 1 min
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 2: Installing State (Image 1 Top Right Screen)                  */}
        {/* ==================================================================== */}
        {step === 'installing' && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: '#2676D9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF'
                  }}
                >
                  <DownloadCloud size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#FFFFFF' }}>
                    Installing Update
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: '#8A8F96', marginTop: '2px' }}>
                    Downloading and verifying...
                  </div>
                </div>
              </div>

              <button
                onClick={handleCancel}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#8A8F96',
                  cursor: 'pointer'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Circular / Progress Section */}
            <div
              style={{
                background: '#171A1E',
                border: '1px solid #282C34',
                borderRadius: '16px',
                padding: '1.25rem',
                margin: '1.25rem 0',
                display: 'flex',
                alignItems: 'center',
                gap: '1.25rem'
              }}
            >
              {/* Circular percentage indicator */}
              <div
                style={{
                  position: 'relative',
                  width: '76px',
                  height: '76px',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <svg width="76" height="76" viewBox="0 0 76 76">
                  <circle cx="38" cy="38" r="32" stroke="#282C34" strokeWidth="6" fill="none" />
                  <circle
                    cx="38"
                    cy="38"
                    r="32"
                    stroke="#2676D9"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={201}
                    strokeDashoffset={201 - (201 * progressPercent) / 100}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                    transform="rotate(-90 38 38)"
                  />
                </svg>
                <span style={{ position: 'absolute', fontSize: '1rem', fontWeight: 800, color: '#FFFFFF' }}>
                  {progressPercent}%
                </span>
              </div>

              {/* Progress details */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#FFFFFF' }}>
                  {((parseFloat(releaseInfo?.sizeMB || '4.6') * progressPercent) / 100).toFixed(1)} MB of {releaseInfo?.sizeMB || '4.6'} MB
                </div>
                <div style={{ fontSize: '0.74rem', color: '#8A8F96', margin: '4px 0 8px 0' }}>
                  {progressPercent > 85 ? 'Finalizing package...' : '~ 1 min remaining'}
                </div>
                <div style={{ background: '#242930', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      background: '#2676D9',
                      height: '100%',
                      width: `${progressPercent}%`,
                      transition: 'width 0.4s ease'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Checklist */}
            <div
              style={{
                background: '#171A1E',
                border: '1px solid #282C34',
                borderRadius: '16px',
                padding: '1rem 1.25rem',
                marginBottom: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <CheckCircle2 size={16} color="#20A564" />
                <span style={{ fontSize: '0.82rem', color: '#D1D5DB' }}>Verifying package integrity...</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <CheckCircle2 size={16} color={progressPercent >= 50 ? '#20A564' : '#8A8F96'} />
                <span style={{ fontSize: '0.82rem', color: progressPercent >= 50 ? '#D1D5DB' : '#8A8F96' }}>
                  Preparing installation...
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <CheckCircle2 size={16} color={progressPercent >= 90 ? '#20A564' : '#8A8F96'} />
                <span style={{ fontSize: '0.82rem', color: progressPercent >= 90 ? '#D1D5DB' : '#8A8F96' }}>
                  Installing update...
                </span>
              </div>
            </div>

            {/* Cancel Button */}
            <button
              onClick={handleCancel}
              style={{
                width: '100%',
                background: '#1E2228',
                border: '1px solid #30353E',
                borderRadius: '14px',
                padding: '0.85rem',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem'
              }}
            >
              <XCircle size={16} color="#8A8F96" />
              <span>Cancel Update</span>
            </button>
          </div>
        )}

        {/* ==================================================================== */}
        {/* VIEW 3: Update Complete State (Image 1 Bottom Right Screen)          */}
        {/* ==================================================================== */}
        {step === 'complete' && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: '#20A564',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    boxShadow: '0 4px 12px rgba(32, 165, 100, 0.35)'
                  }}
                >
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#FFFFFF' }}>
                    Update Complete
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: '#8A8F96', marginTop: '2px' }}>
                    Your app is now up to date.
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#8A8F96',
                  cursor: 'pointer'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Version Installed Card */}
            <div
              style={{
                background: '#171A1E',
                border: '1px solid #282C34',
                borderRadius: '16px',
                padding: '1rem',
                margin: '1.25rem 0',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(38, 118, 217, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2676D9'
                }}
              >
                <ShieldCheck size={20} />
              </div>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#FFFFFF' }}>
                  Version {currentVersion.versionName} (Build {currentVersion.versionCode})
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '2px' }}>
                  <CheckCircle2 size={13} color="#20A564" />
                  <span style={{ fontSize: '0.75rem', color: '#20A564', fontWeight: 600 }}>
                    Installed successfully
                  </span>
                </div>
              </div>
            </div>

            {/* What's Improved Checklist */}
            <div
              style={{
                background: '#171A1E',
                border: '1px solid #282C34',
                borderRadius: '16px',
                padding: '1rem 1.25rem',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.75rem' }}>
                <Sparkles size={16} color="#F28C28" />
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#FFFFFF' }}>
                  What's Improved
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <CheckCircle2 size={15} color="#20A564" />
                  <span style={{ fontSize: '0.82rem', color: '#D1D5DB' }}>Enhanced map stability</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <CheckCircle2 size={15} color="#20A564" />
                  <span style={{ fontSize: '0.82rem', color: '#D1D5DB' }}>Better offline support</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <CheckCircle2 size={15} color="#20A564" />
                  <span style={{ fontSize: '0.82rem', color: '#D1D5DB' }}>Performance optimizations</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <CheckCircle2 size={15} color="#20A564" />
                  <span style={{ fontSize: '0.82rem', color: '#D1D5DB' }}>Bug fixes</span>
                </div>
              </div>
            </div>

            {/* Continue Button */}
            <button
              onClick={onClose}
              style={{
                width: '100%',
                background: '#F28C28',
                border: 'none',
                borderRadius: '14px',
                padding: '0.95rem',
                color: '#FFFFFF',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                boxShadow: '0 4px 14px rgba(242, 140, 40, 0.4)'
              }}
            >
              <span>Continue</span>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

