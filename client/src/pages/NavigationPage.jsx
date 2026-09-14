import React, { useState, useEffect, useRef } from 'react';
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
  Edit3,
  MapPin,
  Clock
} from 'lucide-react';
import MapView from '../components/MapView';
import { api } from '../services/api';
import { routingService } from '../services/routing';
import { Capacitor } from '@capacitor/core';
import NativeHandoffModal from '../components/NativeHandoffModal';
import NextStopCard from '../components/navigation/NextStopCard';
import { useNavigationGuidance } from '../hooks/useNavigationGuidance';
import { useLanguage, getLanguage, translateManeuver } from '../utils/i18n';
import { haversineDistance, getStopCoords } from '../utils/geoUtils';
import { getCachedCoordinates } from '../utils/geocodeCache';

export default function NavigationPage({ manifest, stops: initialStops, onRouteComplete }) {
  const { t, lang } = useLanguage();
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
  const [sequenceRouteCoords, setSequenceRouteCoords] = useState(null);
  const [isSequenceRoadSnapped, setIsSequenceRoadSnapped] = useState(true);
  const [activeRouteCoords, setActiveRouteCoords] = useState(null);
  const [isActiveRoadSnapped, setIsActiveRoadSnapped] = useState(true);
  const [driverLocation, setDriverLocation] = useState(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentRouteResult, setCurrentRouteResult] = useState(null);

  // Synchronize incoming stops prop or manifest.stops into local stops state
  useEffect(() => {
    if (initialStops && initialStops.length > 0) {
      setStops(initialStops);
    }
  }, [initialStops]);

  useEffect(() => {
    if ((!stops || stops.length === 0) && manifest?.stops && manifest.stops.length > 0) {
      setStops(manifest.stops);
    }
  }, [manifest]);

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

  // Calculate Road-Snapped Sequence Route across all manifest stops via Valhalla
  useEffect(() => {
    let isMounted = true;
    const fetchSequenceRoute = async () => {
      if (!stops || stops.length < 2) {
        if (isMounted) {
          setSequenceRouteCoords(null);
          setIsSequenceRoadSnapped(true);
        }
        return;
      }
      const stopPoints = stops.map(getStopCoords).filter(Boolean);

      if (stopPoints.length < 2) {
        if (isMounted) {
          setSequenceRouteCoords(null);
          setIsSequenceRoadSnapped(false);
        }
        return;
      }

      try {
        const result = await routingService.calculateSequenceRoute(stopPoints);
        if (isMounted && result) {
          setSequenceRouteCoords(result.coordinates);
          setIsSequenceRoadSnapped(Boolean(result.isRoadSnapped));
        }
      } catch (err) {
        console.warn('Sequence route calculation error:', err);
        if (isMounted) {
          setSequenceRouteCoords(null);
          setIsSequenceRoadSnapped(false);
        }
      }
    };

    fetchSequenceRoute();
    return () => { isMounted = false; };
  }, [stops]);

  // Track Driver GPS Location with Heading Calculation & Speed Smoothing
  const lastGpsPosRef = useRef(null);
  const lastGpsHeadingRef = useRef(0);
  const hasGpsLockedRef = useRef(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const speed = pos.coords.speed ?? 0;
        let bearing = pos.coords.heading;

        if (lastGpsPosRef.current) {
          const distMoved = haversineDistance(lastGpsPosRef.current.lat, lastGpsPosRef.current.lng, lat, lng);
          // Only recompute heading if moved >= 2.5 meters to prevent stationary jitter
          if (distMoved >= 2.5) {
            const y = Math.sin((lng - lastGpsPosRef.current.lng) * Math.PI / 180) * Math.cos(lat * Math.PI / 180);
            const x = Math.cos(lastGpsPosRef.current.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) -
                      Math.sin(lastGpsPosRef.current.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos((lng - lastGpsPosRef.current.lng) * Math.PI / 180);
            const calcBrng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            bearing = calcBrng;
            lastGpsHeadingRef.current = calcBrng;
            lastGpsPosRef.current = { lat, lng };
          } else {
            bearing = lastGpsHeadingRef.current;
          }
        } else {
          lastGpsPosRef.current = { lat, lng };
          if (bearing == null || isNaN(bearing)) bearing = 0;
          lastGpsHeadingRef.current = bearing;
        }

        setDriverLocation({
          latitude: lat,
          longitude: lng,
          bearing: bearing ?? lastGpsHeadingRef.current,
          speed: speed
        });
      },
      (err) => console.warn('GPS watch notice:', err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Stable ref so computeLeg can read current GPS without being in its deps array
  const driverLocationRef = useRef(driverLocation);
  useEffect(() => {
    driverLocationRef.current = driverLocation;
  }, [driverLocation]);

  // Calculate Offline Valhalla Route Leg to Active Stop.
  const computeLegRef = useRef(null);
  computeLegRef.current = async function computeLeg() {
    if (!activeStop) return;
    const targetCoords = getStopCoords(activeStop) || getStopCoords(activeAddr);
    if (!targetCoords || targetCoords.length < 2) return;

    const curDriverLoc = driverLocationRef.current;
    let originCoords = null;
    if (curDriverLoc) {
      if (Array.isArray(curDriverLoc) && curDriverLoc.length >= 2) {
        originCoords = [curDriverLoc[0], curDriverLoc[1]];
      } else if (curDriverLoc.longitude != null && curDriverLoc.latitude != null) {
        originCoords = [curDriverLoc.longitude, curDriverLoc.latitude];
      }
    } else if (currentIndex > 0) {
      const prev = stops[currentIndex - 1];
      const prevCoords = getStopCoords(prev);
      if (prevCoords) {
        originCoords = prevCoords;
      }
    }

    if (!originCoords) {
      // User requirement: When driverLocation is null, render NO active-route line or dot trail
      // and NO misleading synthetic starting point.
      setActiveRouteCoords(null);
      setCurrentRouteResult(null);
      setIsActiveRoadSnapped(true);
      return;
    }

    try {
      const routeResult = await routingService.calculateRoute(originCoords, targetCoords);
      if (routeResult && routeResult.coordinates && routeResult.coordinates.length) {
        setCurrentRouteResult(routeResult);
        setActiveRouteCoords(routeResult.coordinates);
        setIsActiveRoadSnapped(Boolean(routeResult.isRoadSnapped));
        return;
      }
    } catch (err) {
      // Fallback offline endpoint route
    }

    // Direct endpoints between driver and active stop (isRoadSnapped: false triggers dot trail)
    const directCoords = [originCoords, targetCoords];
    setActiveRouteCoords(directCoords);
    setIsActiveRoadSnapped(false);
    const distMeters = haversineDistance(originCoords[1], originCoords[0], targetCoords[1], targetCoords[0]);
    setCurrentRouteResult({
      coordinates: directCoords,
      isRoadSnapped: false,
      summary: {
        length: distMeters / 1000,
        time: Math.round(distMeters / 11.1)
      },
      instructions: [
        {
          instruction: 'Head toward destination',
          distanceMeters: distMeters,
          timeSeconds: Math.round(distMeters / 11.1),
          type: 1
        }
      ]
    });
  };

  useEffect(() => {
    if (computeLegRef.current) computeLegRef.current();
  }, [currentIndex, activeStop]);

  // Re-calculate route once initial GPS lock is acquired or when active stop changes
  useEffect(() => {
    if (driverLocation) {
      if (!hasGpsLockedRef.current) {
        hasGpsLockedRef.current = true;
        if (computeLegRef.current) computeLegRef.current();
      }
    }
  }, [driverLocation]);

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
        setIsActiveRoadSnapped(Boolean(routeResult.isRoadSnapped));
      }
    } catch (err) {
      console.warn('Reroute calculation failed:', err);
      setIsActiveRoadSnapped(false);
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
    enabled: isNavigating,
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
  const handleLaunchNavigation = async (targetIndex) => {
    if (targetIndex != null && targetIndex >= 0 && targetIndex < stops.length) {
      setCurrentIndex(targetIndex);
    }
    setIsNavigating(true);
    if (computeLegRef.current) {
      computeLegRef.current();
    }
    if (Capacitor.isNativePlatform()) {
      try {
        await routingService.startNavigationTracking();
      } catch (err) {
        console.warn('Native tracking error:', err);
      }
    }
  };

  const handleExitNavigation = async () => {
    setIsNavigating(false);
    if (Capacitor.isNativePlatform()) {
      try {
        await routingService.stopNavigationTracking();
        await routingService.stopSpeech();
      } catch (err) {
        console.warn('Stop tracking error:', err);
      }
    }
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
          <span>{t('routeProgress')}</span>
          <span>{t('stopsCountProgress', { delivered: deliveredCount, total: stops.length, percent: progressPercent })}</span>
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

      {/* Active Stop Hero Box (Phase C: Dark Graphite / Light Map Design System) */}
      {activeStop ? (() => {
        let legDistanceStr = null;
        let legEtaStr = null;
        const targetCoords = activeAddr.location?.coordinates || activeStop.coordinates;
        if (targetCoords && targetCoords.length >= 2) {
          const isApprox = !isActiveRoadSnapped;
          const approxPrefix = isApprox ? '~' : '';
          const approxSuffix = isApprox ? ' (approx)' : '';

          if (currentRouteResult?.summary?.length != null) {
            const miles = currentRouteResult.summary.length * 0.621371;
            legDistanceStr = `${approxPrefix}${miles.toFixed(1)} mi${approxSuffix}`;
            if (currentRouteResult.summary.time != null) {
              legEtaStr = `${approxPrefix}${Math.max(1, Math.round(currentRouteResult.summary.time / 60))} min${approxSuffix}`;
            }
          } else if (driverLocation && (Array.isArray(driverLocation) ? driverLocation.length >= 2 : (driverLocation.latitude != null && driverLocation.longitude != null))) {
            const dlLat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation.latitude;
            const dlLng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation.longitude;
            const distMeters = haversineDistance(dlLat, dlLng, targetCoords[1], targetCoords[0]);
            const miles = distMeters * 0.000621371;
            legDistanceStr = `~${miles.toFixed(1)} mi (approx)`;
            legEtaStr = `~${Math.max(1, Math.round(miles * 2.5))} min (approx)`;
          }
        }

        return (
          <NextStopCard
            stop={activeStop}
            stopIndex={currentIndex}
            totalStops={stops.length}
            isNavigating={isNavigating}
            distanceStr={legDistanceStr}
            etaStr={legEtaStr}
            brandName={brandName}
            onNavigate={handleLaunchNavigation}
            onMarkDelivered={handleMarkDelivered}
            onSkipStop={handleSkipStop}
            onEditGate={() => setShowGateModal(true)}
            onLaunchExternalMaps={handleLaunchExternalMaps}
            isFloating={false}
            t={t}
          />
        );
      })() : null}

      {/* Interactive Map view with Phase 4 Turn-by-Turn Guidance */}
      <MapView
        stops={stops}
        activeIndex={currentIndex}
        sequenceRouteCoordinates={sequenceRouteCoords}
        isSequenceRoadSnapped={isSequenceRoadSnapped}
        activeRouteCoordinates={activeRouteCoords}
        isActiveRoadSnapped={isActiveRoadSnapped}
        driverLocation={driverLocation}
        onSelectStop={(idx) => setCurrentIndex(idx)}
        onNavigateHere={(idx) => {
          setCurrentIndex(idx);
          handleLaunchNavigation(idx);
        }}
        onStartNavigation={handleLaunchNavigation}
        onNavigateInSequence={() => advanceToNextPending(stops)}
        onMarkDelivered={handleMarkDelivered}
        onSkipStop={handleSkipStop}
        guidance={guidance ? { ...guidance, isMuted, onToggleMute: () => setIsMuted(m => !m), language: getLanguage() } : null}
        isNavigating={isNavigating}
        onExitNavigation={handleExitNavigation}
      />

      {/* Stop Sequence Cards */}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' }}>{t('allStops')}</h3>
          <button
            className="btn btn-warning btn-sm"
            onClick={() => handleFinishRoute()}
            disabled={completingRoute}
          >
            {completingRoute ? t('finishing') : t('completeRouteNow')}
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
