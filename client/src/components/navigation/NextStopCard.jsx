import React from 'react';
import { Navigation, CheckCircle2, AlertTriangle, Key, Tag, X, Edit3, ExternalLink } from 'lucide-react';

export default function NextStopCard({
  stop,
  stopIndex = 0,
  totalStops = 0,
  isNavigating = false,
  distanceStr,
  etaStr,
  brandName,
  onNavigate,
  onMarkDelivered,
  onSkipStop,
  onEditGate,
  onLaunchExternalMaps,
  onClose,
  isFloating = false,
  t = (k) => k,
}) {
  if (!stop) return null;

  const addr = stop.address || {};
  const isStart = stopIndex === 0;
  const primaryTitle = stop.recipient || addr.recipient || addr.street || addr.raw || 'Pending Address';

  return (
    <div className={isFloating ? 'map-bottom-sheet' : 'nav-hero'}>
      {/* Header Pill & Counter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
        <span className="next-stop-pill">
          {isStart ? 'START ROUTE' : 'NEXT STOP'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-gray, #8A8F96)' }}>
            {t('stopOf', { current: stopIndex + 1, total: totalStops }) || `Stop ${stopIndex + 1} of ${totalStops}`}
          </span>
          {isFloating && onClose && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--color-gray, #8A8F96)', cursor: 'pointer', padding: '0.2rem' }}
              title="Close sheet"
            >
              <X size={17} />
            </button>
          )}
        </div>
      </div>

      {/* Stop Number Badge & Recipient / Address */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', marginBottom: '0.75rem' }}>
        <div className="next-stop-number-badge">
          {stopIndex + 1}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nav-hero-address">
            {primaryTitle}
          </div>
          <div style={{ color: 'var(--color-gray, #8A8F96)', fontSize: '0.82rem', lineHeight: '1.3' }}>
            {[addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')}
          </div>
        </div>
      </div>

      {/* Distance & ETA + Package Meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--color-gray, #8A8F96)' }}>
        {distanceStr && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#FFFFFF', fontWeight: 600 }}>
            <Navigation size={13} color="var(--color-blue-nav, #2676D9)" />
            <span>{distanceStr}</span>
            {etaStr && <span style={{ color: 'var(--color-gray, #8A8F96)', fontWeight: 400 }}>• {etaStr}</span>}
          </div>
        )}

        {stop.trackingNumber && (
          <div className="nav-hero-tracking">
            {t('package') || 'PKG'}: <strong>{stop.trackingNumber}</strong>
          </div>
        )}

        {brandName && (
          <span className="nav-hero-brand">
            <Tag size={12} style={{ display: 'inline', marginRight: '4px' }} />
            {brandName}
          </span>
        )}
      </div>

      {/* Gate Code & Notes */}
      {(addr.gateCode || onEditGate || addr.notes) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
          {addr.gateCode ? (
            <div className="gate-code-pill">
              <Key size={13} /> {t('gate') || 'Gate'}: #{addr.gateCode}
            </div>
          ) : null}

          {onEditGate && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderRadius: '8px' }}
              onClick={onEditGate}
            >
              <Edit3 size={12} /> {addr.gateCode ? (t('editGateNotes') || 'Edit Gate') : (t('addGateCode') || 'Add Gate Code')}
            </button>
          )}

          {addr.notes && (
            <div style={{ width: '100%', fontSize: '0.78rem', color: '#cbd5e1', fontStyle: 'italic', background: 'rgba(0, 0, 0, 0.25)', padding: '0.45rem 0.65rem', borderRadius: '8px' }}>
              {t('note') || 'Note'}: {addr.notes}
            </div>
          )}
        </div>
      )}

      {/* Full-width Action Orange Navigate Button */}
      {onNavigate && (
        <button
          className="btn-navigate-action"
          onClick={onNavigate}
          style={{ marginBottom: '0.65rem' }}
        >
          <Navigation size={18} />
          <span>
            {isNavigating
              ? (t('resumeNavigation') || 'Resume Navigation')
              : (t('startNavigationToStop', { number: stopIndex + 1 }) || `Start Navigation to Stop #${stopIndex + 1}`)}
          </span>
        </button>
      )}

      {/* External Google Maps Option (Non-floating) */}
      {!isFloating && onLaunchExternalMaps && (
        <div style={{ textAlign: 'center', marginTop: '0.1rem', marginBottom: '0.45rem' }}>
          <button
            onClick={onLaunchExternalMaps}
            style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '0.75rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <ExternalLink size={12} />
            <span>{t('openGoogleMaps') || 'Open in Google Maps'}</span>
          </button>
        </div>
      )}

      {/* Delivered / Skip Action Buttons */}
      {(onMarkDelivered || onSkipStop) && (
        <div className="nav-hero-buttons">
          {onMarkDelivered && (
            <button className="btn btn-success btn-lg" onClick={onMarkDelivered}>
              <CheckCircle2 size={18} />
              <span>{t('delivered') || 'Delivered'}</span>
            </button>
          )}
          {onSkipStop && (
            <button className="btn btn-secondary btn-lg" onClick={onSkipStop}>
              <AlertTriangle size={18} color="#f59e0b" />
              <span>{t('skipAttempt') || 'Skip / Attempt'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
