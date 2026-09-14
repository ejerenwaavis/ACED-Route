import React, { useState, useEffect } from 'react';
import {
  Navigation,
  CheckCircle2,
  AlertTriangle,
  Key,
  Tag,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Trophy,
  ArrowRight,
  Edit3
} from 'lucide-react';
import MapView from '../components/MapView';
import { api } from '../services/api';
import { routingService } from '../services/routing';
import { Capacitor } from '@capacitor/core';
import NativeHandoffModal from '../components/NativeHandoffModal';
import { useNavigationGuidance } from '../hooks/useNavigationGuidance';
import { t, getLanguage, translateManeuver } from '../utils/i18n';

export default function NavigationPage({ manifest, stops: initialStops, onRouteComplete }) {
  const [stops, setStops] = useState(initialStops || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [brandName, setBrandName] = useState(null);
  const [brandLoading, setBrandLoading] = useState(false);
  const [showGateModal, setShowGateModal] = useState(false);
  const [showNativeHandoff, setShowNativeHandoff] = useState(false);
  const [gateInput, setGateInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [completingRoute, setCompletingRoute] = useState(false);
  const [routeFinished, setRouteFinished] = useState(false);
  const [activeRouteCoords, setActiveRouteCoords] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentRouteResult, setCurrentRouteResult] = useState(null);

  const activeStop = stops[currentIndex] || null;
  const activeAddr = activeStop?.address || {};

  // Lookup brand whenever active stop changes
  useEffect(() => {
    if (!activeStop?.trackingNumber) {
      setBrandName(null);
      return;
    }
    const tracking = activeStop.trackingNumber;
    setBrandLoading(true);
    api.findBrand(tracking)
      .then((res) => setBrandName(res?.brand || null))
      .catch(() => setBrandName(null))
      .finally(() => setBrandLoading(false));

    // Initialize gate code and notes inputs
    setGateInput(activeAddr.gateCode || '');
    setNotesInput(activeStop.notes || activeAddr.notes || '');
  }, [currentIndex, activeStop]);

  // Track Driver GPS Location
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setDriverLocation([pos.coords.longitude, pos.coords.latitude]);
      },
      (err) => console.warn('GPS watch notice:', err.message),
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Calculate Offline Valhalla Route Leg to Active Stop
  useEffect(() => {
    let isCancelled = false;

    async function computeLeg() {
      if (!activeStop) return;
      const targetCoords = activeAddr.location?.coordinates || activeStop.coordinates;
      if (!targetCoords || targetCoords.length < 2) return;

      // Valhalla expects [lat, lng]
      const targetLatLng = [targetCoords[1], targetCoords[0]];

      let originLatLng = null;
      if (driverLocation) {
        if (Array.isArray(driverLocation) && driverLocation.length >= 2) {
          originLatLng = [driverLocation[1], driverLocation[0]];
        } else if (driverLocation.latitude != null && driverLocation.longitude != null) {
          originLatLng = [driverLocation.latitude, driverLocation.longitude];
        }
      } else if (currentIndex > 0) {
        const prev = stops[currentIndex - 1];
        const prevCoords = prev.address?.location?.coordinates || prev.coordinates;
        if (prevCoords && prevCoords.length >= 2) {
          originLatLng = [prevCoords[1], prevCoords[0]];
        }
      }

      if (!originLatLng) {
        originLatLng = [targetLatLng[0] - 0.015, targetLatLng[1] - 0.015];
      }

      try {
        const routeResult = await routingService.calculateRoute(originLatLng, targetLatLng);
        if (!isCancelled && routeResult && routeResult.coordinates && routeResult.coordinates.length) {
          setCurrentRouteResult(routeResult);
          setActiveRouteCoords(routeResult.coordinates);
        }
      } catch (err) {
        // Fall back gracefully if offline bundle not yet downloaded on current device
        if (!isCancelled) {
          setCurrentRouteResult(null);
          setActiveRouteCoords(null);
        }
      }
    }

    computeLeg();
    return () => {
      isCancelled = true;
    };
  }, [currentIndex, activeStop, driverLocation]);

  // Off-route rerouting handler
  const handleRerouteNeeded = async (newStartCoords) => {
    if (!activeStop) return;
    const targetCoords = activeAddr.location?.coordinates || activeStop.coordinates;
    if (!targetCoords || targetCoords.length < 2) return;
    const targetLatLng = [targetCoords[1], targetCoords[0]];

    try {
      const routeResult = await routingService.calculateRoute(newStartCoords, targetLatLng);
      if (routeResult && routeResult.coordinates && routeResult.coordinates.length) {
        setCurrentRouteResult(routeResult);
        setActiveRouteCoords(routeResult.coordinates);
      }
    } catch (err) {
      console.warn('Reroute calculation failed:', err);
    }
  };

  // Turn-by-turn guidance engine
  const guidance = useNavigationGuidance({
    route: currentRouteResult,
    currentLocation: driverLocation
      ? (Array.isArray(driverLocation)
          ? { longitude: driverLocation[0], latitude: driverLocation[1], bearing: 0, speed: 0 }
          : driverLocation)
      : null,
    onRerouteNeeded: handleRerouteNeeded,
    isMuted,
    language: getLanguage(),
  });

  // Attach native foreground tracking listener when isNavigating is active
  useEffect(() => {
    if (!isNavigating) return;

    let sub = null;
    try {
      sub = routingService.addLocationListener((loc) => {
        if (loc && loc.latitude != null && loc.longitude != null) {
          setDriverLocation(loc);
        }
      });
    } catch (e) {
      console.warn('Failed to attach location listener:', e);
    }

    return () => {
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, [isNavigating]);

  // Clean up foreground service on unmount
  useEffect(() => {
    return () => {
      routingService.stopNavigationTracking();
      routingService.stopSpeech();
    };
  }, []);

  // In-App Turn-by-Turn Navigation Launch
  const handleLaunchNavigation = async () => {
    if (!activeStop) return;

    // Intercept web browser: native app is required for turn-by-turn navigation
    if (!Capacitor.isNativePlatform()) {
      setShowNativeHandoff(true);
      return;
    }

    setIsNavigating(true);
    await routingService.startNavigationTracking();
  };

  const handleExitNavigation = async () => {
    setIsNavigating(false);
    await routingService.stopNavigationTracking();
    await routingService.stopSpeech();
  };

  // External Maps fallback
  const handleLaunchExternalMaps = () => {
    if (!activeStop) return;
    const coords = activeAddr.location?.coordinates || [-73.9851, 40.7488];
    const [lng, lat] = coords;
    const street = activeAddr.street || activeAddr.raw || '';

    const googleNavUri = `google.navigation:q=${lat},${lng}&mode=d`;
    const webMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      lat && lng ? `${lat},${lng}` : street
    )}`;

    if (window.Capacitor && window.Capacitor.getPlatform() === 'android') {
      window.location.href = googleNavUri;
      setTimeout(() => {
        window.open(webMapsUrl, '_system');
      }, 500);
    } else {
      window.open(webMapsUrl, '_blank');
    }
  };

  // Mark Active Stop as Delivered
  const handleMarkDelivered = async () => {
    if (!activeStop) return;
    const updated = [...stops];
    updated[currentIndex] = {
      ...updated[currentIndex],
      status: 'delivered',
      completedAt: new Date()
    };
    setStops(updated);

    try {
      await api.updateStop(manifest._id, currentIndex, { status: 'delivered' });
    } catch (err) {
      console.warn('Update stop failed:', err);
    }

    // Auto advance to next pending stop
    advanceToNextPending(updated);
  };

  // Skip stop
  const handleSkipStop = async () => {
    if (!activeStop) return;
    const updated = [...stops];
    updated[currentIndex] = {
      ...updated[currentIndex],
      status: 'skipped'
    };
    setStops(updated);

    try {
      await api.updateStop(manifest._id, currentIndex, { status: 'skipped', notes: 'Skipped by driver' });
    } catch (err) {
      console.warn('Skip stop failed:', err);
    }

    advanceToNextPending(updated);
  };

  const advanceToNextPending = (currentStops) => {
    const nextPendingIdx = currentStops.findIndex(
      (s, i) => i > currentIndex && s.status !== 'delivered' && s.status !== 'skipped'
    );
    if (nextPendingIdx !== -1) {
      setCurrentIndex(nextPendingIdx);
    } else {
      // Check if any stops left overall
      const anyPending = currentStops.findIndex(
        (s) => s.status !== 'delivered' && s.status !== 'skipped'
      );
      if (anyPending !== -1) {
        setCurrentIndex(anyPending);
      } else {
        // All done!
        handleFinishRoute(currentStops);
      }
    }
  };

  // Save gate code / notes
  const handleSaveGateInfo = async () => {
    try {
      await api.updateStop(manifest._id, currentIndex, {
        gateCode: gateInput,
        notes: notesInput
      });
      // Update local state
      const updated = [...stops];
      updated[currentIndex].address = {
        ...updated[currentIndex].address,
        gateCode: gateInput,
        isGated: !!gateInput,
        notes: notesInput
      };
      setStops(updated);
      setShowGateModal(false);
    } catch (err) {
      alert('Failed to save gate code: ' + err.message);
    }
  };

  // Finish Route and POST /api/manifest/:id/complete
  const handleFinishRoute = async (finalStops = stops) => {
    setCompletingRoute(true);
    try {
      // Build finalOrder array of address IDs in the sequence they were visited
      const finalOrder = finalStops
        .map((s) => s.address?._id || s.address)
        .filter(Boolean);

      await api.completeManifest(manifest._id, finalOrder);
      setRouteFinished(true);
      if (onRouteComplete) onRouteComplete();
    } catch (err) {
      alert('Error completing route: ' + err.message);
    } finally {
      setCompletingRoute(false);
    }
  };

  const deliveredCount = stops.filter((s) => s.status === 'delivered').length;
  const progressPercent = stops.length ? Math.round((deliveredCount / stops.length) * 100) : 0;

  if (routeFinished) {
    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <div style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'rgba(22, 163, 74, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem',
            border: '2px solid #16a34a'
          }}>
            <Trophy size={36} color="#4ade80" />
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Route Completed!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            All stops marked. Your finalized stop order was logged into the <strong>RouteEdge</strong> learning graph. Future routes for these locations will sequence automatically!
          </p>

          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '12px',
            padding: '1rem',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#4ade80' }}>{deliveredCount}</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Stops Delivered</div>
            </div>
            <div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#38bdf8' }}>{stops.length}</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Total Stops</div>
            </div>
          </div>

          <button className="btn btn-primary btn-block btn-lg" onClick={() => window.location.reload()}>
            Back to Upload / Manifests
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Route Progress Bar */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
          <span>Route Progress</span>
          <span>{deliveredCount} of {stops.length} stops ({progressPercent}%)</span>
        </div>
        <div style={{ width: '100%', height: '8px', background: '#0f172a', borderRadius: '999px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progressPercent}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #2563eb, #16a34a)',
              transition: 'width 0.3s ease'
            }}
          />
        </div>
      </div>

      {/* Active Stop Hero Box */}
      {activeStop ? (
        <div className="nav-hero">
          <div className="nav-hero-header">
            <div>
              <span className="badge badge-blue" style={{ marginBottom: '0.5rem' }}>
                Stop {currentIndex + 1} of {stops.length}
              </span>
              <div className="nav-hero-address">
                {activeAddr.street || activeAddr.raw || 'Pending Address'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                {[activeAddr.city, activeAddr.state, activeAddr.postalCode].filter(Boolean).join(', ')}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <div className="nav-hero-tracking">
              PKG: <strong>{activeStop.trackingNumber}</strong>
            </div>

            {brandName && (
              <span className="nav-hero-brand">
                <Tag size={12} style={{ display: 'inline', marginRight: '4px' }} />
                {brandName}
              </span>
            )}
          </div>

          {/* Gate code pill & Edit button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {activeAddr.gateCode ? (
              <div className="gate-code-pill">
                <Key size={14} /> Gate: #{activeAddr.gateCode}
              </div>
            ) : null}

            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              onClick={() => setShowGateModal(true)}
            >
              <Edit3 size={12} /> {activeAddr.gateCode ? 'Edit Gate/Notes' : '+ Add Gate Code'}
            </button>
          </div>

          {activeAddr.notes && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#cbd5e1', fontStyle: 'italic' }}>
              Note: {activeAddr.notes}
            </div>
          )}

          {/* In-App Turn-by-Turn Launch Button */}
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={handleLaunchNavigation}
            style={{ marginTop: '1.25rem', gap: '0.75rem' }}
          >
            <Navigation size={22} />
            <span>{isNavigating ? 'Resume In-App Navigation' : `Start Navigation to Stop #${currentIndex + 1}`}</span>
          </button>

          {/* External Navigation Link Option */}
          <div style={{ textAlign: 'center', marginTop: '0.4rem', marginBottom: '0.5rem' }}>
            <button
              onClick={handleLaunchExternalMaps}
              style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '0.75rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <ExternalLink size={12} />
              <span>Open in Google Maps</span>
            </button>
          </div>

          {/* Action Buttons: Delivered / Skip */}
          <div className="nav-hero-buttons">
            <button className="btn btn-success btn-lg" onClick={handleMarkDelivered}>
              <CheckCircle2 size={20} />
              <span>Delivered</span>
            </button>
            <button className="btn btn-secondary btn-lg" onClick={handleSkipStop}>
              <AlertTriangle size={18} color="#f59e0b" />
              <span>Skip / Attempt</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Interactive Map view with Phase 4 Turn-by-Turn Guidance */}
      <MapView
        stops={stops}
        activeIndex={currentIndex}
        activeRouteCoordinates={activeRouteCoords}
        driverLocation={driverLocation}
        onSelectStop={(idx) => setCurrentIndex(idx)}
        onNavigateHere={(idx) => setCurrentIndex(idx)}
        onNavigateInSequence={() => advanceToNextPending(stops)}
        guidance={guidance ? { ...guidance, isMuted, onToggleMute: () => setIsMuted(m => !m), language: getLanguage() } : null}
        isNavigating={isNavigating}
        onExitNavigation={handleExitNavigation}
      />

      {/* Stop Sequence Cards */}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' }}>All Stops</h3>
          <button
            className="btn btn-warning btn-sm"
            onClick={() => handleFinishRoute()}
            disabled={completingRoute}
          >
            {completingRoute ? 'Finishing...' : 'Complete Route Now'}
          </button>
        </div>

        {stops.map((stop, i) => {
          const addr = stop.address || {};
          const isCurrent = i === currentIndex;
          const isDelivered = stop.status === 'delivered';
          const isSkipped = stop.status === 'skipped';

          return (
            <div
              key={i}
              className={`stop-card ${isCurrent ? 'active-stop' : ''} ${isDelivered ? 'delivered-stop' : ''}`}
              onClick={() => setCurrentIndex(i)}
              style={{ cursor: 'pointer' }}
            >
              <div className="stop-number">
                {isDelivered ? <CheckCircle2 size={18} /> : i + 1}
              </div>

              <div className="stop-info">
                <div className="stop-address">
                  {addr.street || addr.raw || 'Address'}
                </div>
                <div className="stop-meta">
                  <span style={{ fontFamily: 'monospace' }}>{stop.trackingNumber}</span>
                  {addr.gateCode && (
                    <span style={{ color: '#fbbf24', fontWeight: 600 }}>Gate: #{addr.gateCode}</span>
                  )}
                  {isSkipped && <span className="badge badge-yellow">Skipped</span>}
                </div>
              </div>

              <ChevronRight size={16} color={isCurrent ? '#38bdf8' : '#64748b'} />
            </div>
          );
        })}
      </div>

      {/* Gate Code / Notes Edit Modal */}
      {showGateModal && (
        <div className="modal-overlay" onClick={() => setShowGateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>
              <Key size={18} color="#fbbf24" /> Delivery Access & Gate Code
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
              Saved gate codes are stored permanently on this address and shared across ACED tools.
            </p>

            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
              Gate Code:
            </label>
            <input
              type="text"
              placeholder="e.g. 1234 or #5678"
              value={gateInput}
              onChange={(e) => setGateInput(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 600,
                marginBottom: '1rem'
              }}
            />

            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
              Driver Notes (e.g. dogs, back entrance):
            </label>
            <textarea
              rows={3}
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                fontSize: '0.85rem',
                marginBottom: '1.25rem'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowGateModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveGateInfo}>
                Save Details
              </button>
            </div>
          </div>
        </div>
      )}

      <NativeHandoffModal
        isOpen={showNativeHandoff}
        onClose={() => setShowNativeHandoff(false)}
        schemeUri={`acedroute://manifest/${manifest?._id || ''}?stop=${currentIndex}`}
        message="To download offline maps and use turn-by-turn navigation, you must use the ACED Route mobile app."
      />
    </div>
  );
}
