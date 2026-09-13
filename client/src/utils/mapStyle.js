/**
 * Self-hosted, 100% offline MapLibre GL vector style generator.
 * Styled specifically for ACED Route's dark theme palette with zero external tile dependencies.
 * Reads directly from the region's PMTiles vector archive.
 *
 * @param {string} pmtilesUrl - Resolved URL to the .pmtiles archive (converted file src or local route)
 * @returns {object} Valid MapLibre Style Specification v8 object
 */
export function buildOfflineDarkStyle(pmtilesUrl) {
  return {
    version: 8,
    name: 'ACED Route Dark Offline',
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      // 1. Canvas Background
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#0f172a'
        }
      },
      // 2. Earth / Landcover
      {
        id: 'earth',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'earth',
        paint: {
          'fill-color': '#131d31'
        }
      },
      // 3. Landuse / Parks / Commercial
      {
        id: 'landuse',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'landuse',
        paint: {
          'fill-color': '#162238',
          'fill-opacity': 0.7
        }
      },
      // 4. Natural / Parks / Greenery
      {
        id: 'natural',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'natural',
        paint: {
          'fill-color': '#142a27',
          'fill-opacity': 0.6
        }
      },
      // 5. Water bodies & rivers
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: {
          'fill-color': '#0c4a6e'
        }
      },
      // 6. Buildings footprint
      {
        id: 'buildings',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'buildings',
        minzoom: 13,
        paint: {
          'fill-color': '#1e293b',
          'fill-outline-color': '#334155'
        }
      },
      // 7. Roads — Minor / Residential
      {
        id: 'roads_minor',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['any', ['==', 'kind', 'minor'], ['==', 'kind', 'service']],
        paint: {
          'line-color': '#1e293b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 4]
        }
      },
      // 8. Roads — Medium / Primary / Secondary
      {
        id: 'roads_medium',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['any', ['==', 'kind', 'medium'], ['==', 'kind', 'major']],
        paint: {
          'line-color': '#334155',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 16, 6]
        }
      },
      // 9. Roads — Highway / Motorway
      {
        id: 'roads_highway',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: {
          'line-color': '#475569',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 16, 8]
        }
      },
      // 10. Boundaries / State / County lines
      {
        id: 'boundaries',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'boundaries',
        paint: {
          'line-color': '#64748b',
          'line-dasharray': [2, 2],
          'line-width': 1,
          'line-opacity': 0.6
        }
      }
    ]
  };
}
