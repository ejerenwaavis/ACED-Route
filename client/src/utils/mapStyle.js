/**
 * MapLibre GL style provider for ACED Route.
 * Provides high-definition, un-watermarked basemaps:
 * - Street view: ESRI World Street Map (crisp roads, highway links, street labels, 100% reliable)
 * - Night view: ESRI World Dark Gray Canvas
 * - Offline view: Local PMTiles vector layers
 *
 * @param {object} options
 * @param {string|null} options.pmtilesUrl - Resolved URL to the local or remote .pmtiles archive
 * @param {boolean} options.isOffline - Whether Airplane Mode / offline mode is active
 * @param {'street'|'dark'} options.theme - Visual style ('street' for day navigation, 'dark' for night)
 * @returns {object} Valid MapLibre Style Specification v8 object
 */
export function buildMapStyle({ pmtilesUrl = null, isOffline = false, theme = 'street' } = {}) {
  // If offline mode is enabled and PMTiles URL is available, use local vector tiles
  if (isOffline && pmtilesUrl) {
    return buildOfflineDarkStyle(pmtilesUrl);
  }

  // Night Mode: ESRI World Dark Gray Canvas
  if (theme === 'dark') {
    return {
      version: 8,
      name: 'ACED Route Night Dark',
      sources: {
        'esri-dark-base': {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors'
        },
        'esri-dark-ref': {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: ''
        }
      },
      layers: [
        {
          id: 'esri-dark-base-layer',
          type: 'raster',
          source: 'esri-dark-base',
          minzoom: 0,
          maxzoom: 20
        },
        {
          id: 'esri-dark-ref-layer',
          type: 'raster',
          source: 'esri-dark-ref',
          minzoom: 0,
          maxzoom: 20
        }
      ]
    };
  }

  // Street Mode: ESRI World Street Map (crisp daylight navigation, all roads & highway links)
  return {
    version: 8,
    name: 'ACED Route World Street',
    sources: {
      'esri-street': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: '© Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, METI, TomTom'
      }
    },
    layers: [
      {
        id: 'esri-street-layer',
        type: 'raster',
        source: 'esri-street',
        minzoom: 0,
        maxzoom: 20
      }
    ]
  };
}

/**
 * Offline vector style reading directly from the region's PMTiles vector archive.
 * Tuned with high-contrast road styling for clear visibility on OLED and mobile screens.
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
          'fill-color': '#0369a1'
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
          'line-color': '#475569',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 5],
          'line-opacity': 0.85
        }
      },
      {
        id: 'roads_medium',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['any', ['==', 'kind', 'medium'], ['==', 'kind', 'major']],
        paint: {
          'line-color': '#64748b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 7],
          'line-opacity': 0.95
        }
      },
      {
        id: 'roads_highway',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['==', 'kind', 'highway'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 16, 9],
          'line-opacity': 1.0
        }
      }
    ]
  };
}
