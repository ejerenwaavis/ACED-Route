import React, { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, Play, Sparkles, MapPin, RefreshCw, CheckCircle, Navigation, ShieldAlert } from 'lucide-react';
import MapView from '../components/MapView';
import { api } from '../services/api';
import { useLanguage } from '../utils/i18n';

export default function SequencerPage({ manifest, onStartRoute }) {
  const { t } = useLanguage();
  const [stops, setStops] = useState([]);
  const [hasLearnedData, setHasLearnedData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!manifest?._id) return;
    loadSuggestedOrder();
  }, [manifest]);

  const loadSuggestedOrder = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSuggestedOrder(manifest._id);
      setHasLearnedData(data.hasLearnedData);
      if (data.stops && data.stops.length) {
        setStops(data.stops);
      } else {
        // Fallback to manifest.stops
        setStops(manifest.stops || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load suggested order.');
      setStops(manifest.stops || []);
    } finally {
      setLoading(false);
    }
  };

  const moveStop = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    setStops(next);
  };

  const handleStartRoute = async () => {
    setSaving(true);
    try {
      // Save current stop order
      await api.reorderManifest(manifest._id, stops);
      onStartRoute(stops);
    } catch (err) {
      console.warn('Reorder save warning:', err);
      // Still proceed to navigation
      onStartRoute(stops);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container">
      {/* Overview & status banner */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2 className="card-title">
              <Navigation size={22} color="#38bdf8" /> {t('routeSequencing')}
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              {t('reviewStopSequence')}
            </p>
          </div>
          <div>
            {hasLearnedData ? (
              <span className="badge badge-green" style={{ gap: '0.35rem' }}>
                <Sparkles size={12} /> {t('graphLearningActive')}
              </span>
            ) : (
              <span className="badge badge-yellow" title="Graph will accumulate as routes are completed">
                {t('initialSequence')}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(220, 38, 38, 0.15)', padding: '0.5rem 0.75rem', borderRadius: '6px', color: '#f87171', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            {error}
          </div>
        )}

        {/* Start Route CTA */}
        <button
          className="btn btn-success btn-block btn-lg"
          onClick={handleStartRoute}
          disabled={saving || stops.length === 0}
        >
          <Play size={20} />
          <span>{saving ? t('savingSequence') : t('startRouteStops', { count: stops.length })}</span>
        </button>
      </div>

      {/* Map visualization */}
      <MapView stops={stops} activeIndex={0} />

      {/* Reorderable Stop List */}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' }}>
            {t('stopOrder')} ({stops.length})
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={loadSuggestedOrder}>
            <RefreshCw size={12} /> {t('resetToSuggestion')}
          </button>
        </div>

        {stops.map((stop, i) => {
          const addr = stop.address || {};
          const street = addr.street || addr.raw || 'Pending Address';
          const locality = [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ');

          return (
            <div key={i} className="stop-card">
              <div className="stop-number">{i + 1}</div>

              <div className="stop-info">
                <div className="stop-address">{street}</div>
                <div className="stop-meta">
                  {locality && <span>{locality}</span>}
                  <span style={{ fontFamily: 'monospace' }}>{stop.trackingNumber}</span>
                  {addr.gateCode && (
                    <span style={{ color: '#fbbf24', fontWeight: 600 }}>Gate: #{addr.gateCode}</span>
                  )}
                </div>
              </div>

              <div className="stop-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.4rem 0.5rem' }}
                  disabled={i === 0}
                  onClick={() => moveStop(i, -1)}
                  title="Move Up"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.4rem 0.5rem' }}
                  disabled={i === stops.length - 1}
                  onClick={() => moveStop(i, 1)}
                  title="Move Down"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
