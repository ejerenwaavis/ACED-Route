/**
 * MapLibre GL vector style provider for ACED Route.
 * Uses OpenFreeMap vector basemaps (100% free, zero API keys, zero watermarks) when online,
 * and offline PMTiles vector layers when offline.
 *
 * @param {object} options
 * @param {string|null} options.pmtilesUrl - Resolved URL to the local or remote .pmtiles archive
 * @param {boolean} options.isOffline - Whether Airplane Mode / offline mode is active
 * @param {'street'|'dark'} options.theme - Visual style ('street' for high-contrast day navigation, 'dark' for night)
 * @returns {string|object} Valid MapLibre Style Specification v8 object or URL
 */
export function buildMapStyle({ pmtilesUrl = null, isOffline = false, theme = 'street' } = {}) {
  // If offline mode is enabled and PMTiles URL is available, use local vector tiles
  if (isOffline && pmtilesUrl) {
    return buildOfflineDarkStyle(pmtilesUrl);
  }

  // OpenFreeMap styles: 100% free vector tiles, zero watermarks, crisp roads and highway links
  if (theme === 'dark') {
    return 'https://tiles.openfreemap.org/styles/dark';
  }

  // Default: OpenFreeMap Liberty (clean daytime street navigation with distinct highway colors and street labels)
  return 'https://tiles.openfreemap.org/styles/liberty';
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
