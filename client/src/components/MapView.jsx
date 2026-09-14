import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { App } from '@capacitor/app';
import {
  Navigation,
  Crosshair,
  Maximize2,
  Minimize2,
  X,
  Key,
  Tag,
  Compass,
  ArrowRight,
  ShieldCheck,
  Plus,
  Minus,
  Sun,
  Moon,
  ChevronLeft
} from 'lucide-react';
import { registerPMTilesProtocol, resolvePmtilesUrl } from '../utils/pmtilesProtocol';
import { buildMapStyle } from '../utils/mapStyle';
import { routingService } from '../services/routing';
import NavigationGuidanceBanner from './NavigationGuidanceBanner';
import { useLanguage } from '../utils/i18n';

/**
 * Helper to extract valid [lng, lat] from any stop shape.
 */
function getStopCoords(stop) {
  if (!stop) return null;
  const raw = stop.address?.location?.coordinates || stop.coordinates || stop.location?.coordinates;
  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = parseFloat(raw[0]);
    const lat = parseFloat(raw[1]);
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return [lng, lat];
    }
  }
  return null;
}

/**
 * Builds GeoJSON FeatureCollection for all stops.
 * Rendered via GPU WebGL circle and symbol layers (zero-lag 120fps panning).
 */
function buildStopsGeoJSON(stopsList, activeIdx, selectedIdx) {
  const features = [];
  if (!Array.isArray(stopsList)) return { type: 'FeatureCollection', features };

  stopsList.forEach((stop, idx) => {
    const coords = getStopCoords(stop);
    if (!coords) return;
    const stopNumber = idx + 1;
    const isCurrentActive = idx === activeIdx;
    const isDelivered = stop.status === 'delivered';
    const isSelected = idx === selectedIdx;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords
      },
      properties: {
        stopIndex: idx,
        stopNumber: String(stopNumber),
        status: stop.status || 'pending',
        isActive: isCurrentActive,
        isSelected: isSelected
      }
    });
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Builds GeoJSON LineString connecting all manifest stops in sequence.
 */
function buildSequenceRouteGeoJSON(stopsList) {
  if (!Array.isArray(stopsList)) return { type: 'FeatureCollection', features: [] };
  const validCoords = stopsList.map(getStopCoords).filter(Boolean);
  if (validCoords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: validCoords
    },
    properties: {}
  };
}

/**
 * Builds GeoJSON LineString for active target route leg.
 */
function buildActiveRouteGeoJSON(stopsList, activeIdx, activeRouteCoords, driverLoc) {
  if (activeRouteCoords && activeRouteCoords.length > 1) {
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: activeRouteCoords
      },
      properties: {}
    };
  }

  if (!Array.isArray(stopsList) || !stopsList.length) {
    return { type: 'FeatureCollection', features: [] };
  }

  const targetStop = stopsList[activeIdx];
  const targetCoords = getStopCoords(targetStop);
  if (!targetCoords) {
    return { type: 'FeatureCollection', features: [] };
  }

  let originCoords = null;
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;

  if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
    originCoords = [dlLng, dlLat];
  } else if (activeIdx > 0) {
    originCoords = getStopCoords(stopsList[activeIdx - 1]);
  } else if (stopsList.length > 1) {
    originCoords = getStopCoords(stopsList[1]);
  }

  if (originCoords && (originCoords[0] !== targetCoords[0] || originCoords[1] !== targetCoords[1])) {
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [originCoords, targetCoords]
      },
      properties: {}
    };
  }

  return { type: 'FeatureCollection', features: [] };
}

/**
 * Builds GeoJSON Point for driver GPS location puck.
 */
function buildDriverLocationGeoJSON(driverLoc) {
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;

  if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [dlLng, dlLat]
          },
          properties: {}
        }
      ]
    };
  }

  return {
    type: 'FeatureCollection',
    features: []
  };
}

