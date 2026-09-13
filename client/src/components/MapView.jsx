import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Navigation,
  Crosshair,
  Maximize2,
  Minimize2,
  X,
  Key,
  Tag,
  CheckCircle2,
  Compass,
  ArrowRight,
  ShieldCheck,
  Layers
} from 'lucide-react';
import { registerPMTilesProtocol, resolvePmtilesUrl } from '../utils/pmtilesProtocol';
import { buildMapStyle } from '../utils/mapStyle';
import { routingService } from '../services/routing';

export default function MapView({
  stops = [],
  activeIndex = 0,
  activeRouteCoordinates = null,
  driverLocation = null,
  onSelectStop,
  onNavigateHere,
  onNavigateInSequence,
  regionId = null
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const driverMarkerRef = useRef(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nativePmtilesPath, setNativePmtilesPath] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);

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

  // 2. Initialize MapLibre GL instance
  useEffect(() => {
    if (!mapContainerRef.current) return;

    registerPMTilesProtocol();

    const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
    const styleObj = buildMapStyle({ pmtilesUrl, isOffline: offlineMode });

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

    map.addControl(new NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

    const setupLayers = () => {
      // Sequence Route Source & Layers (Dashed Muted Electric Blue)
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

      // Active Target Route Leg (Solid Neon Green with glowing casing)
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

      mapRef.current = map;
      setMapLoaded(true);
    };

    map.on('load', setupLayers);
    map.on('style.load', setupLayers);

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
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

  // 3. Update Stop HTML Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    stops.forEach((stop, idx) => {
      const coords = getStopCoords(stop);
      if (!coords) return;

      const isCurrentActive = idx === activeIndex;
      const isDelivered = stop.status === 'delivered';
      const isSelected = idx === selectedStopIndex;

      const el = document.createElement('div');
      el.className = `stop-marker-pin ${isCurrentActive ? 'stop-marker-active' : ''} ${
        isDelivered ? 'stop-marker-delivered' : ''
      } ${isSelected ? 'stop-marker-selected' : ''}`;
      el.innerText = `${idx + 1}`;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedStop(stop);
        setSelectedStopIndex(idx);
        map.flyTo({ center: coords, zoom: 15.5, essential: true });
        if (onSelectStop) onSelectStop(idx);
      });

      const marker = new Marker({ element: el })
        .setLngLat(coords)
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [stops, activeIndex, selectedStopIndex, mapLoaded]);

  // 4. Update Driver GPS Puck Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (driverLocation && driverLocation.length >= 2) {
      const lngLat = [driverLocation[0], driverLocation[1]];

      if (!driverMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '22px';
        el.style.height = '22px';
        el.style.borderRadius = '50%';
        el.style.background = '#38bdf8';
        el.style.border = '3px solid #ffffff';
        el.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.9)';

        driverMarkerRef.current = new Marker({ element: el })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat(lngLat);
      }
    } else if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }
  }, [driverLocation, mapLoaded]);

  // 5. Update Polylines: Sequence Route (Blue) & Active Route (Green)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // A. Update Sequence Line (connects all ordered stops)
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

    // B. Update Active Route Line (Neon Green)
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
          if (driverLocation && driverLocation.length >= 2) {
            originCoords = [driverLocation[0], driverLocation[1]];
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

  // 6. Camera Auto-framing
  const fitMapToBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const validCoords = stops.map(getStopCoords).filter(Boolean);
    if (!validCoords.length) return;

    const bounds = new LngLatBounds();
    validCoords.forEach((c) => bounds.extend(c));
    if (driverLocation) bounds.extend(driverLocation);

    map.fitBounds(bounds, {
      padding: { top: 50, bottom: 80, left: 50, right: 50 },
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

        {/* Legend pill */}
        <div className="map-legend-pill">
          <ShieldCheck size={13} />
          <span>HD Dark Basemap</span>
        </div>

        {/* Custom Map Controls */}
        <div className="maplibre-controls-overlay">
          <button
            className="map-control-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Full Screen View'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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
