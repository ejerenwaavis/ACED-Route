import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, Marker, LngLatBounds } from 'maplibre-gl';
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
  ChevronLeft,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { registerPMTilesProtocol, resolvePmtilesUrl } from '../utils/pmtilesProtocol';
import { buildMapStyle } from '../utils/mapStyle';
import { routingService } from '../services/routing';
import NavigationGuidanceBanner from './NavigationGuidanceBanner';
import TurnInstructionCard from './navigation/TurnInstructionCard';
import CurrentStopChip from './navigation/CurrentStopChip';
import MapFloatingControls from './navigation/MapFloatingControls';
import NextStopCard from './navigation/NextStopCard';
import { useLanguage } from '../utils/i18n';
import { haversineDistance } from '../utils/geoUtils';
import { getCachedCoordinates } from '../utils/geocodeCache';

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

  // 3. Fallback to geocode cache by address
  const addrStr = typeof stop === 'string'
    ? stop
    : (typeof stop.address === 'string'
        ? stop.address
        : (stop.address?.street || stop.address?.raw || stop.address?.normalizedAddress || stop.street || stop.raw || ''));
  if (addrStr) {
    const cached = getCachedCoordinates(addrStr);
    if (cached && Array.isArray(cached) && cached.length >= 2) {
      return [cached[0], cached[1]];
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

      const isDelivered = stop.status === 'delivered' || Boolean(stop.completedAt);
      const isSkipped = stop.status === 'skipped' || stop.status === 'attempted';
      let statusVal = stop.status || 'pending';
      if (isSkipped) statusVal = 'skipped';
      else if (isDelivered) statusVal = 'delivered';

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: coords
        },
        properties: {
          stopIndex: idx,
          stopNumber: String(stopNumber),
          status: statusVal,
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
 * Guarantees connection to vehicle location and multi-point geodesic density.
 */
function buildActiveRouteGeoJSON(stopsList, activeIdx, activeRouteCoords, driverLoc) {
  let coords = null;
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;
  const hasDriverLoc = dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat);

  if (activeRouteCoords && activeRouteCoords.length > 1) {
    coords = activeRouteCoords.map(pt => [...pt]);
    // Snap route head directly to vehicle location so line is never disconnected
    if (hasDriverLoc && coords.length > 0) {
      coords[0] = [dlLng, dlLat];
    }
  } else if (Array.isArray(stopsList) && stopsList.length > 0) {
    const targetStop = stopsList[activeIdx];
    const targetCoords = getStopCoords(targetStop);
    if (targetCoords) {
      let originCoords = null;
      if (hasDriverLoc) {
        originCoords = [dlLng, dlLat];
      } else if (activeIdx > 0) {
        originCoords = getStopCoords(stopsList[activeIdx - 1]);
      } else if (stopsList.length > 1) {
        originCoords = getStopCoords(stopsList[1]);
      }

      if (originCoords && (originCoords[0] !== targetCoords[0] || originCoords[1] !== targetCoords[1])) {
        // High-density geodesic interpolation (15 vertices) ensuring lines are visible at every zoom level
        const steps = 15;
        const interpolated = [];
        for (let i = 0; i <= steps; i++) {
          const frac = i / steps;
          const lat = originCoords[1] + (targetCoords[1] - originCoords[1]) * frac;
          const lng = originCoords[0] + (targetCoords[0] - originCoords[0]) * frac;
          interpolated.push([lng, lat]);
        }
        coords = interpolated;
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
 * Safely adds GeoJSON source to MapLibre instance.
 * Returns true if the source was already present OR was added successfully.
 * Returns false if addSource threw — so callers can decide whether to retry.
 */
function safeAddSource(map, id, sourceDef) {
  try {
    if (map.getSource(id)) return true; // Already exists
    map.addSource(id, sourceDef);
    return true;
  } catch (e) {
    console.error(`[MapView] safeAddSource FAILED (${id}):`, e.message);
    return false;
  }
}

export const OVERLAY_LAYER_IDS = [
  'sequence-route-casing',
  'sequence-route',
  'active-route-casing',
  'active-route',
  'driver-puck-halo',
  'driver-puck-core',
  'stops-active-halo',
  'stops-pin-outer',
  'stops-number-label'
];

/**
 * Safely adds an overlay layer to MapLibre instance with NO beforeId,
 * and immediately moves it to the top of the stack above raster tiles.
 */
function addOverlayLayer(map, layerDef) {
  try {
    if (!map.getLayer(layerDef.id)) {
      map.addLayer(layerDef);
    }
    // With no second argument, moveLayer pushes layer to the end of layers array = top of rendering stack
    map.moveLayer(layerDef.id);
    return true;
  } catch (e) {
    console.error(`[MapView] addOverlayLayer FAILED (${layerDef.id}):`, e.message);
    return false;
  }
}

/**
 * Ensures all registered overlay layers are strictly above any raster basemaps.
 * Can be called during style reloads, theme switches, or styledata events.
 */
function ensureOverlaysOnTop(map) {
  if (!map) return;
  OVERLAY_LAYER_IDS.forEach((id) => {
    try {
      if (map.getLayer(id)) {
        map.moveLayer(id);
      }
    } catch (_) {}
  });
}

// Backward compatibility alias for any existing callers
const safeAddLayer = addOverlayLayer;



export default function MapView({
  stops = [],
  activeIndex = 0,
  activeRouteCoordinates = null,
  driverLocation = null,
  onSelectStop,
  onNavigateHere,
  onStartNavigation,
  onNavigateInSequence,
  regionId = null,
  guidance = null,
  isNavigating = false,
  onExitNavigation = null,
  onMarkDelivered = null,
  onSkipStop = null,
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
  const markersRef = useRef([]);
  const driverMarkerRef = useRef(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapTheme, setMapTheme] = useState('street');
  const [nativePmtilesPath, setNativePmtilesPath] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);
  // Debug HUD — shows live layer-setup status on device screen
  const [debugInfo, setDebugInfo] = useState('waiting…');

  // User free-panning / interaction guard so camera does not snap back
  const [userIsPanning, setUserIsPanning] = useState(false);
  const userIsPanningRef = useRef(false);
  const hasInitialFitRef = useRef(false);
  const hasGpsFittedRef = useRef(false);
  const [showExpandedStopCard, setShowExpandedStopCard] = useState(false);
  const [chipDismissed, setChipDismissed] = useState(false);

  // Auto-engage fullscreen & follow vehicle when navigation begins
  const lastCameraBearingRef = useRef(0);

  useEffect(() => {
    if (isNavigating) {
      setIsFullscreen(true);
      setUserIsPanning(false);
      userIsPanningRef.current = false;
      const map = mapRef.current;
      const curDriverLoc = driverLocationRef.current;
      if (map && curDriverLoc) {
        const dlLng = Array.isArray(curDriverLoc) ? curDriverLoc[0] : curDriverLoc?.longitude;
        const dlLat = Array.isArray(curDriverLoc) ? curDriverLoc[1] : curDriverLoc?.latitude;
        if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
          map.flyTo({
            center: [dlLng, dlLat],
            zoom: 17,
            pitch: 50,
            bearing: lastCameraBearingRef.current || 0,
            duration: 800,
            essential: true
          });
        }
      }
    }
  }, [isNavigating]);

  // 3D Perspective Bearing-Following Camera during Active Navigation
  // Follows smoothly without jitter when driver is moving
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isNavigating || !driverLocation || userIsPanning) return;

    const lng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation?.longitude;
    const lat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation?.latitude;
    const speed = (!Array.isArray(driverLocation) && driverLocation?.speed != null) ? driverLocation.speed : 0;
    const rawBearing = (!Array.isArray(driverLocation) && driverLocation?.bearing != null) ? driverLocation.bearing : null;

    // Only update map camera orientation when speed is above 0.8 m/s (~1.8 mph)
    // When stopped or moving very slowly, freeze camera bearing to eliminate spinning
    if (rawBearing != null && !isNaN(rawBearing) && speed >= 0.8) {
      lastCameraBearingRef.current = rawBearing;
    }

    if (lng != null && lat != null && !isNaN(lng) && !isNaN(lat)) {
      map.easeTo({
        center: [lng, lat],
        bearing: lastCameraBearingRef.current,
        pitch: 50,
        zoom: 17,
        duration: 700,
        essential: true,
      });
    }
  }, [driverLocation, isNavigating, mapLoaded, userIsPanning]);

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
  // Keep a stable reference to setDebugInfo for use inside useCallback
  const setDebugInfoRef = useRef(null);

  // Add all WebGL vector sources and layers with immediate data.
  // Returns true if all critical layers were successfully added, false otherwise.
  // IMPORTANT: setMapLoaded(true) is only called on success — never on partial failure.
  const setupLayers = useCallback((map) => {
    if (!map || isSettingUpRef.current) return false;
    isSettingUpRef.current = true;

    const dbg = setDebugInfoRef.current;

    try {
      const curStops = stopsRef.current || [];
      const curActiveIdx = activeIndexRef.current || 0;
      const curRouteCoords = activeRouteCoordsRef.current;
      const curDriverLoc = driverLocationRef.current;

      const validCoordCount = curStops.map(getStopCoords).filter(Boolean).length;
      if (dbg) dbg(`setup… stops:${curStops.length} valid:${validCoordCount}`);

      // A. Sequence Route Line (connects manifest stops in sequence)
      const seqSrcOk = safeAddSource(map, 'sequence-route-source', {
        type: 'geojson',
        data: buildSequenceRouteGeoJSON(curStops)
      });
      if (!seqSrcOk) {
        if (dbg) dbg(`ERR: seq-route-source failed — map not ready`);
        return false;
      }
      safeAddLayer(map, {
        id: 'sequence-route-casing', type: 'line', source: 'sequence-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0f172a', 'line-width': 8, 'line-opacity': 0.7 }
      });
      safeAddLayer(map, {
        id: 'sequence-route', type: 'line', source: 'sequence-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2676D9', 'line-width': 4.5, 'line-opacity': 0.95 }
      });

      // B. Active Target Route Leg (from vehicle to current stop)
      safeAddSource(map, 'active-route-source', {
        type: 'geojson',
        data: buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc)
      });
      safeAddLayer(map, {
        id: 'active-route-casing', type: 'line', source: 'active-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#064e3b', 'line-width': 11, 'line-opacity': 0.8 }
      });
      safeAddLayer(map, {
        id: 'active-route', type: 'line', source: 'active-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 6.5, 'line-opacity': 1.0 }
      });

      // C. Driver GPS Location Puck
      safeAddSource(map, 'driver-location-source', {
        type: 'geojson',
        data: buildDriverLocationGeoJSON(curDriverLoc)
      });
      safeAddLayer(map, {
        id: 'driver-puck-halo', type: 'circle', source: 'driver-location-source',
        paint: { 'circle-radius': 18, 'circle-color': '#2676D9', 'circle-opacity': 0.25,
                 'circle-stroke-width': 1.5, 'circle-stroke-color': '#2676D9' }
      });
      safeAddLayer(map, {
        id: 'driver-puck-core', type: 'circle', source: 'driver-location-source',
        paint: { 'circle-radius': 8, 'circle-color': '#2676D9',
                 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' }
      });

      // D. Stop Markers — this is the CRITICAL source. Check it explicitly.
      const stopsSrcOk = safeAddSource(map, 'stops-source', {
        type: 'geojson',
        data: buildStopsGeoJSON(curStops, curActiveIdx, null)
      });
      if (!stopsSrcOk) {
        if (dbg) dbg(`ERR: stops-source failed — map not ready`);
        return false;
      }

      safeAddLayer(map, {
        id: 'stops-active-halo', type: 'circle', source: 'stops-source',
        filter: ['==', ['get', 'isActive'], true],
        paint: { 'circle-radius': 22, 'circle-color': '#F28C28', 'circle-opacity': 0.35,
                 'circle-stroke-width': 2, 'circle-stroke-color': '#F28C28' }
      });
      const pinOk = safeAddLayer(map, {
        id: 'stops-pin-outer', type: 'circle', source: 'stops-source',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'isSelected'], true], 17,
                                   ['==', ['get', 'isActive'], true], 16,
                                   ['==', ['get', 'status'], 'delivered'], 12, 13],
          'circle-color': ['case', ['==', ['get', 'isSelected'], true], '#F28C28',
                                   ['==', ['get', 'isActive'], true], '#F28C28',
                                   ['==', ['get', 'status'], 'skipped'], '#E5484D',
                                   ['==', ['get', 'status'], 'delivered'], '#8A8F96', '#2676D9'],
          'circle-stroke-width': ['case', ['==', ['get', 'isSelected'], true], 3,
                                          ['==', ['get', 'isActive'], true], 2.5, 2],
          'circle-stroke-color': '#ffffff'
        }
      });
      safeAddLayer(map, {
        id: 'stops-number-label', type: 'symbol', source: 'stops-source',
        layout: {
          'text-field': ['to-string', ['get', 'stopNumber']],
          'text-size': ['case', ['==', ['get', 'isSelected'], true], 11.5,
                                ['==', ['get', 'isActive'], true], 11, 10],
          'text-font': ['Open Sans Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: { 'text-color': '#ffffff' }
      });

      // Click handlers
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
        map.on('mouseenter', 'stops-pin-outer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'stops-pin-outer', () => { map.getCanvas().style.cursor = ''; });
      }

      // Explicitly move all custom overlay layers to the TOP of the layer stack so raster tiles cannot cover them
      ensureOverlaysOnTop(map);

      const seqGeoJSON = buildSequenceRouteGeoJSON(curStops);
      const activeGeoJSON = buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc);
      const seqCoordsCount = seqGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
      const actCoordsCount = activeGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;

      // Verify the critical layer truly exists before declaring success
      const confirmed = !!map.getLayer('stops-pin-outer') && !!map.getSource('stops-source');
      if (confirmed) {
        if (dbg) dbg(`pins:true dom:${markersRef.current?.length || 0} stops:${curStops.length} lines:{sequence:${seqCoordsCount}, active:${actCoordsCount}}`);
        mapRef.current = map;
        setMapLoaded(true);
        return true;
      } else {
        if (dbg) dbg(`VERIFY FAIL: layer missing after add`);
        return false;
      }
    } catch (err) {
      console.error('[MapView] setupLayers threw:', err.message);
      if (dbg) dbg(`THROW: ${err.message}`);
      return false;
    } finally {
      isSettingUpRef.current = false;
    }
  }, []);




  // Initialize MapLibre GL instance
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Wire up the debug HUD callback so setupLayers (useCallback []) can write to state
    setDebugInfoRef.current = setDebugInfo;

    registerPMTilesProtocol();

    const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
    const styleObj = buildMapStyle({ pmtilesUrl, isOffline: offlineMode, theme: mapTheme });

    // Center map around first valid stop or Atlanta metro
    let initialCenter = [-84.388, 33.749];
    const firstCoords = (stopsRef.current || []).map(getStopCoords).find(Boolean);
    if (firstCoords) {
      initialCenter = firstCoords;
      setDebugInfo(`center:${firstCoords[0].toFixed(3)},${firstCoords[1].toFixed(3)}`);
    } else {
      setDebugInfo(`center:ATL stops:${(stopsRef.current || []).length}`);
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

    map.on('error', (e) => {
      console.warn('[MapLibre error event]:', e?.error?.message || e);
    });

    // Detect user manual interaction so we do NOT forcibly snap the camera back
    const handleUserMapInteraction = () => {
      setUserIsPanning(true);
      userIsPanningRef.current = true;
    };
    map.on('dragstart', handleUserMapInteraction);
    map.on('rotatestart', handleUserMapInteraction);
    map.on('pitchstart', handleUserMapInteraction);

    // Keep overlay layers strictly on top whenever raster basemaps refresh or style updates
    map.on('styledata', () => {
      ensureOverlaysOnTop(map);
    });

    // PRIMARY: load event — fires when style is applied and map canvas is ready.
    // This is the standard reliable hook for addSource/addLayer.
    map.on('load', () => {
      setDebugInfo('load fired → setupLayers…');
      const ok = setupLayers(map);
      if (!ok) {
        // PRIMARY failed — schedule idle fallback
        setDebugInfo('load: setup failed → waiting idle…');
      }
    });

    // DEFINITIVE FALLBACK: idle fires after all tiles are loaded and the map is fully
    // settled. addSource/addLayer is GUARANTEED to work here. Only runs if load failed.
    map.once('idle', () => {
      if (!map.getSource('stops-source')) {
        setDebugInfo('idle fallback → setupLayers…');
        setupLayers(map);
      }
    });

    return () => {
      setDebugInfoRef.current = null;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      setDebugInfo('waiting…');
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
        const geojson = buildStopsGeoJSON(stops, activeIndex, selectedStopIndex);
        stopsSource.setData(geojson);
        if (setDebugInfoRef.current) {
          setDebugInfoRef.current(`DATA: stops=${stops?.length || 0} pts=${geojson.features.length}`);
        }
      } else {
        // Source not ready yet — attempt layer setup
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
      } else {
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
      const seqGeoJSON = buildSequenceRouteGeoJSON(stops);
      const seqSource = map.getSource('sequence-route-source');
      if (seqSource) {
        seqSource.setData(seqGeoJSON);
      } else {
        setupLayers(map);
      }

      const activeGeoJSON = buildActiveRouteGeoJSON(stops, activeIndex, activeRouteCoordinates, driverLocation);
      const activeSource = map.getSource('active-route-source');
      if (activeSource) {
        activeSource.setData(activeGeoJSON);
      }

      ensureOverlaysOnTop(map);

      const seqCoordsCount = seqGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
      const actCoordsCount = activeGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;

      if (setDebugInfoRef.current) {
        setDebugInfoRef.current(`pins:true dom:${markersRef.current?.length || 0} stops:${stops?.length || 0} lines:{sequence:${seqCoordsCount}, active:${actCoordsCount}}`);
      }
    } catch (err) {
      console.warn('[MapView] Failed to update route polylines:', err);
    }
  }, [stops, activeIndex, activeRouteCoordinates, driverLocation, setupLayers]);

  // Update HTML Stop Markers (Physically rendered in DOM layer ABOVE WebGL canvas)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const curStops = stops || [];
    curStops.forEach((stop, idx) => {
      const coords = getStopCoords(stop);
      if (!coords) return;

      const isCurrentActive = idx === activeIndex;
      const isSelected = idx === selectedStopIndex;
      const isDelivered = stop.status === 'delivered' || Boolean(stop.completedAt);
      const isSkipped = stop.status === 'skipped' || stop.status === 'attempted';

      const el = document.createElement('div');
      let stateClass = 'stop-marker-standard';
      if (isCurrentActive) {
        stateClass = 'stop-marker-next';
      } else if (isSkipped) {
        stateClass = 'stop-marker-skipped';
      } else if (isDelivered) {
        stateClass = 'stop-marker-completed';
      }

      el.className = `stop-marker-pin ${stateClass} ${isSelected ? 'stop-marker-selected' : ''}`;

      if (isSkipped) {
        el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      } else {
        el.innerText = `${idx + 1}`;
      }

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedStop(stop);
        setSelectedStopIndex(idx);
        map.flyTo({ center: coords, zoom: 15.5, essential: true });
        if (onSelectStopRef.current) onSelectStopRef.current(idx);
      });

      const marker = new Marker({ element: el })
        .setLngLat(coords)
        .addTo(map);

      markersRef.current.push(marker);
    });

    const seqGeoJSON = buildSequenceRouteGeoJSON(curStops);
    const activeGeoJSON = buildActiveRouteGeoJSON(curStops, activeIndex, activeRouteCoordinates, driverLocation);
    const seqCoordsCount = seqGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
    const actCoordsCount = activeGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;

    if (setDebugInfoRef.current) {
      setDebugInfoRef.current(`pins:true dom:${markersRef.current.length} stops:${curStops.length} lines:{sequence:${seqCoordsCount}, active:${actCoordsCount}}`);
    }
  }, [stops, activeIndex, selectedStopIndex, mapLoaded, activeRouteCoordinates, driverLocation]);

  // Update HTML Driver GPS Puck Marker (Zero-Jitter Smooth Animation)
  const lastDriverBearingRef = useRef(0);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (driverLocation && (Array.isArray(driverLocation) ? driverLocation.length >= 2 : (driverLocation.longitude != null && driverLocation.latitude != null))) {
      const lng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation.longitude;
      const lat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation.latitude;
      const lngLat = [lng, lat];
      const rawBearing = (driverLocation && typeof driverLocation === 'object' && !Array.isArray(driverLocation))
        ? (driverLocation.bearing ?? driverLocation.heading)
        : null;

      // Only update heading if valid; never snap to 0 on stationary or null ticks
      if (rawBearing != null && !isNaN(rawBearing)) {
        lastDriverBearingRef.current = rawBearing;
      }
      const displayBearing = lastDriverBearingRef.current;

      if (!driverMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'vehicle-marker-disk';
        const arrow = document.createElement('div');
        arrow.className = 'vehicle-marker-arrow';
        arrow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#2676D9"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>`;
        arrow.style.transform = `rotate(${displayBearing}deg)`;
        el.appendChild(arrow);
        driverMarkerRef.current = new Marker({ element: el })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat(lngLat);
        const arrowEl = driverMarkerRef.current.getElement()?.querySelector('.vehicle-marker-arrow');
        if (arrowEl) {
          arrowEl.style.transform = `rotate(${displayBearing}deg)`;
        }
      }
    } else if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }
  }, [driverLocation, mapLoaded]);

  // 7. Camera Auto-framing (Fixed: never depends on driverLocation to avoid unwanted snap-backs)
  const fitMapToBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const validCoords = (stops || []).map(getStopCoords).filter(Boolean);
    if (!validCoords.length) return;

    const bounds = new LngLatBounds();
    validCoords.forEach((c) => bounds.extend(c));
    const curDriverLoc = driverLocationRef.current;
    if (curDriverLoc) {
      const dlLng = Array.isArray(curDriverLoc) ? curDriverLoc[0] : curDriverLoc?.longitude;
      const dlLat = Array.isArray(curDriverLoc) ? curDriverLoc[1] : curDriverLoc?.latitude;
      if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
        bounds.extend([dlLng, dlLat]);
      }
    }

    map.fitBounds(bounds, {
      padding: { top: 70, bottom: 90, left: 50, right: 50 },
      maxZoom: 16,
      duration: 800
    });
  }, [stops]);

  // Initial fit: runs when stops and/or driverLocation first become available
  useEffect(() => {
    if (mapLoaded && stops.length > 0) {
      if (!hasInitialFitRef.current) {
        hasInitialFitRef.current = true;
        fitMapToBounds();
      } else if (driverLocation && !hasGpsFittedRef.current && !isNavigating) {
        hasGpsFittedRef.current = true;
        fitMapToBounds();
      }
    }
  }, [mapLoaded, stops.length, driverLocation, isNavigating, fitMapToBounds]);

  // Explicit Recenter Button Handler
  const handleRecenter = () => {
    setUserIsPanning(false);
    userIsPanningRef.current = false;
    setChipDismissed(false);

    const map = mapRef.current;
    if (!map) return;

    const curDriverLoc = driverLocationRef.current;
    if (curDriverLoc) {
      const dlLng = Array.isArray(curDriverLoc) ? curDriverLoc[0] : curDriverLoc?.longitude;
      const dlLat = Array.isArray(curDriverLoc) ? curDriverLoc[1] : curDriverLoc?.latitude;
      const bearing = (!Array.isArray(curDriverLoc) && curDriverLoc?.bearing != null) ? curDriverLoc.bearing : 0;
      if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
        map.flyTo({
          center: [dlLng, dlLat],
          bearing: isNavigating ? bearing : 0,
          pitch: isNavigating ? 50 : 0,
          zoom: 17,
          essential: true,
          duration: 800
        });
        return;
      }
    }

    const target = stops[activeIndex];
    const coords = getStopCoords(target);
    if (coords) {
      map.flyTo({ center: coords, zoom: 16, pitch: 0, bearing: 0, essential: true });
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
      <div className={`maplibre-wrapper ${isFullscreen ? 'maplibre-fullscreen' : ''} ${isNavigating ? 'maplibre-navigating-active' : ''}`}>
        <div ref={mapContainerRef} className="maplibre-canvas-container" />

        {/* Top Status Bar Notch Scrim (ensures white battery/clock text is always crisp over map) */}
        {isFullscreen && <div className="map-notch-scrim" />}

        {/* Turn-by-Turn Guidance Banner (Phase D) - Active Header with prominent Exit button */}
        {isNavigating && guidance && isFullscreen && (
          <TurnInstructionCard
            currentInstruction={guidance.currentInstruction}
            nextInstruction={guidance.nextInstruction}
            distanceToManeuver={guidance.distanceToManeuver}
            isRecalculating={guidance.isRecalculating}
            language={guidance.language}
            onExit={() => {
              if (onExitNavigation) {
                onExitNavigation();
              } else {
                setIsFullscreen(false);
              }
            }}
          />
        )}

        {/* Fullscreen Back Bar (Shown only in standard full view when NOT navigating) */}
        {isFullscreen && !isNavigating && (
          <div className="map-fullscreen-header-bar">
            <button
              onClick={() => setIsFullscreen(false)}
              className="map-back-btn"
              title={t('back')}
            >
              <ChevronLeft size={18} />
              <span>{t('back')}</span>
            </button>
            {stops && stops.length > 0 && (
              <div className="header-progress-pill" style={{ padding: '0.3rem 0.65rem', zIndex: 100 }}>
                <span className="header-progress-text">
                  {stops.filter((s) => s.status === 'delivered').length}/{stops.length}
                </span>
                <div className="header-progress-track" style={{ width: '42px' }}>
                  <div
                    className="header-progress-fill"
                    style={{
                      width: `${(stops.filter((s) => s.status === 'delivered').length / stops.length) * 100}%`
                    }}
                  />
                </div>
              </div>
            )}
            <div className="map-legend-pill" style={{ position: 'static' }}>
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

        {/* Always-visible live diagnostic HUD */}
        <div className="map-debug-hud-pill">
          <span>{debugInfo}</span>
        </div>

        {/* Modular Floating Map Controls (Notch Safe) */}
        <MapFloatingControls
          isNavigating={isNavigating}
          isFullscreen={isFullscreen}
          userIsPanning={userIsPanning}
          isMuted={guidance?.isMuted || false}
          mapTheme={mapTheme}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          onToggleTheme={handleToggleTheme}
          onRecenter={handleRecenter}
          onFitBounds={fitMapToBounds}
          onToggleMute={guidance?.onToggleMute}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          t={t}
        />

        {/* Floating Current Street Pill (Image 3 Mockup) - suppressed when expanded sheet is open */}
        {isNavigating && !selectedStop && !showExpandedStopCard && (() => {
          const street = guidance?.currentInstruction?.streetNames?.[0]
            || (stops && stops[activeIndex]?.address?.street)
            || (stops && stops[activeIndex]?.address?.raw)
            || '';
          if (!street) return null;
          return (
            <div className="floating-street-pill-container">
              <div className="floating-street-pill">
                <span>{street}</span>
              </div>
            </div>
          );
        })()}

        {/* Active Navigation Floating Bottom Chip or Full Sheet (Phase D) */}
        {(() => {
          const activeStop = stops && stops[activeIndex] ? stops[activeIndex] : null;
          const showSheet = selectedStop || showExpandedStopCard || (isFullscreen && !isNavigating);
          const displayStop = selectedStop || (showSheet ? activeStop : null);
          const displayStopIndex = selectedStop ? selectedStopIndex : activeIndex;
          const isDisplayNextStop = displayStopIndex === activeIndex;

          // Distance and ETA calculations for the active/inspected stop
          const calcStop = displayStop || activeStop;
          let distanceStr = null;
          let etaStr = null;
          if (calcStop) {
            const targetCoords = getStopCoords(calcStop);
            if (targetCoords) {
              const curDriverLoc = driverLocationRef.current;
              const dlLng = Array.isArray(curDriverLoc) ? curDriverLoc[0] : curDriverLoc?.longitude;
              const dlLat = Array.isArray(curDriverLoc) ? curDriverLoc[1] : curDriverLoc?.latitude;
              if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
                const distMeters = haversineDistance(dlLat, dlLng, targetCoords[1], targetCoords[0]);
                const miles = distMeters * 0.000621371;
                distanceStr = `${miles.toFixed(1)} mi`;
                etaStr = `${Math.max(1, Math.round(miles * 2.5))} min`;
              }
            }
          }

          // Case A: User opened full stop card or clicked a marker
          if (showSheet && displayStop) {
            return (
              <NextStopCard
                stop={displayStop}
                stopIndex={displayStopIndex}
                totalStops={stops.length}
                isNavigating={isNavigating}
                distanceStr={distanceStr}
                etaStr={etaStr}
                isFloating={true}
                onNavigate={() => {
                  if (onStartNavigation) {
                    onStartNavigation(displayStopIndex);
                  } else if (onNavigateHere) {
                    onNavigateHere(displayStopIndex);
                  }
                  setSelectedStop(null);
                  setSelectedStopIndex(null);
                  setShowExpandedStopCard(false);
                  setUserIsPanning(false);
                  userIsPanningRef.current = false;
                }}
                onMarkDelivered={isDisplayNextStop ? onMarkDelivered : null}
                onSkipStop={isDisplayNextStop ? onSkipStop : null}
                onClose={() => {
                  setSelectedStop(null);
                  setSelectedStopIndex(null);
                  setShowExpandedStopCard(false);
                }}
                t={t}
              />
            );
          }

          // Case B: In active navigation, show minimal non-obstructive bottom chip
          if (isNavigating && activeStop && !chipDismissed) {
            return (
              <CurrentStopChip
                stop={activeStop}
                stopIndex={activeIndex}
                distanceStr={distanceStr}
                etaStr={etaStr}
                onDismiss={() => setChipDismissed(true)}
                onExpand={() => setShowExpandedStopCard(true)}
              />
            );
          }

          return null;
        })()}
      </div>
    </div>
  );
}
