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
import { useLanguage } from '../utils/i18n';
import { haversineDistance } from '../utils/geoUtils';

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

/**
 * Safely adds layer to MapLibre instance.
 * Returns true if the layer was already present OR was added successfully.
 * Returns false if addLayer threw.
 */
function safeAddLayer(map, layerDef, beforeId) {
  try {
    if (map.getLayer(layerDef.id)) return true; // Already exists
    if (beforeId && map.getLayer(beforeId)) {
      map.addLayer(layerDef, beforeId);
    } else {
      map.addLayer(layerDef);
    }
    return true;
  } catch (e) {
    console.error(`[MapView] safeAddLayer FAILED (${layerDef.id}):`, e.message);
    return false;
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

      // A. Sequence Route Line
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
        paint: { 'line-color': '#0369a1', 'line-width': 7, 'line-opacity': 0.35 }
      });
      safeAddLayer(map, {
        id: 'sequence-route', type: 'line', source: 'sequence-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': 3.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }
      });

      // B. Active Target Route Leg
      safeAddSource(map, 'active-route-source', {
        type: 'geojson',
        data: buildActiveRouteGeoJSON(curStops, curActiveIdx, curRouteCoords, curDriverLoc)
      });
      safeAddLayer(map, {
        id: 'active-route-casing', type: 'line', source: 'active-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#15803d', 'line-width': 10, 'line-opacity': 0.45 }
      });
      safeAddLayer(map, {
        id: 'active-route', type: 'line', source: 'active-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 5.5, 'line-opacity': 1.0 }
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
      const overlayLayerIds = [
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
      overlayLayerIds.forEach((id) => {
        try {
          if (map.getLayer(id)) map.moveLayer(id);
        } catch (_) {}
      });

      // Verify the critical layer truly exists before declaring success
      const confirmed = !!map.getLayer('stops-pin-outer') && !!map.getSource('stops-source');
      if (confirmed) {
        if (dbg) dbg(`OK pins:${pinOk} stops:${curStops.length} valid:${validCoordCount}`);
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
      const seqSource = map.getSource('sequence-route-source');
      if (seqSource) {
        seqSource.setData(buildSequenceRouteGeoJSON(stops));
      } else {
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

    if (setDebugInfoRef.current) {
      setDebugInfoRef.current(`OK pins:true dom:${markersRef.current.length} stops:${curStops.length}`);
    }
  }, [stops, activeIndex, selectedStopIndex, mapLoaded]);

  // Update HTML Driver GPS Puck Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (driverLocation && (Array.isArray(driverLocation) ? driverLocation.length >= 2 : (driverLocation.longitude != null && driverLocation.latitude != null))) {
      const lng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation.longitude;
      const lat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation.latitude;
      const lngLat = [lng, lat];
      const bearing = (driverLocation && typeof driverLocation === 'object' && !Array.isArray(driverLocation))
        ? (driverLocation.heading ?? driverLocation.bearing ?? 0)
        : 0;

      if (!driverMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'vehicle-marker-disk';
        const arrow = document.createElement('div');
        arrow.className = 'vehicle-marker-arrow';
        arrow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#2676D9"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>`;
        arrow.style.transform = `rotate(${bearing || 0}deg)`;
        el.appendChild(arrow);
        driverMarkerRef.current = new Marker({ element: el })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat(lngLat);
        const arrowEl = driverMarkerRef.current.getElement()?.querySelector('.vehicle-marker-arrow');
        if (arrowEl && bearing != null) {
          arrowEl.style.transform = `rotate(${bearing}deg)`;
        }
      }
    } else if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }
  }, [driverLocation, mapLoaded]);

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

        {/* DEBUG HUD — shows layer setup status on device screen */}
        <div style={{
          position: 'absolute', bottom: 48, left: 8, zIndex: 9000,
          background: 'rgba(0,0,0,0.75)', color: '#4ade80',
          fontSize: 10, fontFamily: 'monospace', padding: '3px 6px',
          borderRadius: 4, maxWidth: '85%', wordBreak: 'break-all',
          pointerEvents: 'none'
        }}>
          {debugInfo}
        </div>

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

        {/* Floating Bottom Sheet for Selected Stop or Active Stop in Fullscreen (Phase C) */}
        {(() => {
          const activeStop = stops && stops[activeIndex] ? stops[activeIndex] : null;
          const displayStop = selectedStop || (isFullscreen ? activeStop : null);
          const displayStopIndex = selectedStop ? selectedStopIndex : activeIndex;
          const isDisplayNextStop = displayStopIndex === activeIndex;

          if (!displayStop) return null;

          // Distance and ETA to displayStop
          let sheetDistanceStr = null;
          let sheetEtaStr = null;
          const targetCoords = getStopCoords(displayStop);
          if (targetCoords) {
            const dlLng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation?.longitude;
            const dlLat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation?.latitude;
            if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
              const distMeters = haversineDistance(dlLat, dlLng, targetCoords[1], targetCoords[0]);
              const miles = distMeters * 0.000621371;
              sheetDistanceStr = `${miles.toFixed(1)} mi`;
              sheetEtaStr = `${Math.max(1, Math.round(miles * 2.5))} min`;
            }
          }

          return (
            <div className="map-bottom-sheet">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span className="next-stop-pill">
                  {isDisplayNextStop ? (displayStopIndex === 0 ? 'START ROUTE' : 'NEXT STOP') : `STOP ${displayStopIndex + 1}`}
                </span>
                {selectedStop && (
                  <button
                    onClick={() => {
                      setSelectedStop(null);
                      setSelectedStopIndex(null);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-gray, #8A8F96)', cursor: 'pointer', padding: '0.25rem' }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem', marginBottom: '0.75rem' }}>
                <div className="next-stop-number-badge">
                  {displayStopIndex + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.25 }}>
                    {displayStop.recipient || displayStop.address?.recipient || displayStop.address?.street || displayStop.address?.raw || t('stopDetails')}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-gray, #8A8F96)', marginTop: '2px' }}>
                    {[displayStop.address?.city, displayStop.address?.state, displayStop.address?.postalCode].filter(Boolean).join(', ')}
                  </div>
                </div>
              </div>

              {/* Distance & ETA + Tags */}
              <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.75rem', color: 'var(--color-gray, #8A8F96)', marginBottom: '0.85rem' }}>
                {sheetDistanceStr && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#FFFFFF', fontWeight: 600 }}>
                    <Navigation size={13} color="var(--color-blue-nav, #2676D9)" />
                    <span>{sheetDistanceStr}</span>
                    {sheetEtaStr && <span style={{ color: 'var(--color-gray, #8A8F96)', fontWeight: 400 }}>• {sheetEtaStr}</span>}
                  </div>
                )}

                {displayStop.trackingNumber && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Tag size={12} />
                    <span>{t('package')}: {displayStop.trackingNumber}</span>
                  </div>
                )}

                {displayStop.address?.gateCode && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#fbbf24', fontWeight: 600 }}>
                    <Key size={12} />
                    <span>Gate: #{displayStop.address.gateCode}</span>
                  </div>
                )}
              </div>

              {/* Full-width Navigate Action Button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  className="btn-navigate-action"
                  onClick={() => {
                    if (onNavigateHere) onNavigateHere(displayStopIndex);
                    setSelectedStop(null);
                  }}
                >
                  <Navigation size={17} />
                  <span>
                    {displayStopIndex === activeIndex
                      ? (isNavigating ? t('resumeNavigation') : t('startNavigationToStop', { number: displayStopIndex + 1 }))
                      : t('navigateHere')}
                  </span>
                </button>

                {/* In-sequence delivery actions if viewing next stop */}
                {isDisplayNextStop && (onMarkDelivered || onSkipStop) && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
                    {onMarkDelivered && (
                      <button
                        className="btn btn-success btn-sm"
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.55rem', borderRadius: '10px' }}
                        onClick={onMarkDelivered}
                      >
                        <CheckCircle2 size={15} />
                        <span>{t('delivered')}</span>
                      </button>
                    )}
                    {onSkipStop && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.55rem', borderRadius: '10px' }}
                        onClick={onSkipStop}
                      >
                        <AlertTriangle size={15} color="#f59e0b" />
                        <span>{t('skipAttempt')}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
