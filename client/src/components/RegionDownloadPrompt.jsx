import React, { useState, useEffect } from 'react';
import { DownloadCloud, Wifi, WifiOff, AlertTriangle, CheckCircle, Map, Compass, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { routingService } from '../services/routing';
import NativeHandoffModal from './NativeHandoffModal';
import { t } from '../utils/i18n';

export default function RegionDownloadPrompt({ region, onDownloaded, onDismiss }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [error, setError] = useState(null);
  const [showNativeHandoff, setShowNativeHandoff] = useState(false);
  const [isWifi, setIsWifi] = useState(true);

  const isNative = Capacitor.isNativePlatform();
  const sizeMB = region.combinedSizeMB || (
    ((region.routing?.sizeMB || 0) + (region.basemap?.sizeMB || 0)).toFixed(1)
  );

  useEffect(() => {
    let isMounted = true;
    routingService.isWifiConnection().then((res) => {
      if (isMounted) setIsWifi(res);
    });
    return () => { isMounted = false; };
  }, []);

  const handleStartDownload = async () => {
    // Intercept web browser: native device storage is required for offline tiles
    if (!isNative) {
      setShowNativeHandoff(true);
      return;
    }

    setDownloading(true);
    setError(null);
    setProgress(10);
    setProgressStage(t('downloadingTiles'));

    try {
      setProgress(30);
      setProgressStage(t('downloadingTiles'));

      await new Promise(r => setTimeout(r, 400));
      setProgress(60);
      setProgressStage(t('downloadingBasemap'));

      await routingService.downloadRegion(region);

      setProgress(100);
      setProgressStage(t('extractionComplete'));
      setTimeout(() => {
        if (onDownloaded) onDownloaded(region);
      }, 600);
    } catch (err) {
      console.error('Region download failed:', err);
      setError(err.message || 'Failed to download offline region data.');
      setDownloading(false);
    }
  };

  const regionName = region.displayName || region.name || region.id || 'Current Region';

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: '440px' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 0.75rem',
                color: '#38bdf8'
              }}
            >
              <Map size={28} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.35rem' }}>
              {t('offlineMapRequired')}
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.4 }}>
              {t('offlineMapDesc', { region: regionName, size: sizeMB })}
            </p>
          </div>

          {/* Network Badge */}
          {!isNative ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                fontSize: '0.8rem',
                marginBottom: '1.25rem',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                color: '#38bdf8'
              }}
            >
              <Smartphone size={16} />
              <span>
                Web browser active. Offline maps run natively in the ACED Route mobile app.
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                fontSize: '0.8rem',
                marginBottom: '1.25rem',
                background: isWifi ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                border: isWifi ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(234, 179, 8, 0.25)',
                color: isWifi ? '#4ade80' : '#facc15'
              }}
            >
              {isWifi ? <Wifi size={16} /> : <WifiOff size={16} />}
              <span>
                {isWifi ? t('wifiConnected') : t('cellularDetected')}
              </span>
            </div>
          )}

          {/* Progress Bar during download */}
          {downloading && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                <span>{progressStage}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#334155', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #38bdf8, #22c55e)',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                fontSize: '0.8rem',
                marginBottom: '1rem',
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center'
              }}
            >
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1 }}
              disabled={downloading}
              onClick={onDismiss}
            >
              {t('later')}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              disabled={downloading}
              onClick={handleStartDownload}
            >
              {isNative ? <DownloadCloud size={18} /> : <Smartphone size={18} />}
              <span>
                {downloading ? 'Downloading...' : (isNative ? t('downloadNow') : 'Download via App')}
              </span>
            </button>
          </div>
        </div>
      </div>

      <NativeHandoffModal
        isOpen={showNativeHandoff}
        onClose={() => setShowNativeHandoff(false)}
        message={`Offline maps for ${regionName} (${sizeMB} MB) run locally on device storage. To download offline tiles and start turn-by-turn navigation, open or download the ACED Route mobile app.`}
      />
    </>
  );
}
