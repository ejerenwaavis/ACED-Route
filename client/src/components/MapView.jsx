import React, { useMemo } from 'react';
import { MapPin, Navigation, ExternalLink } from 'lucide-react';

export default function MapView({ stops = [], activeIndex = 0, onSelectStop }) {
  // Extract coordinate points
  const points = useMemo(() => {
    return stops.map((stop, idx) => {
      const coords = stop.address?.location?.coordinates || [-73.9851, 40.7488];
      // Note: GeoJSON stores [lng, lat]
      return {
        idx,
        lng: coords[0],
        lat: coords[1],
        street: stop.address?.street || stop.address?.raw || `Stop ${idx + 1}`,
        tracking: stop.trackingNumber,
        status: stop.status || (stop.completedAt ? 'delivered' : 'pending'),
        isActive: idx === activeIndex
      };
    });
  }, [stops, activeIndex]);

  // Calculate bounding box for SVG projection
  const { minLng, maxLng, minLat, maxLat } = useMemo(() => {
    if (!points.length) return { minLng: 0, maxLng: 1, minLat: 0, maxLat: 1 };
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    points.forEach((p) => {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });
    // Add margin
    const lngPad = Math.max((maxLng - minLng) * 0.15, 0.005);
    const latPad = Math.max((maxLat - minLat) * 0.15, 0.005);
    return {
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
      minLat: minLat - latPad,
      maxLat: maxLat + latPad
    };
  }, [points]);

  // Project lat/lng to SVG viewBox (width=400, height=220)
  const project = (lng, lat) => {
    const width = 400;
    const height = 220;
    const x = ((lng - minLng) / (maxLng - minLng || 1)) * width;
    // Invert Y because SVG coordinates increase downwards
    const y = height - ((lat - minLat) / (maxLat - minLat || 1)) * height;
    return [Math.max(25, Math.min(width - 25, x)), Math.max(25, Math.min(height - 25, y))];
  };

  // Generate Google Maps Directions URL for all stops
  const googleMapsDirectionsUrl = useMemo(() => {
    if (!stops.length) return '#';
    const validAddresses = stops
      .map((s) => s.address?.street || s.address?.raw)
      .filter(Boolean);
    if (!validAddresses.length) return '#';
    if (validAddresses.length === 1) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(validAddresses[0])}`;
    }
    const origin = encodeURIComponent(validAddresses[0]);
    const destination = encodeURIComponent(validAddresses[validAddresses.length - 1]);
    const waypoints = validAddresses.slice(1, -1).map(encodeURIComponent).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ''}`;
  }, [stops]);

  return (
    <div className="card" style={{ padding: '1rem', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>
          <Navigation size={16} color="#38bdf8" />
          <span>Route Overview ({stops.length} Stops)</span>
        </div>
        <a
          href={googleMapsDirectionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '0.75rem', gap: '0.35rem' }}
        >
          <span>Open Full Route</span>
          <ExternalLink size={12} />
        </a>
      </div>

      <div className="map-view-box">
        {points.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: '0.85rem' }}>No stops to display on map</div>
        ) : (
          <svg
            viewBox="0 0 400 220"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            {/* Background grid pattern */}
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#090d16" />
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Connecting Route Lines */}
            {points.map((p, i) => {
              if (i === 0) return null;
              const prev = points[i - 1];
              const [x1, y1] = project(prev.lng, prev.lat);
              const [x2, y2] = project(p.lng, p.lat);
              const isDelivered = prev.status === 'delivered' && p.status === 'delivered';
              return (
                <line
                  key={`line-${i}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isDelivered ? '#16a34a' : '#38bdf8'}
                  strokeWidth="2.5"
                  strokeDasharray={isDelivered ? 'none' : '4,4'}
                  opacity={isDelivered ? 0.6 : 0.8}
                />
              );
            })}

            {/* Stop Markers */}
            {points.map((p) => {
              const [cx, cy] = project(p.lng, p.lat);
              const isCurrent = p.isActive;
              const isDelivered = p.status === 'delivered';

              return (
                <g
                  key={`marker-${p.idx}`}
                  onClick={() => onSelectStop && onSelectStop(p.idx)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Highlight ring for active stop */}
                  {isCurrent && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r="16"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="2"
                      opacity="0.8"
                    >
                      <animate
                        attributeName="r"
                        values="14;20;14"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}

                  {/* Base pin */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isCurrent ? 12 : 10}
                    fill={isDelivered ? '#16a34a' : isCurrent ? '#38bdf8' : '#1e293b'}
                    stroke={isDelivered ? '#22c55e' : isCurrent ? '#fff' : '#64748b'}
                    strokeWidth="2"
                  />

                  {/* Stop sequence number */}
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fontSize={isCurrent ? '10' : '9'}
                    fontWeight="700"
                    fill={isDelivered || isCurrent ? '#0f172a' : '#fff'}
                  >
                    {p.idx + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }}></span> Current Active
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }}></span> Completed
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#334155', border: '1px solid #64748b', display: 'inline-block' }}></span> Pending
        </span>
      </div>
    </div>
  );
}
