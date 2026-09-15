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
import { haversineDistance, getStopCoords } from '../utils/geoUtils';
import { getCachedCoordinates } from '../utils/geocodeCache';
import { diagnosticLogger } from '../services/diagnosticLogger';
import SystemLogModal from './SystemLogModal';

export { getStopCoords };

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
 * STRICT: Returns empty features when isRoadSnapped === false (no straight stick lines).
 */
export function buildSequenceRouteGeoJSON(stopsList, sequenceCoords = null, isRoadSnapped = true) {
  if (!isRoadSnapped) {
    return { type: 'FeatureCollection', features: [] };
  }
  if (sequenceCoords && sequenceCoords.length >= 2) {
    const sanitizedCoords = sequenceCoords.filter(pt => pt && pt.length >= 2 && !isNaN(pt[0]) && !isNaN(pt[1]));
    if (sanitizedCoords.length >= 2) {
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: sanitizedCoords
            },
            properties: {}
          }
        ]
      };
    }
  }
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
 * Builds standard GeoJSON FeatureCollection Points for approximate dot-trail across manifest stops.
 * Rendered ONLY when isRoadSnapped === false.
 */
export function buildSequenceDotTrailGeoJSON(stopsList, isRoadSnapped = true) {
  if (isRoadSnapped) {
    return { type: 'FeatureCollection', features: [] };
  }
  const validCoords = (stopsList || []).map(getStopCoords).filter(Boolean);
  if (validCoords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (let i = 0; i < validCoords.length - 1; i++) {
    const p1 = validCoords[i];
    const p2 = validCoords[i + 1];
    const count = 15;
    for (let s = 1; s <= count; s++) {
      const frac = s / (count + 1);
      const lng = p1[0] + (p2[0] - p1[0]) * frac;
      const lat = p1[1] + (p2[1] - p1[1]) * frac;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: { segmentIndex: i }
      });
    }
  }
  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Builds standard GeoJSON FeatureCollection LineString for active target route leg.
 * STRICT: Returns empty features when isRoadSnapped === false (no straight stick lines).
 */
export function buildActiveRouteGeoJSON(stopsList, activeIdx, activeRouteCoords, driverLoc, isRoadSnapped = true) {
  if (!isRoadSnapped) {
    return { type: 'FeatureCollection', features: [] };
  }
  let coords = null;
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;
  const hasDriverLoc = dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat);

  if (activeRouteCoords && activeRouteCoords.length > 1) {
    coords = activeRouteCoords.filter(pt => pt && pt.length >= 2 && !isNaN(pt[0]) && !isNaN(pt[1])).map(pt => [...pt]);
    // Snap route head directly to vehicle location so line is never disconnected
    if (hasDriverLoc && coords.length > 0) {
      coords[0] = [dlLng, dlLat];
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
 * Builds standard GeoJSON FeatureCollection Points for approximate dot-trail to active destination.
 * Rendered ONLY when isRoadSnapped === false.
 * Supports null driver location fallback so dots render reliably before initial GPS fix.
 */
export function buildDotTrailGeoJSON(driverLoc, targetCoords, isRoadSnapped = true) {
  if (isRoadSnapped) {
    return { type: 'FeatureCollection', features: [] };
  }
  if (!targetCoords || targetCoords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;

  // STRICT: When driver location is null or invalid, render NO dot trail and NO synthetic starting point
  if (dlLng == null || dlLat == null || isNaN(dlLng) || isNaN(dlLat)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const tLng = targetCoords[0];
  const tLat = targetCoords[1];
  const count = 16;
  const features = [];
  for (let s = 1; s <= count; s++) {
    const frac = s / (count + 1);
    const lng = dlLng + (tLng - dlLng) * frac;
    const lat = dlLat + (tLat - dlLat) * frac;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lng, lat]
      },
      properties: {}
    });
  }
  return {
    type: 'FeatureCollection',
    features
  };
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
  'sequence-route-approximate-dots',
  'active-route-casing',
  'active-route',
  'active-route-approximate-dots',
  'driver-puck-halo',
  'driver-puck-core',
  'stops-active-halo',
  'stops-pin-outer',
  'stops-number-label'
];

