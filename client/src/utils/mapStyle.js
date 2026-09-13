/**
 * Self-hosted MapLibre GL vector & raster dark theme style generator.
 * Provides CARTO Dark Matter HD Retina tiles when online, and offline PMTiles vector layers when offline.
 *
 * @param {object} options
 * @param {string|null} options.pmtilesUrl - Resolved URL to the local or remote .pmtiles archive
 * @param {boolean} options.isOffline - Whether Airplane Mode / offline mode is active
 * @returns {object} Valid MapLibre Style Specification v8 object
 */
export function buildMapStyle({ pmtilesUrl = null, isOffline = false } = {}) {
  // If offline mode is enabled and PMTiles URL is available, use local vector tiles
  if (isOffline && pmtilesUrl) {
    return buildOfflineDarkStyle(pmtilesUrl);
  }

  // Premium High-Definition Dark Basemap (CARTO Dark Matter Retina @2x)
  // 100% free, no API key, crisp street names, avenue labels, highway links, water, and building blocks
  return {
    version: 8,
    name: 'ACED Route HD Dark',
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          'https://d.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors, © CARTO'
      }
    },
    layers: [
      {
        id: 'carto-dark-layer',
        type: 'raster',
        source: 'carto-dark',
        minzoom: 0,
        maxzoom: 20
      }
    ]
  };
}

/**
 * Offline vector style reading directly from the region's PMTiles vector archive.
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
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#0f172a'
        }
      },
      {
        id: 'earth',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'earth',
        paint: {
          'fill-color': '#131d31'
        }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: {
          'fill-color': '#0c4a6e'
        }
      },
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
      {
        id: 'roads_minor',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['any', ['==', 'kind', 'minor'], ['==', 'kind', 'service']],
        paint: {
          'line-color': '#283548',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 4]
        }
      },
      {
        id: 'roads_medium',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['any', ['==', 'kind', 'medium'], ['==', 'kind', 'major']],
        paint: {
          'line-color': '#3b4d66',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 6]
        }
      },
      {
        id: 'roads_highway',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: {
          'line-color': '#475569',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 16, 8]
        }
      }
    ]
  };
}