export default function MapView({
  stops = [],
  activeIndex = 0,
  activeRouteCoordinates = null,
  driverLocation = null,
  onSelectStop,
  onNavigateHere,
  onNavigateInSequence,
  regionId = null,
  guidance = null,
  isNavigating = false,
  onExitNavigation = null,
}) {
  const { t } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const activeRouteCoordsRef = useRef(activeRouteCoordinates);
  activeRouteCoordsRef.current = activeRouteCoordinates;
  const driverLocationRef = useRef(driverLocation);
  driverLocationRef.current = driverLocation;
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapTheme, setMapTheme] = useState('street');
  const [nativePmtilesPath, setNativePmtilesPath] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);

  // Auto-engage fullscreen when navigation begins
  useEffect(() => {
    if (isNavigating) {
      setIsFullscreen(true);
    }
  }, [isNavigating]);

  // 3D Perspective Bearing-Following Camera during Active Navigation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isNavigating || !driverLocation) return;

    const lng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation?.longitude;
    const lat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation?.latitude;
    const bearing = (!Array.isArray(driverLocation) && driverLocation?.bearing != null) ? driverLocation.bearing : 0;

    if (lng != null && lat != null && !isNaN(lng) && !isNaN(lat)) {
      map.easeTo({
        center: [lng, lat],
        bearing: bearing,
        pitch: 55,
        zoom: 17,
        duration: 800,
        essential: true,
      });
    }
  }, [driverLocation, isNavigating, mapLoaded]);

  const activeRegion = regionId || routingService.getActiveRegion() || 'sample-metro';

  // 1. Check local offline storage
  useEffect(() => {
    let isMounted = true;
    routingService.checkRegion(activeRegion).then((res) => {
      if (isMounted && res && res.pmtilesPath) {
        setNativePmtilesPath(res.pmtilesPath);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [activeRegion]);

  // 2. Hardware Android Back Button Listener in Fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    let listenerHandle = null;

    try {
      App.addListener('backButton', () => {
        setIsFullscreen(false);
      }).then((handle) => {
        listenerHandle = handle;
      }).catch(() => {});
    } catch {
      // Browser environment fallback
    }

    return () => {
      if (listenerHandle) {
        listenerHandle.remove();
      }
    };
  }, [isFullscreen]);

  // Add all WebGL vector sources and layers with immediate data
  const setupLayers = useCallback((map) => {
    if (!map) return;

    try {
      const curStops = stopsRef.current || [];
      const curActiveIdx = activeIndexRef.current || 0;
      const curRouteCoords = activeRouteCoordsRef.current;
      const curDriverLoc = driverLocationRef.current;

      // A. Sequence Route Line (Dashed Muted Electric Blue)
      if (!map.getSource('sequence-route-source')) {
        map.addSource('sequence-route-source', {
          type: 'geojson',
          data: buildSequenceRouteGeoJSON(curStops)
        });

        // Sequence Glow Casing
        map.addLayer({
          id: 'sequence-route-casing',
          type: 'line',
          source: 'sequence-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#0369a1',
            'line-width': 7,
            'line-opacity': 0.35
          }
        });

        // Sequence Core Line
        map.addLayer({
          id: 'sequence-route',
          type: 'line',
          source: 'sequence-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#38bdf8',
            'line-width': 3.5,
            'line-dasharray': [2, 1.5],
            'line-opacity': 0.85
          }
        });
      }

      // B. Active Target Route Leg (Solid Neon Green with glowing casing)
      if (!map.getSource('active-route-source')) {
        map.addSource('active-route-source', {
          type: 'geojson',
          data: buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc)
        });

        // Active Glow Casing
        map.addLayer({
          id: 'active-route-casing',
          type: 'line',
          source: 'active-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#15803d',
            'line-width': 10,
            'line-opacity': 0.45
          }
        });

        // Active Core Line
        map.addLayer({
          id: 'active-route',
          type: 'line',
          source: 'active-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#22c55e',
            'line-width': 5.5,
            'line-opacity': 1.0
          }
        });
      }

      // C. Driver GPS Location Source & WebGL Puck Layers
      if (!map.getSource('driver-location-source')) {
        map.addSource('driver-location-source', {
          type: 'geojson',
          data: buildDriverLocationGeoJSON(curDriverLoc)
        });

        // Driver Pulse Halo
        map.addLayer({
          id: 'driver-puck-halo',
          type: 'circle',
          source: 'driver-location-source',
          paint: {
            'circle-radius': 16,
            'circle-color': '#38bdf8',
            'circle-opacity': 0.35,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#38bdf8'
          }
        });

        // Driver Core Dot
        map.addLayer({
          id: 'driver-puck-core',
          type: 'circle',
          source: 'driver-location-source',
          paint: {
            'circle-radius': 7.5,
            'circle-color': '#0284c7',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff'
          }
        });
      }

      // D. Stop Markers WebGL Source & Native WebGL Circle/Symbol Layers
      if (!map.getSource('stops-source')) {
        map.addSource('stops-source', {
          type: 'geojson',
          data: buildStopsGeoJSON(curStops, curActiveIdx, null)
        });

        // Glowing radar pulse on GPU for active target stop
        map.addLayer({
          id: 'stops-active-halo',
          type: 'circle',
          source: 'stops-source',
          filter: ['==', ['get', 'isActive'], true],
          paint: {
            'circle-radius': 22,
            'circle-color': '#22c55e',
            'circle-opacity': 0.4,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#4ade80'
          }
        });

        // Crisp Circle Pin drawn purely on GPU in WebGL
        map.addLayer({
          id: 'stops-pin-outer',
          type: 'circle',
          source: 'stops-source',
          paint: {
            'circle-radius': [
              'case',
              ['==', ['get', 'isSelected'], true], 17,
              ['==', ['get', 'isActive'], true], 15,
              12.5
            ],
            'circle-color': [
              'case',
              ['==', ['get', 'isSelected'], true], '#38bdf8',
              ['==', ['get', 'isActive'], true], '#16a34a',
              ['==', ['get', 'status'], 'delivered'], '#334155',
              '#0284c7'
            ],
            'circle-stroke-width': [
              'case',
              ['==', ['get', 'isSelected'], true], 3,
              ['==', ['get', 'isActive'], true], 2.5,
              2
            ],
            'circle-stroke-color': '#ffffff'
          }
        });

        // Stop Number Label centered directly inside the circle pin
        map.addLayer({
          id: 'stops-number-label',
          type: 'symbol',
          source: 'stops-source',
          layout: {
            'text-field': ['to-string', ['get', 'stopNumber']],
            'text-size': [
              'case',
              ['==', ['get', 'isSelected'], true], 11.5,
              ['==', ['get', 'isActive'], true], 11,
              10
            ],
            'text-font': ['Open Sans Bold', 'Open Sans Regular'],
            'text-allow-overlap': true,
            'text-ignore-placement': true
          },
          paint: {
            'text-color': '#ffffff'
          }
        });

        // Immediate click interaction on GPU stop symbols
        const handleStopClick = (e) => {
          if (!e.features || !e.features.length) return;
          const props = e.features[0].properties;
          const idx = Number(props.stopIndex);
          const stop = stopsRef.current[idx];
          if (stop) {
            setSelectedStop(stop);
            setSelectedStopIndex(idx);
            const coords = e.features[0].geometry.coordinates;
            map.flyTo({ center: coords, zoom: 15.5, essential: true });
            if (onSelectStopRef.current) onSelectStopRef.current(idx);
          }
        };

        map.on('click', 'stops-pin-outer', handleStopClick);
        map.on('click', 'stops-number-label', handleStopClick);

        map.on('mouseenter', 'stops-pin-outer', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'stops-pin-outer', () => {
          map.getCanvas().style.cursor = '';
        });
      }

      mapRef.current = map;
      setMapLoaded(true);
    } catch (err) {
      console.warn('[MapView] Layer setup notice:', err);
    }
  }, []);

  // Initialize MapLibre GL instance
  useEffect(() => {
    if (!mapContainerRef.current) return;

    registerPMTilesProtocol();

    const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
    const styleObj = buildMapStyle({ pmtilesUrl, isOffline: offlineMode, theme: mapTheme });

    // Center map around first valid stop or Atlanta metro
    let initialCenter = [-84.388, 33.749];
    const firstCoords = (stopsRef.current || []).map(getStopCoords).find(Boolean);
    if (firstCoords) {
      initialCenter = firstCoords;
    }

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: styleObj,
      center: initialCenter,
      zoom: 12,
      attributionControl: false
    });

    map.on('load', () => {
      setupLayers(map);
    });

    map.on('styledata', () => {
      if (map.isStyleLoaded() && !map.getSource('stops-source')) {
        setupLayers(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [activeRegion, nativePmtilesPath, offlineMode, setupLayers]);

  // Handle Fullscreen resize
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        try {
          mapRef.current.resize();
        } catch {
          // Ignore
        }
      }, 100);
    }
  }, [isFullscreen]);

  // Update WebGL Stop Markers (Zero-Lag GPU Rendering)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    try {
      const stopsSource = map.getSource('stops-source');
      if (stopsSource) {
        stopsSource.setData(buildStopsGeoJSON(stops, activeIndex, selectedStopIndex));
      }
    } catch (err) {
      console.warn('[MapView] Failed to update stops data:', err);
    }
  }, [stops, activeIndex, selectedStopIndex, mapLoaded]);

  // Update WebGL Driver GPS Puck
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    try {
      const driverSource = map.getSource('driver-location-source');
      if (driverSource) {
        driverSource.setData(buildDriverLocationGeoJSON(driverLocation));
      }
    } catch (err) {
      console.warn('[MapView] Failed to update driver location:', err);
    }
  }, [driverLocation, mapLoaded]);

  // Update Polylines: Sequence Route (Blue) & Active Route (Green)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    try {
      const seqSource = map.getSource('sequence-route-source');
      if (seqSource) {
        seqSource.setData(buildSequenceRouteGeoJSON(stops));
      }

      const activeSource = map.getSource('active-route-source');
      if (activeSource) {
        activeSource.setData(buildActiveRouteGeoJSON(stops, activeIndex, activeRouteCoordinates, driverLocation));
      }
    } catch (err) {
      console.warn('[MapView] Failed to update route polylines:', err);
    }
  }, [stops, activeIndex, activeRouteCoordinates, driverLocation, mapLoaded]);

  // 7. Camera Auto-framing
  const fitMapToBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const validCoords = stops.map(getStopCoords).filter(Boolean);
    if (!validCoords.length) return;

    const bounds = new LngLatBounds();
    validCoords.forEach((c) => bounds.extend(c));
    if (driverLocation) bounds.extend(driverLocation);

    map.fitBounds(bounds, {
      padding: { top: 70, bottom: 90, left: 50, right: 50 },
      maxZoom: 16,
      duration: 800
    });
  }, [stops, driverLocation]);

  // Initial fit
  useEffect(() => {
    if (mapLoaded && stops.length > 0) {
      fitMapToBounds();
    }
  }, [mapLoaded, stops.length]);

  const handleCenterActiveStop = () => {
    const map = mapRef.current;
    const target = stops[activeIndex];
    const coords = getStopCoords(target);
    if (map && coords) {
      map.flyTo({ center: coords, zoom: 15.5, essential: true });
      setSelectedStop(target);
      setSelectedStopIndex(activeIndex);
    }
  };

  const handleZoomIn = () => {
    if (mapRef.current) mapRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapRef.current) mapRef.current.zoomOut();
  };

  const handleToggleTheme = () => {
    const nextTheme = mapTheme === 'street' ? 'dark' : 'street';
    setMapTheme(nextTheme);
    const map = mapRef.current;
    if (map) {
      const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
      const newStyle = buildMapStyle({ pmtilesUrl, isOffline: offlineMode, theme: nextTheme });
      map.setStyle(newStyle);
    }
  };

  return (
    <div
      className={`card ${isFullscreen ? 'maplibre-fullscreen-parent' : ''}`}
      style={{
        padding: isFullscreen ? 0 : '0.75rem',
        position: 'relative',
        marginBottom: '1rem',
        zIndex: isFullscreen ? 9999 : undefined
      }}
    >
      {/* Header bar (hidden in full screen) */}
      {!isFullscreen && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.85rem' }}>
            <Navigation size={15} color="#38bdf8" />
            <span>{t('interactiveRouteMap', { count: stops.length })}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setIsFullscreen(true)}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Maximize2 size={13} />
              <span>{t('fullView')}</span>
            </button>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {t('target')}: #{activeIndex + 1}
            </span>
          </div>
        </div>
      )}

      {/* MapLibre Canvas Container */}
      <div className={`maplibre-wrapper ${isFullscreen ? 'maplibre-fullscreen' : ''}`}>
        <div ref={mapContainerRef} className="maplibre-canvas-container" />

        {/* Top Status Bar Notch Scrim (ensures white battery/clock text is always crisp over map) */}
        {isFullscreen && <div className="map-notch-scrim" />}

        {/* Turn-by-Turn Guidance Banner */}
        {isNavigating && guidance && (
          <NavigationGuidanceBanner
            currentInstruction={guidance.currentInstruction}
            nextInstruction={guidance.nextInstruction}
            distanceToManeuver={guidance.distanceToManeuver}
            isRecalculating={guidance.isRecalculating}
            isMuted={guidance.isMuted}
            onToggleMute={guidance.onToggleMute}
            language={guidance.language}
          />
        )}

        {/* Fullscreen Back Bar (Safe Area Top) */}
        {isFullscreen && (
          <div className="map-fullscreen-header-bar">
            <button
              onClick={() => {
                if (isNavigating && onExitNavigation) {
                  onExitNavigation();
                } else {
                  setIsFullscreen(false);
                }
              }}
              className="map-back-btn"
              title={isNavigating ? t('exitNav') : t('back')}
            >
              <ChevronLeft size={18} />
              <span>{isNavigating ? t('exitNav') : t('back')}</span>
            </button>
            <div className="map-legend-pill">
              <ShieldCheck size={13} />
              <span>{mapTheme === 'street' ? t('vectorStreet') : t('nightMode')}</span>
            </div>
          </div>
        )}

        {/* Legend pill for normal embedded view */}
        {!isFullscreen && (
          <div className="map-legend-pill">
            <ShieldCheck size={13} />
            <span>{mapTheme === 'street' ? t('vectorStreet') : t('nightMode')}</span>
          </div>
        )}

        {/* Unified Custom Map Controls (Notch Safe) */}
        <div className="maplibre-controls-overlay">
          <button
            className="map-control-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? t('exitFullView') : t('fullView')}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            className="map-control-btn"
            onClick={handleToggleTheme}
            title={mapTheme === 'street' ? t('nightMode') : t('vectorStreet')}
          >
            {mapTheme === 'street' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button
            className="map-control-btn"
            onClick={fitMapToBounds}
            title="Fit All Stops in View"
          >
            <Compass size={16} />
          </button>
          <button
            className="map-control-btn"
            onClick={handleCenterActiveStop}
            title="Recenter to Active Stop"
          >
            <Crosshair size={16} />
          </button>
          <button
            className="map-control-btn"
            onClick={handleZoomIn}
            title="Zoom In"
          >
            <Plus size={16} />
          </button>
          <button
            className="map-control-btn"
            onClick={handleZoomOut}
            title="Zoom Out"
          >
            <Minus size={16} />
          </button>
        </div>

        {/* Floating Bottom Sheet for Selected Stop */}
        {selectedStop && (
          <div className="map-bottom-sheet">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <div>
                <span className="badge badge-blue" style={{ fontSize: '0.7rem' }}>
                  {t('stopOf', { current: selectedStopIndex + 1, total: stops.length })}
                </span>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', marginTop: '0.2rem' }}>
                  {selectedStop.address?.street || selectedStop.address?.raw || t('stopDetails')}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  {[selectedStop.address?.city, selectedStop.address?.state, selectedStop.address?.postalCode].filter(Boolean).join(', ')}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedStop(null);
                  setSelectedStopIndex(null);
                }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Extra stop meta */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.65rem' }}>
              {selectedStop.trackingNumber && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Tag size={12} />
                  <span>{t('package')}: {selectedStop.trackingNumber}</span>
                </div>
              )}
              {selectedStop.address?.gateCode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#38bdf8' }}>
                  <Key size={12} />
                  <span>{t('gate')}: #{selectedStop.address.gateCode}</span>
                </div>
              )}
            </div>

            {/* Bottom Sheet Actions */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {selectedStopIndex !== activeIndex && (
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                  onClick={() => {
                    if (onNavigateHere) onNavigateHere(selectedStopIndex);
                    setSelectedStop(null);
                  }}
                >
                  <Navigation size={14} />
                  <span>{t('navigateHere')}</span>
                </button>
              )}

              {onNavigateInSequence && selectedStopIndex === activeIndex && activeIndex < stops.length - 1 && (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                  onClick={() => {
                    onNavigateInSequence();
                    setSelectedStop(null);
                  }}
                >
                  <ArrowRight size={14} />
                  <span>{t('nextInSequence')}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