/**
 * Safely adds an overlay layer to MapLibre instance.
 * Layers added without beforeId are placed at the top of the layer array naturally.
 */
function addOverlayLayer(map, layerDef) {
  try {
    if (!map.getLayer(layerDef.id)) {
      map.addLayer(layerDef);
    }
    return true;
  } catch (e) {
    console.error(`[MapView] addOverlayLayer FAILED (${layerDef.id}):`, e.message);
    return false;
  }
}

/**
 * Ensures all registered overlay layers are strictly above any raster basemaps.
 * Can be called during style reloads or theme switches.
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
  sequenceRouteCoordinates = null,
  isSequenceRoadSnapped = true,
  activeRouteCoordinates = null,
  isActiveRoadSnapped = true,
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
  const sequenceRouteCoordsRef = useRef(sequenceRouteCoordinates);
  sequenceRouteCoordsRef.current = sequenceRouteCoordinates;
  const isSequenceRoadSnappedRef = useRef(isSequenceRoadSnapped);
  isSequenceRoadSnappedRef.current = isSequenceRoadSnapped;
  const activeRouteCoordsRef = useRef(activeRouteCoordinates);
  activeRouteCoordsRef.current = activeRouteCoordinates;
  const isActiveRoadSnappedRef = useRef(isActiveRoadSnapped);
  isActiveRoadSnappedRef.current = isActiveRoadSnapped;
  const driverLocationRef = useRef(driverLocation);
  driverLocationRef.current = driverLocation;
  const onSelectStopRef = useRef(onSelectStop);
  onSelectStopRef.current = onSelectStop;
  const markersRef = useRef([]);
  const driverMarkerRef = useRef(null);
  // Tracks last DIAG state to suppress repeated identical DIAG log entries
  const lastDiagStateRef = useRef(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapTheme, setMapTheme] = useState('street');
  const [nativePmtilesPath, setNativePmtilesPath] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState('waiting…');
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [isHudExpanded, setIsHudExpanded] = useState(false);

  // Centralized Debug HUD status updater
  const updateHudDebugInfo = useCallback(() => {
    if (!setDebugInfoRef.current) return;
    try {
      const curStops = stopsRef.current || [];
      const seqGeoJSON = buildSequenceRouteGeoJSON(curStops, sequenceRouteCoordsRef.current, isSequenceRoadSnappedRef.current);
      const activeGeoJSON = buildActiveRouteGeoJSON(curStops, activeIndexRef.current, activeRouteCoordsRef.current, driverLocationRef.current, isActiveRoadSnappedRef.current);
      const seqDotsGeoJSON = buildSequenceDotTrailGeoJSON(curStops, isSequenceRoadSnappedRef.current);
      const activeTargetStop = curStops && curStops[activeIndexRef.current];
      const activeTargetCoords = getStopCoords(activeTargetStop);
      const activeDotsGeoJSON = buildDotTrailGeoJSON(driverLocationRef.current, activeTargetCoords, isActiveRoadSnappedRef.current);

      const seqCoordsCount = seqGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
      const actCoordsCount = activeGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
      const seqDotsCount = seqDotsGeoJSON.features?.length || 0;
      const actDotsCount = activeDotsGeoJSON.features?.length || 0;

      setDebugInfoRef.current(
        `pins:true dom:${markersRef.current?.length || 0} stops:${curStops.length} lines:{seq:${seqCoordsCount}, act:${actCoordsCount}} dots:{seq:${seqDotsCount}, act:${actDotsCount}} lastFetch:${diagnosticLogger.getLastFetchOutcome()}`
      );
    } catch (_) {}
  }, []);

  // Subscribe to diagnosticLogger for real-time HUD lastFetch updates
  useEffect(() => {
    return diagnosticLogger.subscribe(() => {
      if (mapRef.current) {
        updateHudDebugInfo();
      }
    });
  }, [updateHudDebugInfo]);

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
  // Uses isolated try/catch blocks for each concern (sequence, active, puck, stops).
  // Ensures overlays are on top and sets mapLoaded to true.
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

      // A. Sequence Route Line & Approximate Dot-Trail
      try {
        safeAddSource(map, 'sequence-route-source', {
          type: 'geojson',
          data: buildSequenceRouteGeoJSON(curStops, sequenceRouteCoordsRef.current, isSequenceRoadSnappedRef.current)
        });
        safeAddLayer(map, {
          id: 'sequence-route-casing', type: 'line', source: 'sequence-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
          paint: { 'line-color': '#0f172a', 'line-width': 8, 'line-opacity': 0.7 }
        });
        safeAddLayer(map, {
          id: 'sequence-route', type: 'line', source: 'sequence-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
          paint: { 'line-color': '#2676D9', 'line-width': 4, 'line-opacity': 0.95 }
        });

        safeAddSource(map, 'sequence-dots-source', {
          type: 'geojson',
          data: buildSequenceDotTrailGeoJSON(curStops, isSequenceRoadSnappedRef.current)
        });
        safeAddLayer(map, {
          id: 'sequence-route-approximate-dots',
          type: 'circle',
          source: 'sequence-dots-source',
          paint: {
            'circle-radius': 4,
            'circle-color': '#f59e0b',
            'circle-opacity': 0.95,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#1e293b'
          }
        });
      } catch (seqErr) {
        diagnosticLogger.logRenderError('setup:sequence', seqErr);
      }

      // B. Active Target Route Leg & Approximate Dot-Trail
      try {
        safeAddSource(map, 'active-route-source', {
          type: 'geojson',
          data: buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc, isActiveRoadSnappedRef.current)
        });
        safeAddLayer(map, {
          id: 'active-route-casing', type: 'line', source: 'active-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
          paint: { 'line-color': '#064e3b', 'line-width': 10, 'line-opacity': 0.8 }
        });
        safeAddLayer(map, {
          id: 'active-route', type: 'line', source: 'active-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
          paint: { 'line-color': '#22c55e', 'line-width': 6, 'line-opacity': 1.0 }
        });

        const activeTargetStop = curStops && curStops[curActiveIdx];
        const activeTargetCoords = getStopCoords(activeTargetStop);
        safeAddSource(map, 'active-dots-source', {
          type: 'geojson',
          data: buildDotTrailGeoJSON(curDriverLoc, activeTargetCoords, isActiveRoadSnappedRef.current)
        });
        safeAddLayer(map, {
          id: 'active-route-approximate-dots',
          type: 'circle',
          source: 'active-dots-source',
          paint: {
            'circle-radius': 5.0,
            'circle-color': '#F28C28',
            'circle-opacity': 1.0,
            'circle-stroke-width': 2.0,
            'circle-stroke-color': '#ffffff'
          }
        });
      } catch (actErr) {
        diagnosticLogger.logRenderError('setup:active', actErr);
      }

      // C. Driver GPS Location Puck
      try {
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
      } catch (puckErr) {
        diagnosticLogger.logRenderError('setup:puck', puckErr);
      }

      // D. Stop Markers — this is the CRITICAL source.
      try {
        safeAddSource(map, 'stops-source', {
          type: 'geojson',
          data: buildStopsGeoJSON(curStops, curActiveIdx, null)
        });

        safeAddLayer(map, {
          id: 'stops-active-halo', type: 'circle', source: 'stops-source',
          filter: ['==', ['get', 'isActive'], true],
          paint: { 'circle-radius': 22, 'circle-color': '#F28C28', 'circle-opacity': 0.35,
                   'circle-stroke-width': 2, 'circle-stroke-color': '#F28C28' }
        });
        safeAddLayer(map, {
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
      } catch (stopErr) {
        diagnosticLogger.logRenderError('setup:stops', stopErr);
      }

      // Explicitly move all custom overlay layers to the TOP of the layer stack
      ensureOverlaysOnTop(map);

      mapRef.current = map;
      setMapLoaded(true);

      const seqGeoJSON = buildSequenceRouteGeoJSON(curStops, sequenceRouteCoordsRef.current, isSequenceRoadSnappedRef.current);
      const activeGeoJSON = buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc, isActiveRoadSnappedRef.current);
      const seqCoordsCount = seqGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
      const actCoordsCount = activeGeoJSON.features?.[0]?.geometry?.coordinates?.length || 0;
      if (dbg) dbg(`pins:true dom:${markersRef.current?.length || 0} stops:${curStops.length} lines:{sequence:${seqCoordsCount}, active:${actCoordsCount}}`);

      return true;
    } catch (err) {
      console.error('[MapView] setupLayers threw:', err.message);
      diagnosticLogger.logRenderError('setupLayers', err);
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
      const msg = e?.error?.message || (typeof e === 'string' ? e : (e?.message || 'Unknown MapLibre error'));
      console.warn('[MapLibre error event]:', msg);
      const level = (msg && (msg.includes('404') || msg.includes('glyphs'))) ? 'warn' : 'error';
      diagnosticLogger.logRoutingEvent({
        endpoint: 'MapLibre',
        status: 'ERR',
        level,
        summary: `MapLibre error: ${msg}`
      });
    });

    // Detect user manual interaction so we do NOT forcibly snap the camera back
    const handleUserMapInteraction = () => {
      setUserIsPanning(true);
      userIsPanningRef.current = true;
    };
    map.on('dragstart', handleUserMapInteraction);
    map.on('rotatestart', handleUserMapInteraction);
    map.on('pitchstart', handleUserMapInteraction);

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

    // One-shot style.load fires on style reloads or theme swaps
    map.on('style.load', () => {
      setupLayers(map);
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
      markersRef.current.forEach((m) => {
        try { m.remove(); } catch (_) {}
      });
      markersRef.current = [];
      if (driverMarkerRef.current) {
        try { driverMarkerRef.current.remove(); } catch (_) {}
        driverMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
      setDebugInfo('waiting…');
    };
  }, [setupLayers]);

  // Track the last applied style key so we ONLY call setStyle when the user
  // genuinely changes theme/offline/pmtiles — NOT on every initial load.
  // Root cause of the broken-tile / missing-line bug: mapLoaded is in deps, so
  // whenever setMapLoaded(true) fires (initial load), this effect called
  // map.setStyle() immediately, destroying all sources & layers that setupLayers
  // had just added.  The style was already set in the MapLibre constructor —
  // calling setStyle again is unnecessary AND destructive on first render.
  const lastStyleKeyRef = useRef(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
    const styleKey = `${mapTheme}|${offlineMode}|${String(pmtilesUrl)}|${activeRegion}`;

    // First run after initial load: record the key and exit — the MapLibre
    // constructor already applied this exact style.
    if (lastStyleKeyRef.current === null) {
      lastStyleKeyRef.current = styleKey;
      diagnosticLogger.logRoutingEvent({
        endpoint: 'setStyle',
        status: 'INFO',
        level: 'info',
        summary: `ℹ️ setStyle: initial key recorded (skipping redundant call) → ${styleKey}`
      });
      return;
    }

    // Only call setStyle when something actually changed.
    if (lastStyleKeyRef.current === styleKey) return;
    lastStyleKeyRef.current = styleKey;

    diagnosticLogger.logRoutingEvent({
      endpoint: 'setStyle',
      status: 'INFO',
      level: 'info',
      summary: `🎨 setStyle: style changed → ${styleKey}`
    });

    try {
      const newStyle = buildMapStyle({ pmtilesUrl, isOffline: offlineMode, theme: mapTheme });
      isSettingUpRef.current = false;
      map.setStyle(newStyle);
    } catch (err) {
      diagnosticLogger.logRenderError('setStyle', err);
    }
  }, [mapTheme, offlineMode, nativePmtilesPath, activeRegion, mapLoaded]);



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
      } else {
        // Source not ready yet — attempt layer setup
        setupLayers(map);
      }
    } catch (err) {
      diagnosticLogger.logRenderError('webgl-pins', err);
    }
  }, [stops, activeIndex, selectedStopIndex, mapLoaded, setupLayers]);

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
      diagnosticLogger.logRenderError('driver-puck', err);
    }
  }, [driverLocation, mapLoaded, setupLayers]);

  // Update Polylines: Sequence Route (Blue) & Active Route (Green) or Approximate Dot-Trails
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // ── DIAGNOSTIC CHECKS — only log when state meaningfully changes ────────────────
    const seqSrcExists = !!map.getSource('sequence-route-source');
    const actSrcExists = !!map.getSource('active-route-source');
    const seqLayerExists = !!map.getLayer('sequence-route');
    const actLayerExists = !!map.getLayer('active-route');

    // Build a compact state key — only emit DIAG logs when this key changes
    let seqCoordCount = 0;
    let actCoordCount = 0;
    try {
      const seqGJ = buildSequenceRouteGeoJSON(stops, sequenceRouteCoordinates, isSequenceRoadSnapped);
      const actGJ = buildActiveRouteGeoJSON(stops, activeIndex, activeRouteCoordinates, driverLocation, isActiveRoadSnapped);
      seqCoordCount = seqGJ.features?.[0]?.geometry?.coordinates?.length || 0;
      actCoordCount = actGJ.features?.[0]?.geometry?.coordinates?.length || 0;
    } catch (_) {}

    const diagKey = `${seqSrcExists}|${actSrcExists}|${seqLayerExists}|${actLayerExists}|${seqCoordCount}|${actCoordCount}`;
    if (diagKey !== lastDiagStateRef.current) {
      lastDiagStateRef.current = diagKey;

      // DIAG-1: Source existence
      const diag1 = `[DIAG-1] src: seq=${seqSrcExists} act=${actSrcExists}`;
      console.error(diag1);
      diagnosticLogger.logRoutingEvent({ endpoint: 'DIAG-1', status: seqSrcExists && actSrcExists ? 'SUCCESS' : 'WARN', level: seqSrcExists && actSrcExists ? 'info' : 'warn', summary: diag1 });

      // DIAG-2: Layer stack
      try {
        const allLayerIds = map.getStyle().layers.map(l => l.id);
        const seqIdx = allLayerIds.indexOf('sequence-route');
        const actIdx = allLayerIds.indexOf('active-route');
        const diag2 = `[DIAG-2] layers:${allLayerIds.length} seq@${seqIdx} act@${actIdx} → ${allLayerIds.join(',')}`;
        console.error(diag2);
        diagnosticLogger.logRoutingEvent({ endpoint: 'DIAG-2', status: seqIdx >= 0 && actIdx >= 0 ? 'SUCCESS' : 'WARN', level: seqIdx >= 0 && actIdx >= 0 ? 'info' : 'warn', summary: diag2 });
      } catch (diagErr) {
        const msg = `[DIAG-2] getStyle threw: ${diagErr.message}`;
        console.error(msg);
        diagnosticLogger.logRoutingEvent({ endpoint: 'DIAG-2', status: 'ERR', level: 'error', summary: msg });
      }

      // DIAG-3: Coord counts (already computed above)
      const diag3 = `[DIAG-3] seq:${seqCoordCount} act:${actCoordCount}`;
      console.error(diag3);
      diagnosticLogger.logRoutingEvent({ endpoint: 'DIAG-3', status: seqCoordCount > 0 ? 'SUCCESS' : 'WARN', level: seqCoordCount > 0 ? 'info' : 'warn', summary: diag3 });

      // DIAG-4: Paint/visibility
      try {
        const seqVis = seqLayerExists ? map.getLayoutProperty('sequence-route', 'visibility') : 'LAYER_MISSING';
        const seqOpacity = seqLayerExists ? map.getPaintProperty('sequence-route', 'line-opacity') : 'LAYER_MISSING';
        const seqWidth = seqLayerExists ? map.getPaintProperty('sequence-route', 'line-width') : 'LAYER_MISSING';
        const actVis = actLayerExists ? map.getLayoutProperty('active-route', 'visibility') : 'LAYER_MISSING';
        const actOpacity = actLayerExists ? map.getPaintProperty('active-route', 'line-opacity') : 'LAYER_MISSING';
        const actWidth = actLayerExists ? map.getPaintProperty('active-route', 'line-width') : 'LAYER_MISSING';
        const diag4 = `[DIAG-4] seq-route: vis=${seqVis} op=${seqOpacity} w=${seqWidth} | act-route: vis=${actVis} op=${actOpacity} w=${actWidth}`;
        console.error(diag4);
        const layersOk = seqVis !== 'LAYER_MISSING' && actVis !== 'LAYER_MISSING';
        diagnosticLogger.logRoutingEvent({ endpoint: 'DIAG-4', status: layersOk ? 'SUCCESS' : 'WARN', level: layersOk ? 'info' : 'warn', summary: diag4 });
      } catch (diagErr) {
        const msg = `[DIAG-4] getLayoutProperty threw: ${diagErr.message}`;
        console.error(msg);
        diagnosticLogger.logRoutingEvent({ endpoint: 'DIAG-4', status: 'ERR', level: 'error', summary: msg });
      }
    }

    // 1. Sequence Route Line (Road-snapped)
    {
      const seqGeoJSON = buildSequenceRouteGeoJSON(stops, sequenceRouteCoordinates, isSequenceRoadSnapped);
      const seqSource = map.getSource('sequence-route-source');
      if (seqSource) {
        try {
          seqSource.setData(seqGeoJSON);
        } catch (seqErr) {
          console.error('[LINE-RENDER] sequence-route-source.setData THREW:', seqErr.message, seqErr.stack);
          diagnosticLogger.logRenderError('sequence-line', seqErr);
        }
      } else {
        console.error('[LINE-RENDER] sequence-route-source NOT FOUND — calling setupLayers');
        setupLayers(map);
      }
    }

    // 2. Sequence Dot-Trail (Approximate dots)
    try {
      const seqDotsGeoJSON = buildSequenceDotTrailGeoJSON(stops, isSequenceRoadSnapped);
      const seqDotsSource = map.getSource('sequence-dots-source');
      if (seqDotsSource) {
        seqDotsSource.setData(seqDotsGeoJSON);
      }
    } catch (seqDotsErr) {
      console.error('[LINE-RENDER] sequence-dots setData THREW:', seqDotsErr.message, seqDotsErr.stack);
      diagnosticLogger.logRenderError('sequence-dots', seqDotsErr);
    }

    // 3. Active Target Leg Line (Road-snapped)
    {
      const activeGeoJSON = buildActiveRouteGeoJSON(stops, activeIndex, activeRouteCoordinates, driverLocation, isActiveRoadSnapped);
      const activeSource = map.getSource('active-route-source');
      if (activeSource) {
        try {
          activeSource.setData(activeGeoJSON);
        } catch (actErr) {
          console.error('[LINE-RENDER] active-route-source.setData THREW:', actErr.message, actErr.stack);
          diagnosticLogger.logRenderError('active-line', actErr);
        }
      } else {
        console.error('[LINE-RENDER] active-route-source NOT FOUND — calling setupLayers');
        setupLayers(map);
      }
    }

    // 4. Active Target Leg Dot-Trail (Approximate dots)
    try {
      const activeTargetStop = stops && stops[activeIndex];
      const activeTargetCoords = getStopCoords(activeTargetStop);
      const activeDotsGeoJSON = buildDotTrailGeoJSON(driverLocation, activeTargetCoords, isActiveRoadSnapped);
      const activeDotsSource = map.getSource('active-dots-source');
      if (activeDotsSource) {
        activeDotsSource.setData(activeDotsGeoJSON);
      }
    } catch (actDotsErr) {
      console.error('[LINE-RENDER] active-dots setData THREW:', actDotsErr.message, actDotsErr.stack);
      diagnosticLogger.logRenderError('active-dots', actDotsErr);
    }

    // 5. Force explicit visibility on all line layers to bypass potential WebView rendering bugs
    try {
      if (seqLayerExists) map.setLayoutProperty('sequence-route', 'visibility', 'visible');
      if (map.getLayer('sequence-route-casing')) map.setLayoutProperty('sequence-route-casing', 'visibility', 'visible');
      if (actLayerExists) map.setLayoutProperty('active-route', 'visibility', 'visible');
      if (map.getLayer('active-route-casing')) map.setLayoutProperty('active-route-casing', 'visibility', 'visible');
    } catch (_) {}

    // 6. Force WebGL redraw — ensures line geometry is flushed to the GPU after setData
    try { map.triggerRepaint(); } catch (_) {}


    // 7. Ensure overlay layers remain above raster basemaps
    try { ensureOverlaysOnTop(map); } catch (_) {}

    // 8. Update HUD info
    updateHudDebugInfo();

  }, [stops, activeIndex, sequenceRouteCoordinates, isSequenceRoadSnapped, activeRouteCoordinates, isActiveRoadSnapped, driverLocation, mapLoaded, setupLayers, updateHudDebugInfo]);


  // Update HTML Stop Markers (Physically rendered in DOM layer ABOVE WebGL canvas)
  // Protected with outer and inner try/catch blocks; updates debug HUD immediately
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    try {
      // Clear existing markers safely
      markersRef.current.forEach((m) => {
        try { m.remove(); } catch (_) {}
      });
      markersRef.current = [];

      const curStops = stops || [];
      curStops.forEach((stop, idx) => {
        try {
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
        } catch (itemErr) {
          diagnosticLogger.logRoutingEvent({
            endpoint: 'markers',
            status: 'WARN',
            level: 'warn',
            summary: `⚠️ marker #${idx + 1} creation failed: ${itemErr.message}`
          });
        }
      });

      // Update HUD so dom: count is immediately accurate
      updateHudDebugInfo();
    } catch (err) {
      diagnosticLogger.logRenderError('markers', err);
    }
  }, [stops, activeIndex, selectedStopIndex, mapLoaded, updateHudDebugInfo]);

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
        // Only extend bounds to vehicle if driver is within 45km of manifest
        // Prevents over-zooming out when testing sample manifests from another city,
        // while comfortably capturing intra-metro testing (e.g. Cumming to Suwanee ~27km)
        const first = validCoords[0];
        const dist = haversineDistance(dlLat, dlLng, first[1], first[0]);
        if (dist <= 45000) {
          bounds.extend([dlLng, dlLat]);
        }
      }
    }

    map.fitBounds(bounds, {
      padding: { top: 70, bottom: isFullscreen ? 240 : 100, left: 50, right: 50 },
      maxZoom: 16,
      duration: 800
    });
  }, [stops, isFullscreen]);

  // Re-frame bounds when a new set of stops is loaded
  const prevStopsLengthRef = useRef(0);
  useEffect(() => {
    if (mapLoaded && stops.length > 0 && stops.length !== prevStopsLengthRef.current) {
      prevStopsLengthRef.current = stops.length;
      fitMapToBounds();
    }
  }, [mapLoaded, stops.length, fitMapToBounds]);

  // Pan to selected/active stop when tapping a stop card in non-navigating mode
  const prevActiveIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (mapLoaded && !isNavigating && activeIndex !== prevActiveIndexRef.current) {
      prevActiveIndexRef.current = activeIndex;
      const target = stops[activeIndex];
      const coords = getStopCoords(target);
      if (coords && mapRef.current) {
        mapRef.current.flyTo({ center: coords, zoom: 15.5, duration: 600 });
      }
    }
  }, [activeIndex, stops, mapLoaded, isNavigating]);

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

        {/* Waiting for GPS indicator pill when driver location is unavailable */}
        {(!driverLocation || (Array.isArray(driverLocation) ? !driverLocation.length : driverLocation.latitude == null)) && (
          <div className={`map-gps-waiting-pill ${isNavigating ? 'navigating' : ''}`}>
            <span className="gps-waiting-dot" />
            <span>Waiting for GPS…</span>
          </div>
        )}

        {/* Offline / Approximate Route Direction Pill */}
        {((!isActiveRoadSnapped && isNavigating) || (!isSequenceRoadSnapped && stops && stops.length > 1)) && (
          <div className={`map-approximate-route-pill ${isNavigating ? 'navigating' : ''}`}>
            Offline — Approximate Direction Only
          </div>
        )}

        {/* Always-visible live diagnostic HUD */}
        <div
          className={`map-debug-hud-pill ${isNavigating ? 'map-debug-hud-navigating' : ''}`}
          onClick={() => setIsHudExpanded(!isHudExpanded)}
          style={{ 
            cursor: 'pointer', 
            pointerEvents: 'auto',
            whiteSpace: isHudExpanded ? 'pre-wrap' : 'nowrap',
            wordBreak: isHudExpanded ? 'break-all' : 'normal',
            maxWidth: isHudExpanded ? '85vw' : '220px',
            overflow: 'hidden',
            textOverflow: isHudExpanded ? 'clip' : 'ellipsis',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '0.25rem'
          }}
          title="Click to expand or view Diagnostic Logs"
        >
          <span>{debugInfo}</span>
          {isHudExpanded && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setShowLogsModal(true);
              }}
              style={{
                background: '#475569',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                fontSize: '0.65rem',
                padding: '2px 6px',
                marginTop: '4px',
                cursor: 'pointer'
              }}
            >
              View Full Logs
            </button>
          )}
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
          const currentManeuverStreet = guidance?.currentInstruction?.streetNames?.[0] || '';
          const activeStopStreet = stops && stops[activeIndex]?.address?.street || '';
          const activeStopRaw = stops && stops[activeIndex]?.address?.raw || '';
          const street = currentManeuverStreet || activeStopStreet || activeStopRaw;
          if (!street) return null;

          const chipIsShowing = !chipDismissed && stops && stops[activeIndex];
          // If the bottom stop chip already displays destination address, do not duplicate it with an overlapping pill
          if (chipIsShowing && !currentManeuverStreet) {
            return null;
          }

          return (
            <div className={`floating-street-pill-container ${chipIsShowing ? 'floating-street-pill-above-chip' : ''}`}>
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
                const isApprox = !isActiveRoadSnapped;
                const approxPrefix = isApprox ? '~' : '';
                const approxSuffix = isApprox ? ' (approx)' : '';
                distanceStr = `${approxPrefix}${miles.toFixed(1)} mi${approxSuffix}`;
                etaStr = `${approxPrefix}${Math.max(1, Math.round(miles * 2.5))} min${approxSuffix}`;
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

        <SystemLogModal
          isOpen={showLogsModal}
          onClose={() => setShowLogsModal(false)}
        />
      </div>
    </div>
  );
}
