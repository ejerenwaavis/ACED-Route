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
 * Handles [lng, lat], [lat, lng], and object forms ({ lat, lng } / { latitude, longitude }).
 */
function getStopCoords(stop) {
  if (!stop) return null;

  // 1. Array coordinates: [lng, lat]
  const raw = stop.address?.location?.coordinates || stop.coordinates || stop.location?.coordinates;
  if (Array.isArray(raw) && raw.length >= 2) {
    let lng = parseFloat(raw[0]);
    let lat = parseFloat(raw[1]);
    // Safety check if coordinates were stored as [lat, lng] instead of [lng, lat]
    if (lat < 0 && lng > 0) {
      const tmp = lng;
      lng = lat;
      lat = tmp;
    }
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return [lng, lat];
    }
  }

  // 2. Object latitude/longitude fields
  const obj = stop.address || stop;
  const latVal = obj.latitude ?? obj.lat;
  const lngVal = obj.longitude ?? obj.lng ?? obj.lon;
  if (latVal != null && lngVal != null) {
    let lat = parseFloat(latVal);
    let lng = parseFloat(lngVal);
    if (lat < 0 && lng > 0) {
      const tmp = lng;
      lng = lat;
      lat = tmp;
    }
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return [lng, lat];
    }
  }

  return null;
}

/**
 * Builds standard GeoJSON FeatureCollection for all stops.
 * Rendered via GPU WebGL circle and symbol layers (zero-lag 120fps panning).
 */
function buildStopsGeoJSON(stopsList, activeIdx, selectedIdx) {
  const features = [];
  if (Array.isArray(stopsList)) {
    stopsList.forEach((stop, idx) => {
      const coords = getStopCoords(stop);
      if (!coords) return;
      const stopNumber = idx + 1;
      const isCurrentActive = idx === activeIdx;
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
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Builds standard GeoJSON FeatureCollection LineString connecting all manifest stops in sequence.
 */
function buildSequenceRouteGeoJSON(stopsList) {
  const validCoords = (stopsList || []).map(getStopCoords).filter(Boolean);
  if (validCoords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: validCoords
        },
        properties: {}
      }
    ]
  };
}

/**
 * Builds standard GeoJSON FeatureCollection LineString for active target route leg.
 */
function buildActiveRouteGeoJSON(stopsList, activeIdx, activeRouteCoords, driverLoc) {
  let coords = null;
  if (activeRouteCoords && activeRouteCoords.length > 1) {
    coords = activeRouteCoords;
  } else if (Array.isArray(stopsList) && stopsList.length > 0) {
    const targetStop = stopsList[activeIdx];
    const targetCoords = getStopCoords(targetStop);
    if (targetCoords) {
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
        coords = [originCoords, targetCoords];
      }
    }
  }

  if (coords && coords.length >= 2) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords
          },
          properties: {}
        }
      ]
    };
  }

  return { type: 'FeatureCollection', features: [] };
}

/**
 * Builds standard GeoJSON FeatureCollection Point for driver GPS location puck.
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

/**
 * Safely adds GeoJSON source to MapLibre instance without throwing duplicate ID errors.
 */
function safeAddSource(map, id, sourceDef) {
  try {
    if (!map.getSource(id)) {
      map.addSource(id, sourceDef);
    }
  } catch (e) {
    console.warn(`[MapView] safeAddSource notice (${id}):`, e);
  }
}

/**
 * Safely adds layer to MapLibre instance without throwing duplicate ID errors.
 */
