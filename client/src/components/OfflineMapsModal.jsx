import React, { useState, useEffect } from 'react';
import { X, Map, DownloadCloud, Trash2, RefreshCw, CheckCircle, Wifi, Compass, AlertCircle, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { api } from '../services/api';
import { routingService } from '../services/routing';
import NativeHandoffModal from './NativeHandoffModal';

export default function OfflineMapsModal({ isOpen, onClose, onRegionSelected }) {
  const [regions, setRegions] = useState([]);
  const [installedMap, setInstalledMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const [error, setError] = useState(null);
  const [activeRegion, setActiveRegion] = useState(routingService.getActiveRegion());
  const [showNativeHandoff, setShowNativeHandoff] = useState(false);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isOpen) {
      loadCatalog();
    }
  }, [isOpen]);

  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRegions();
      const list = data.regions || [];
      setRegions(list);

      // Check local installation state for each region
      const stateObj = {};
      for (const r of list) {
        const check = await routingService.checkRegion(r.id);
        stateObj[r.id] = check;
      }
      setInstalledMap(stateObj);
    } catch (err) {
      console.error('Failed to load regions catalog:', err);
      setError('Failed to fetch offline regions catalog from server.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (region) => {
    // Web interception: open NativeHandoffModal
    if (!isNative) {
      setShowNativeHandoff(true);
      return;
    }

    setActionLoading(prev => ({ ...prev, [region.id]: 'downloading' }));
    try {
      await routingService.downloadRegion(region);
      const check = await routingService.checkRegion(region.id);
      setInstalledMap(prev => ({ ...prev, [region.id]: check }));
      setActiveRegion(region.id);
      if (onRegionSelected) onRegionSelected(region);
    } catch (err) {
      alert('Download error: ' + err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [region.id]: null }));
    }
  };

  const handleDelete = async (region) => {
    if (!confirm(`Delete offline map for ${region.name}? You will need an internet connection to re-download it.`)) {
      return;
    }
    setActionLoading(prev => ({ ...prev, [region.id]: 'deleting' }));
    try {
      await routingService.deleteRegion(region.id);
      const check = await routingService.checkRegion(region.id);
      setInstalledMap(prev => ({ ...prev, [region.id]: check }));
      if (activeRegion === region.id) {
        setActiveRegion(null);
      }
    } catch (err) {
      alert('Delete error: ' + err.message);
    } finally {
      setActionLoading(prev => ({ ...prev, [region.id]: null }));
    }
  };

  const [detecting, setDetecting] = useState(false);
  const [detectFeedback, setDetectFeedback] = useState(null);

  const handleAutoDetect = async () => {
    setDetecting(true);
    setDetectFeedback({ type: 'info', message: 'Detecting depot location...' });

    const matchCoords = async (lat, lng, source) => {
      try {
        const res = await api.detectRegion({ lat, lng });
        if (res && res.region) {
          setDetectFeedback({
            type: 'success',
            message: `Detected: ${res.region.name} (${source})`
          });
          const el = document.getElementById(`region-card-${res.region.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
            el.style.boxShadow = '0 0 0 3px #38bdf8';
            setTimeout(() => { if (el) el.style.boxShadow = ''; }, 3500);
          }
          return true;
        }
      } catch (e) {
        console.error('Region match error:', e);
      }
      return false;
    };

    const tryGeolocation = (options) => {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      });
    };

    let matched = false;

    // Tier 1: Low-accuracy fast network/wifi position (resolves in <500ms indoors)
    try {
      const pos = await tryGeolocation({ enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 });
      matched = await matchCoords(pos.coords.latitude, pos.coords.longitude, 'Device Location');
    } catch (err1) {
      console.warn('Low accuracy geolocation failed, trying high accuracy...', err1);
      // Tier 2: GPS satellite high accuracy
      try {
        const pos = await tryGeolocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
        matched = await matchCoords(pos.coords.latitude, pos.coords.longitude, 'GPS');
      } catch (err2) {
        console.warn('High accuracy geolocation failed, trying IP fallback...', err2);
      }
    }

    // Tier 3: IP Geolocation fallback (works indoors even if GPS permission is denied or timed out)
    if (!matched) {
      try {
        setDetectFeedback({ type: 'info', message: 'Checking network location...' });
        const ipRes = await fetch('https://ipapi.co/json/').then(r => r.json()).catch(() => null);
        if (ipRes && ipRes.latitude && ipRes.longitude) {
          matched = await matchCoords(ipRes.latitude, ipRes.longitude, `${ipRes.city || ipRes.region || 'Network'}`);
        }
      } catch (ipErr) {
        console.warn('IP geolocation failed:', ipErr);
      }
    }

    if (!matched) {
      setDetectFeedback({
        type: 'warning',
        message: 'Could not pinpoint depot region automatically. Please select your region from the list below.'
      });
    }

    setDetecting(false);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Map size={22} color="#38bdf8" />
              <h3 className="card-title" style={{ margin: 0 }}>Offline Map Regions</h3>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>

          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
            Pre-built regional packages containing Valhalla routing tiles and PMTiles vector basemaps.
            Download over Wi-Fi for 100% offline navigation in Airplane Mode.
          </p>

          {/* Web Handoff Notification Banner */}
          {!isNative && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                marginBottom: '1rem',
                gap: '0.75rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Smartphone size={20} color="#38bdf8" />
                <div style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>
                  <strong>Web Browser Active:</strong> Offline maps & turn-by-turn navigation run natively in the mobile app.
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowNativeHandoff(true)}
                style={{ whiteSpace: 'nowrap' }}
              >
                Get Mobile App
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleAutoDetect}
              disabled={detecting}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {detecting ? <RefreshCw size={14} className="spin" /> : <Compass size={14} />}
              <span>{detecting ? 'Detecting Region...' : 'Detect Current Depot Region'}</span>
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={loadCatalog}
              disabled={detecting || loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
          </div>

          {detectFeedback && (
            <div
              style={{
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                fontSize: '0.8rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background:
                  detectFeedback.type === 'success'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : detectFeedback.type === 'warning'
                    ? 'rgba(234, 179, 8, 0.15)'
                    : detectFeedback.type === 'error'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(56, 189, 248, 0.15)',
                color:
                  detectFeedback.type === 'success'
                    ? '#4ade80'
                    : detectFeedback.type === 'warning'
                    ? '#facc15'
                    : detectFeedback.type === 'error'
                    ? '#f87171'
                    : '#38bdf8',
                border: `1px solid ${
                  detectFeedback.type === 'success'
                    ? 'rgba(34, 197, 94, 0.3)'
                    : detectFeedback.type === 'warning'
                    ? 'rgba(234, 179, 8, 0.3)'
                    : detectFeedback.type === 'error'
                    ? 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(56, 189, 248, 0.3)'
                }`
              }}
            >
              {detectFeedback.type === 'success' && <CheckCircle size={16} />}
              {detectFeedback.type === 'warning' && <AlertCircle size={16} />}
              {detectFeedback.type === 'error' && <AlertCircle size={16} />}
              {detectFeedback.type === 'info' && <RefreshCw size={16} className="spin" />}
              <span>{detectFeedback.message}</span>
            </div>
          )}

          {error && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '0.65rem', borderRadius: '8px', color: '#f87171', fontSize: '0.8rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#94a3b8', fontSize: '0.9rem' }}>
              Checking installed offline regions...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '380px', overflowY: 'auto' }}>
              {regions.map((r) => {
                const installedInfo = installedMap[r.id] || { available: false, sizeMB: 0 };
                const isInstalled = installedInfo.available || installedInfo.hasRoutingTiles;
                const isBusy = actionLoading[r.id];

                return (
                  <div
                    key={r.id}
                    id={`region-card-${r.id}`}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '10px',
                      background: '#1e293b',
                      border: activeRegion === r.id ? '2px solid #38bdf8' : '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.95rem' }}>
                            {r.name}
                          </span>
                          {activeRegion === r.id && (
                            <span className="badge badge-blue" style={{ fontSize: '0.7rem' }}>
                              Active
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                          {r.description}
                        </p>
                      </div>

                      <div>
                        {isInstalled ? (
                          <span
                            className="badge badge-green"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          >
                            <CheckCircle size={12} /> Installed ({installedInfo.sizeMB || r.combinedSizeMB} MB)
                          </span>
                        ) : (
                          <span className="badge badge-yellow">
                            Available ({r.combinedSizeMB} MB)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Components overview */}
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
                      <span>Valhalla Routing: {r.routing?.sizeMB} MB</span>
                      <span>PMTiles Basemap: {r.basemap?.sizeMB} MB</span>
                      <span>Version: {r.routing?.version}</span>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                      {isInstalled ? (
                        <>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDownload(r)}
                            disabled={!!isBusy}
                            title="Re-download / update regional tiles"
                          >
                            <RefreshCw size={13} />
                            <span>{isBusy === 'downloading' ? 'Updating...' : 'Update'}</span>
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ color: '#f87171' }}
                            onClick={() => handleDelete(r)}
                            disabled={!!isBusy}
                          >
                            <Trash2 size={13} />
                            <span>{isBusy === 'deleting' ? 'Deleting...' : 'Delete'}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleDownload(r)}
                          disabled={!!isBusy}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                        >
                          {isNative ? <DownloadCloud size={14} /> : <Smartphone size={14} />}
                          <span>
                            {isBusy === 'downloading'
                              ? 'Downloading...'
                              : (isNative ? 'Download Bundle' : 'Download via App')}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>

      <NativeHandoffModal
        isOpen={showNativeHandoff}
        onClose={() => setShowNativeHandoff(false)}
      />
    </>
  );
}
