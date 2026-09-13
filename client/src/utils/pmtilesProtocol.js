import * as pmtiles from 'pmtiles';
import { addProtocol } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';

let isRegistered = false;
let protocolInstance = null;

/**
 * Ensures the PMTiles protocol is registered with MapLibre GL exactly once.
 */
export function registerPMTilesProtocol() {
  if (!isRegistered) {
    protocolInstance = new pmtiles.Protocol();
    addProtocol('pmtiles', protocolInstance.tile);
    isRegistered = true;
  }
  return protocolInstance;
}

/**
 * Resolves a local device or network PMTiles URL for MapLibre GL.
 * Converts native on-device file paths to WebView-accessible URLs via Capacitor.convertFileSrc().
 *
 * @param {string} regionId - Regional identifier (e.g. 'us-ga-metro', 'sample-metro')
 * @param {string|null} nativePath - Native filesystem path returned by the Capacitor plugin
 * @param {string|null} fallbackUrl - Optional server-hosted PMTiles URL
 * @returns {string} Fully-qualified URL ready for pmtiles:// protocol
 */
export function resolvePmtilesUrl(regionId, nativePath = null, fallbackUrl = null) {
  if (Capacitor.isNativePlatform() && nativePath) {
    // Crucial: Raw file:// paths fail range requests in Capacitor WebViews; convert to safe origin URL
    return Capacitor.convertFileSrc(nativePath);
  }

  if (fallbackUrl) {
    return fallbackUrl;
  }

  const base = window.location.origin;
  return `${base}/regions/${regionId || 'sample-metro'}/basemap.pmtiles`;
}