function safeAddLayer(map, layerDef, beforeId) {
  try {
    if (!map.getLayer(layerDef.id)) {
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(layerDef, beforeId);
      } else {
        map.addLayer(layerDef);
      }
    }
  } catch (e) {
    console.warn(`[MapView] safeAddLayer notice (${layerDef.id}):`, e);
  }
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

  const isSettingUpRef = useRef(false);

  // Add all WebGL vector sources and layers with immediate data.
  // NOTE: We do NOT guard on map.isStyleLoaded() here — with raster-only ESRI
  // basemaps, MapLibre GL fires the 'load' event before isStyleLoaded() returns
  // true, which would silently block all layer setup forever. Instead we attempt
  // setup directly and rely on safeAddSource/safeAddLayer to handle any errors.
  const setupLayers = useCallback((map) => {
    if (!map || isSettingUpRef.current) return;

    isSettingUpRef.current = true;
    try {
      const curStops = stopsRef.current || [];
      const curActiveIdx = activeIndexRef.current || 0;
      const curRouteCoords = activeRouteCoordsRef.current;
      const curDriverLoc = driverLocationRef.current;

      // A. Sequence Route Line (Dashed Muted Electric Blue)
      safeAddSource(map, 'sequence-route-source', {
        type: 'geojson',
        data: buildSequenceRouteGeoJSON(curStops)
      });

      // Sequence Glow Casing
      safeAddLayer(map, {
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
      safeAddLayer(map, {
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

      // B. Active Target Route Leg (Solid Neon Green with glowing casing)
      safeAddSource(map, 'active-route-source', {
        type: 'geojson',
        data: buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc)
      });

      // Active Glow Casing
      safeAddLayer(map, {
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
      safeAddLayer(map, {
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

      // C. Driver GPS Location Source & WebGL Puck Layers
      safeAddSource(map, 'driver-location-source', {
        type: 'geojson',
        data: buildDriverLocationGeoJSON(curDriverLoc)
      });

      // Driver Pulse Halo
      safeAddLayer(map, {
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
      safeAddLayer(map, {
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

      // D. Stop Markers WebGL Source & Native WebGL Circle/Symbol Layers
      safeAddSource(map, 'stops-source', {
        type: 'geojson',
        data: buildStopsGeoJSON(curStops, curActiveIdx, null)
      });

      // Glowing radar pulse on GPU for active target stop
      safeAddLayer(map, {
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
      safeAddLayer(map, {
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
      safeAddLayer(map, {
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
          'text-font': ['Open Sans Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      // Immediate click interaction on GPU stop symbols
      if (!map._hasStopClickListeners) {
        map._hasStopClickListeners = true;
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
    } finally {
      isSettingUpRef.current = false;
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

    // Assign ref immediately so update effects can push data during setup
    mapRef.current = map;

    // Primary: attempt layer setup on map load event
    map.on('load', () => {
      setupLayers(map);
    });

    // Fallback: retry via styledata if sources were not added yet
    // (fires multiple times during style transitions; the mutex prevents double-setup)
    map.on('styledata', () => {
      if (!map.getSource('stops-source')) {
        setupLayers(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [activeRegion, nativePmtilesPath, offlineMode, setupLayers, mapTheme]);


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
    if (!map) return;

    try {
      const stopsSource = map.getSource('stops-source');
      if (stopsSource) {
        stopsSource.setData(buildStopsGeoJSON(stops, activeIndex, selectedStopIndex));
      } else if (map.isStyleLoaded()) {
        setupLayers(map);
      }
    } catch (err) {
      console.warn('[MapView] Failed to update stops data:', err);
    }
  }, [stops, activeIndex, selectedStopIndex, setupLayers]);

  // Update WebGL Driver GPS Puck
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      const driverSource = map.getSource('driver-location-source');
      if (driverSource) {
        driverSource.setData(buildDriverLocationGeoJSON(driverLocation));
      } else if (map.isStyleLoaded()) {
        setupLayers(map);
      }
    } catch (err) {
      console.warn('[MapView] Failed to update driver location:', err);
    }
  }, [driverLocation, setupLayers]);

  // Update Polylines: Sequence Route (Blue) & Active Route (Green)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      const seqSource = map.getSource('sequence-route-source');
      if (seqSource) {
        seqSource.setData(buildSequenceRouteGeoJSON(stops));
      } else if (map.isStyleLoaded()) {
        setupLayers(map);
      }

      const activeSource = map.getSource('active-route-source');
      if (activeSource) {
        activeSource.setData(buildActiveRouteGeoJSON(stops, activeIndex, activeRouteCoordinates, driverLocation));
      }
    } catch (err) {
      console.warn('[MapView] Failed to update route polylines:', err);
    }
  }, [stops, activeIndex, activeRouteCoordinates, driverLocation, setupLayers]);

  // 7. Camera Auto-framing
  const fitMapToBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const validCoords = (stops || []).map(getStopCoords).filter(Boolean);
    if (!validCoords.length) return;

    const bounds = new LngLatBounds();
    validCoords.forEach((c) => bounds.extend(c));
    if (driverLocation) {
      const dlLng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation?.longitude;
      const dlLat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation?.latitude;
      if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
        bounds.extend([dlLng, dlLat]);
      }
    }

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
  }, [mapLoaded, stops.length, fitMapToBounds]);

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
      // Reset guards so setupLayers re-runs after the style swap
      isSettingUpRef.current = false;
      map._hasStopClickListeners = false;
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
