import React, { useState } from 'react';
import { DownloadCloud, Wifi, WifiOff, AlertTriangle, CheckCircle, Map, Compass } from 'lucide-react';
import { routingService } from '../services/routing';

export default function RegionDownloadPrompt({ region, onDownloaded, onDismiss }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [error, setError] = useState(null);

  const isWifi = routingService.isWifiConnection();
  const sizeMB = region.combinedSizeMB || (
    ((region.routing?.sizeMB || 0) + (region.basemap?.sizeMB || 0)).toFixed(1)
  );

  const handleStartDownload = async () => {
    setDownloading(true);
    setError(null);
    setProgress(10);
    setProgressStage('Initializing download connection...');

    try {
      setProgress(30);
      setProgressStage('Downloading Valhalla routing tile bundle...');

      // Small simulation tick to visually indicate multi-part download to user
      await new Promise(r => setTimeout(r, 400));
      setProgress(60);
      setProgressStage('Downloading PMTiles visual basemap archive...');

      await routingService.downloadRegion(region);

      setProgress(100);
      setProgressStage('Extraction complete. Offline map ready!');
      setTimeout(() => {
        if (onDownloaded) onDownloaded(region);
      }, 600);
    } catch (err) {
      console.error('Region download failed:', err);
      setError(err.message || 'Failed to download offline region data.');
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '440px' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(56, 189, 248, 0.15)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8',
              marginBottom: '0.75rem'
            }}
          >
            <Map size={28} />
          </div>
          <h3 className="card-title" style={{ fontSize: '1.25rem', justifyContent: 'center' }}>
            Offline Map Required
          </h3>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '0.5rem' }}>
            Offline map for <strong>{region.name || region.id}</strong> required (
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>{sizeMB} MB</span> — routing + visual map). Download now?
          </p>
        </div>

        {/* Network connection check */}
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
            {isWifi
              ? 'Connected via Wi-Fi (Recommended)'
              : 'Cellular connection detected. Wi-Fi is recommended to conserve mobile data.'}
          </span>
        </div>

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
            Later
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            disabled={downloading}
            onClick={handleStartDownload}
          >
            <DownloadCloud size={18} />
            <span>{downloading ? 'Downloading...' : 'Download Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
