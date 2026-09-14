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

/**
 * Generate a high-DPI Retina stop pin icon into an in-memory canvas.
 * Registered into MapLibre's WebGL sprite registry so all stop markers
 * are drawn directly on the GPU in 120fps lockstep with map pans.
 */
function createStopPinImageData(stopNumber, status, isActive, isSelected) {
  const logicalSize = isSelected ? 40 : isActive ? 36 : 30;
  const pixelRatio = 2;
  const size = logicalSize * pixelRatio;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);

  const cx = logicalSize / 2;
  const cy = logicalSize / 2;
  const radius = logicalSize / 2 - 3;

  // Background color based on delivery status
  let bgColor = '#0284c7'; // pending blue
  if (isActive) {
    bgColor = '#16a34a'; // active target green
  } else if (status === 'delivered') {
    bgColor = '#334155'; // delivered slate
  }

  // Outer ring for active or selected stop
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (isActive) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Main pin circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Stop number text
  ctx.fillStyle = '#ffffff';
  const numStr = String(stopNumber);
  const fontSize = numStr.length > 2 ? 10 : numStr.length > 1 ? 12 : 13;
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numStr, cx, cy + 0.5);

  return ctx.getImageData(0, 0, size, size);
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
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
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

  // Helper to extract valid [lng, lat] from any stop shape
  const getStopCoords = (stop) => {
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
  };

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

  // 3. Initialize MapLibre GL instance
  useEffect(() => {
    if (!mapContainerRef.current) return;

    registerPMTilesProtocol();

    const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
    const styleObj = buildMapStyle({ pmtilesUrl, isOffline: offlineMode, theme: mapTheme });

    // Center map around first valid stop or Atlanta metro
    let initialCenter = [-84.388, 33.749];
    const firstCoords = stops.map(getStopCoords).find(Boolean);
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

    const setupLayers = () => {
      // A. Sequence Route Source & Layers (Dashed Muted Electric Blue)
      if (!map.getSource('sequence-route-source')) {
        map.addSource('sequence-route-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: []
            }
          }
        });

        // Sequence Glow Casing
        map.addLayer({
          id: 'sequence-route-casing',
          type: 'line',
          source: 'sequence-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#0284c7',
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
            'line-width': 4,
            'line-dasharray': [3, 2],
            'line-opacity': 0.85
          }
        });
      }

      // B. Active Target Route Leg (Solid Neon Green with glowing casing)
      if (!map.getSource('active-route-source')) {
        map.addSource('active-route-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: []
            }
          }
        });

        // Active Glow Casing
        map.addLayer({
          id: 'active-route-casing',
          type: 'line',
          source: 'active-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#22c55e',
            'line-width': 10,
            'line-opacity': 0.4
          }
        });

        // Active Core Line
        map.addLayer({
          id: 'active-route',
          type: 'line',
          source: 'active-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#4ade80',
            'line-width': 5.5,
            'line-opacity': 1.0
          }
        });
      }

      // C. Driver GPS Location Source & WebGL Puck Layers
      if (!map.getSource('driver-location-source')) {
        map.addSource('driver-location-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: []
          }
        });

        // Driver Pulse Halo
        map.addLayer({
          id: 'driver-puck-halo',
          type: 'circle',
          source: 'driver-location-source',
          paint: {
            'circle-radius': 16,
            'circle-color': '#38bdf8',
            'circle-opacity': 0.3,
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

      // D. Stop Markers WebGL Source & Layers
      if (!map.getSource('stops-source')) {
        map.addSource('stops-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: []
          }
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
            'circle-opacity': 0.35,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#4ade80'
          }
        });

        // GPU Symbol Layer: numbered pins drawn directly in WebGL
        map.addLayer({
          id: 'stops-symbol-layer',
          type: 'symbol',
          source: 'stops-source',
          layout: {
            'icon-image': ['get', 'iconKey'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          }
        });

        // Immediate click interaction on GPU stop symbols
        map.on('click', 'stops-symbol-layer', (e) => {
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
        });

        map.on('mouseenter', 'stops-symbol-layer', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'stops-symbol-layer', () => {
          map.getCanvas().style.cursor = '';
        });
      }

      mapRef.current = map;
      setMapLoaded(true);
    };

    map.on('load', setupLayers);
    map.on('style.load', setupLayers);

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [activeRegion, nativePmtilesPath, offlineMode]);

  // Handle Fullscreen resize
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current.resize();
      }, 100);
    }
  }, [isFullscreen]);

  // 4. Update WebGL Stop Markers (Zero-Lag GPU Rendering)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const stopsSource = map.getSource('stops-source');
    if (!stopsSource) return;

    const features = [];
    stops.forEach((stop, idx) => {
      const coords = getStopCoords(stop);
      if (!coords) return;

      const stopNumber = idx + 1;
      const isCurrentActive = idx === activeIndex;
      const isDelivered = stop.status === 'delivered';
      const isSelected = idx === selectedStopIndex;
      const iconKey = `pin-${stopNumber}-${isDelivered ? 'd' : 'p'}-${isCurrentActive ? '1' : '0'}-${isSelected ? '1' : '0'}`;

      // Register canvas image in MapLibre's sprite registry if not already present
      if (!map.hasImage(iconKey)) {
        const imgData = createStopPinImageData(stopNumber, stop.status, isCurrentActive, isSelected);
        map.addImage(iconKey, imgData, { pixelRatio: 2 });
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: coords
        },
        properties: {
          stopIndex: idx,
          stopNumber: `${stopNumber}`,
          status: stop.status || 'pending',
          isActive: isCurrentActive,
          isSelected: isSelected,
          iconKey: iconKey
        }
      });
    });

    stopsSource.setData({
      type: 'FeatureCollection',
      features: features
    });
  }, [stops, activeIndex, selectedStopIndex, mapLoaded]);

  // 5. Update WebGL Driver GPS Puck
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const driverSource = map.getSource('driver-location-source');
    if (!driverSource) return;

    const dlLng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation?.longitude;
    const dlLat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation?.latitude;

    if (dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat)) {
      driverSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [dlLng, dlLat]
            }
          }
        ]
      });
    } else {
      driverSource.setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }, [driverLocation, mapLoaded]);

  // 6. Update Polylines: Sequence Route (Blue) & Active Route (Green)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // A. Sequence Line
    const validCoords = stops.map(getStopCoords).filter(Boolean);
    const seqSource = map.getSource('sequence-route-source');
    if (seqSource && validCoords.length > 1) {
      seqSource.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: validCoords
        }
      });
    }

    // B. Active Route Leg (Neon Green)
    const activeSource = map.getSource('active-route-source');
    if (activeSource) {
      let activeLineCoords = [];

      if (activeRouteCoordinates && activeRouteCoordinates.length > 1) {
        activeLineCoords = activeRouteCoordinates;
      } else {
        const targetStop = stops[activeIndex];
        const targetCoords = getStopCoords(targetStop);

        if (targetCoords) {
          let originCoords = null;
          const driverLng = Array.isArray(driverLocation) ? driverLocation[0] : driverLocation?.longitude;
          const driverLat = Array.isArray(driverLocation) ? driverLocation[1] : driverLocation?.latitude;
          if (driverLng != null && driverLat != null) {
            originCoords = [driverLng, driverLat];
          } else if (activeIndex > 0) {
            originCoords = getStopCoords(stops[activeIndex - 1]);
          } else if (stops.length > 1) {
            originCoords = getStopCoords(stops[0]);
          }

          if (originCoords) {
            activeLineCoords = [originCoords, targetCoords];
          }
        }
      }

      if (activeLineCoords.length > 1) {
        activeSource.setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: activeLineCoords
          }
        });
      }
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
            <span>Interactive Route Map ({stops.length} Stops)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setIsFullscreen(true)}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Maximize2 size={13} />
              <span>Full View</span>
            </button>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Target: #{activeIndex + 1}
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
              title={isNavigating ? 'Exit Navigation' : 'Exit Full View'}
            >
              <ChevronLeft size={18} />
              <span>{isNavigating ? 'Exit Nav' : 'Back'}</span>
            </button>
            <div className="map-legend-pill">
              <ShieldCheck size={13} />
              <span>{mapTheme === 'street' ? 'Vector Street' : 'Night Mode'}</span>
            </div>
          </div>
        )}

        {/* Legend pill for normal embedded view */}
        {!isFullscreen && (
          <div className="map-legend-pill">
            <ShieldCheck size={13} />
            <span>{mapTheme === 'street' ? 'Vector Street' : 'Night Mode'}</span>
          </div>
        )}

        {/* Unified Custom Map Controls (Notch Safe) */}
        <div className="maplibre-controls-overlay">
          <button
            className="map-control-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Full View' : 'Full Screen View'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            className="map-control-btn"
            onClick={handleToggleTheme}
            title={mapTheme === 'street' ? 'Switch to Night Mode' : 'Switch to Street View'}
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
                  Stop #{selectedStopIndex + 1} of {stops.length}
                </span>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', marginTop: '0.2rem' }}>
                  {selectedStop.address?.street || selectedStop.address?.raw || 'Stop Details'}
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
                  <span>PKG: {selectedStop.trackingNumber}</span>
                </div>
              )}
              {selectedStop.address?.gateCode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#38bdf8' }}>
                  <Key size={12} />
                  <span>Gate: #{selectedStop.address.gateCode}</span>
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
                  <span>Navigate Here</span>
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
                  <span>Next In Sequence</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
