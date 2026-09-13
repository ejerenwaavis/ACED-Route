import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Navigation,
  Crosshair,
  Maximize2,
  X,
  Key,
  Tag,
  CheckCircle2,
  Compass,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { registerPMTilesProtocol, resolvePmtilesUrl } from '../utils/pmtilesProtocol';
import { buildOfflineDarkStyle } from '../utils/mapStyle';
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
  const [nativePmtilesPath, setNativePmtilesPath] = useState(null);

  const activeRegion = regionId || routingService.getActiveRegion() || 'sample-metro';

  // Helper to extract valid [lng, lat] from a stop
  const getStopCoords = (stop) => {
    if (!stop) return null;
    const coords = stop.address?.location?.coordinates || stop.coordinates;
    if (coords && coords.length >= 2) {
      // Mongo GeoJSON convention is [lng, lat]
      return [coords[0], coords[1]];
    }
    return null;
  };

  // 1. Fetch native PMTiles path on mount
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

    // Register the pmtiles:// protocol with MapLibre
    registerPMTilesProtocol();

    const pmtilesUrl = resolvePmtilesUrl(activeRegion, nativePmtilesPath);
    const styleObj = buildOfflineDarkStyle(pmtilesUrl);

    // Initial center point
    let initialCenter = [-84.388, 33.749]; // Atlanta default
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

    map.on('load', () => {
      // 1. Sequence Route (Dashed Muted Blue)
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

      map.addLayer({
        id: 'sequence-route',
        type: 'line',
        source: 'sequence-route-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 4,
          'line-dasharray': [2, 2],
          'line-opacity': 0.7
        }
      });

      // 2. Active Route Leg (Solid Neon Green)
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

      map.addLayer({
        id: 'active-route',
        type: 'line',
        source: 'active-route-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#22c55e',
          'line-width': 6,
          'line-opacity': 0.95
        }
      });

      mapRef.current = map;
      setMapLoaded(true);
    });

    return () => {
      // Cleanup markers & map instance
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [activeRegion, nativePmtilesPath]);

  // 3. Update Stop Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    stops.forEach((stop, idx) => {
      const coords = getStopCoords(stop);
      if (!coords) return;

      const isCurrentActive = idx === activeIndex;
      const isDelivered = stop.status === 'delivered';
      const isSelected = idx === selectedStopIndex;

      // Custom HTML Marker element
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
      // Convention: GeoJSON lng, lat
      const lngLat = [driverLocation[0], driverLocation[1]];

      if (!driverMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.borderRadius = '50%';
        el.style.background = '#38bdf8';
        el.style.border = '3px solid #ffffff';
        el.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.8)';

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

    // A. Update Sequence Line (all pending/ordered stops)
    const validCoords = stops.map(getStopCoords).filter(Boolean);
    const seqSource = map.getSource('sequence-route-source');
    if (seqSource) {
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
        // Valhalla routing calculation provided
        activeLineCoords = activeRouteCoordinates;
      } else {
        // Fallback: Line from current position / previous stop to active stop
        const targetStop = stops[activeIndex];
        const targetCoords = getStopCoords(targetStop);

        if (targetCoords) {
          let originCoords = null;
          if (driverLocation && driverLocation.length >= 2) {
            originCoords = [driverLocation[0], driverLocation[1]];
          } else if (activeIndex > 0) {
            originCoords = getStopCoords(stops[activeIndex - 1]);
          }

          if (originCoords) {
            activeLineCoords = [originCoords, targetCoords];
          }
        }
      }

      activeSource.setData({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: activeLineCoords
        }
      });
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
      padding: { top: 40, bottom: 60, left: 40, right: 40 },
      maxZoom: 16,
      duration: 800
    });
  }, [stops, driverLocation]);

  // Frame stops on initial load
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
    <div className="card" style={{ padding: '0.75rem', position: 'relative', marginBottom: '1rem' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.85rem' }}>
          <Navigation size={15} color="#38bdf8" />
          <span>Interactive Route Map ({stops.length} Stops)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Active: #{activeIndex + 1}
          </span>
        </div>
      </div>

      {/* MapLibre Canvas Container */}
      <div className="maplibre-wrapper">
        <div ref={mapContainerRef} className="maplibre-canvas-container" />

        {/* Legend pill */}
        <div className="map-legend-pill">
          <ShieldCheck size={12} />
          <span>100% Offline Basemap</span>
        </div>

        {/* Custom Map Controls */}
        <div className="maplibre-controls-overlay">
          <button
            className="map-control-btn"
            onClick={fitMapToBounds}
            title="Fit All Stops in View"
          >
            <Maximize2 size={16} />
          </button>
          <button
            className="map-control-btn"
            onClick={handleCenterActiveStop}
            title="Recenter to Active Stop"
          >
            <Crosshair size={16} />
          </button>
        </div>

        {/* Interactive Bottom Sheet for Selected Stop */}
        {selectedStop && (
          <div className="map-bottom-sheet">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
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
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.2rem' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Extra stop meta */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
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
