import { AcedRouting } from 'aced-routing';
import { Network } from '@capacitor/network';
import { getLanguage } from '../utils/i18n';
import { api } from './api';
import { diagnosticLogger } from './diagnosticLogger';

const ACTIVE_REGION_KEY = 'aced_active_region';
const DB_NAME = 'aced_routing_db';
const DB_VERSION = 2;
const STORE_NAME = 'geometry_cache';

function openRouteDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('system_logs')) {
          db.createObjectStore('system_logs', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedGeometry(key) {
  try {
    const db = await openRouteDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedGeometry(key, data) {
  try {
    const db = await openRouteDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id: key, data, updatedAt: Date.now() });
  } catch (_) {}
}

export function toLngLatPair(pt) {
  if (!pt || pt.length < 2) return null;
  let a = Number(pt[0]), b = Number(pt[1]);
  if (isNaN(a) || isNaN(b)) return null;
  // If a is latitude (positive 20..70 in US) and b is longitude (negative -130..-60 in US)
  if (a > 0 && b < 0) return [b, a];
  return [a, b]; // Standard [lng, lat]
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * High-level offline routing, TTS voice guidance, and regional basemap management service.
 */
export const routingService = {
  /**
   * Returns whether current device connection is Wi-Fi via native Android/iOS Network plugin.
   * Accurately prevents false cellular warnings.
   */
  async isWifiConnection() {
    try {
      const status = await Network.getStatus();
      if (status && status.connectionType) {
        return status.connectionType === 'wifi';
      }
    } catch {
      // Fallback
    }

    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const conn = navigator.connection;
      if (conn && conn.type) {
        return conn.type === 'wifi';
      }
    }
    return true;
  },

  /**
   * Checks local storage/native disk for installed Valhalla routing tiles and PMTiles basemap.
   */
  async checkRegion(regionId) {
    try {
      return await AcedRouting.checkRegionAvailable({ region: regionId });
    } catch (err) {
      console.warn(`[routingService] checkRegion failed for ${regionId}:`, err);
      return { available: false, sizeMB: 0 };
    }
  },

  /**
   * Downloads and installs a region's Valhalla tiles bundle (.zip) AND .pmtiles visual basemap.
   */
  async downloadRegion(region) {
    const regionId = region.id || region.regionName;
    const bundleUrl = region.routing?.bundleUrl || region.bundleUrl;
    const pmtilesUrl = region.basemap?.pmtilesUrl || region.pmtilesUrl;

    const res = await AcedRouting.downloadRegionData({
      bundleUrl,
      pmtilesUrl,
      regionName: regionId
    });

    if (res.success) {
      localStorage.setItem(ACTIVE_REGION_KEY, regionId);
    }
    return res;
  },

  /**
   * Deletes a local region's tiles and basemap.
   */
  async deleteRegion(regionId) {
    const res = await AcedRouting.deleteRegionData({ regionName: regionId });
    if (localStorage.getItem(ACTIVE_REGION_KEY) === regionId) {
      localStorage.removeItem(ACTIVE_REGION_KEY);
    }
    return res;
  },

  /**
   * Calculates active route leg (driver vehicle to target stop).
   * 1. Calls Valhalla proxy on server.
   * 2. On broad failure (offline, timeout, 500), checks IndexedDB geometry cache.
   * 3. On cache miss under failure, returns [start, end] with isRoadSnapped: false (NO straight-line interpolation).
   */
  async calculateRoute(start, end) {
    const startLL = toLngLatPair(start);
    const endLL = toLngLatPair(end);
    if (!startLL || !endLL) {
      return { coordinates: [], isRoadSnapped: false };
    }

    const cacheKey = `act_${startLL[0].toFixed(4)},${startLL[1].toFixed(4)}_${endLL[0].toFixed(4)},${endLL[1].toFixed(4)}`;
    const startTime = Date.now();

    // 1. Attempt Valhalla server call
    try {
      const res = await api.calculateActiveRoute(startLL, endLL);
      const durationMs = Date.now() - startTime;
      if (res && res.coordinates && res.coordinates.length > 0) {
        const payload = {
          coordinates: res.coordinates,
          distanceMeters: res.distanceMeters,
          durationSeconds: res.durationSeconds,
          instructions: res.instructions || [],
          isRoadSnapped: true
        };
        await setCachedGeometry(cacheKey, payload);
        diagnosticLogger.logRoutingEvent({
          endpoint: '/api/route/active',
          status: 200,
          level: 'success',
          summary: `✅ /api/route/active succeeded: HTTP 200 (${res.coordinates.length} coords, ${res.distanceMeters || 0}m) in ${durationMs}ms`,
          isRoadSnapped: true,
          cacheHit: false,
          durationMs,
          details: { coordsCount: res.coordinates.length, start: startLL, end: endLL }
        });
        return payload;
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const status = err.status || (err.message && err.message.includes('Failed to fetch') ? 'offline' : 'ERR');
      diagnosticLogger.logRoutingEvent({
        endpoint: '/api/route/active',
        status,
        level: 'warn',
        summary: `❌ /api/route/active failed: HTTP ${status} (${err.message || 'unknown'}) → checking cache`,
        isRoadSnapped: false,
        cacheHit: false,
        durationMs,
        details: { error: err.message, status, start: startLL, end: endLL }
      });
    }

    // 2. Broad failure handling: Check IndexedDB cache
    const cached = await getCachedGeometry(cacheKey);
    if (cached && cached.coordinates && cached.coordinates.length > 0) {
      diagnosticLogger.logRoutingEvent({
        endpoint: '/api/route/active',
        status: 'CACHE',
        level: 'info',
        summary: `💾 /api/route/active cache hit: IndexedDB (${cached.coordinates.length} coords) → road-snapped line`,
        isRoadSnapped: true,
        cacheHit: true,
        details: { coordsCount: cached.coordinates.length, cacheKey }
      });
      return { ...cached, isRoadSnapped: true };
    }

    // 3. Cache miss under failure: Return raw endpoints with isRoadSnapped: false
    const distMeters = haversineMeters(startLL[1], startLL[0], endLL[1], endLL[0]);
    diagnosticLogger.logRoutingEvent({
      endpoint: '/api/route/active',
      status: 'FALLBACK',
      level: 'warn',
      summary: `⚠️ /api/route/active fallback: Cache miss → dot trail (${Math.round(distMeters)}m approximate)`,
      isRoadSnapped: false,
      cacheHit: false,
      details: { start: startLL, end: endLL, distanceMeters: Math.round(distMeters) }
    });
    return {
      coordinates: [startLL, endLL],
      distanceMeters: Math.round(distMeters),
      durationSeconds: Math.round(distMeters / 11.1),
      instructions: [
        {
          instruction: 'Head toward destination (Approximate Direction Only)',
          streetNames: [],
          distanceMeters: Math.round(distMeters),
          timeSeconds: Math.round(distMeters / 11.1),
          type: 1
        }
      ],
      isRoadSnapped: false
    };
  },

  /**
   * Solves full manifest stop sequence in ONE continuous multi-waypoint Valhalla request.
   * 1. Calls Valhalla proxy on server.
   * 2. On failure, checks IndexedDB cache.
   * 3. On cache miss, returns raw stops with isRoadSnapped: false.
   */
  async calculateSequenceRoute(stops) {
    if (!Array.isArray(stops) || stops.length < 2) {
      return { coordinates: [], isRoadSnapped: false };
    }
    const validCoords = stops.map(toLngLatPair).filter(Boolean);
    if (validCoords.length < 2) {
      return { coordinates: [], isRoadSnapped: false };
    }

    const cacheKey = `seq_${validCoords.length}_` + validCoords.slice(0, 5).map(c => `${c[0].toFixed(3)},${c[1].toFixed(3)}`).join('_');
    const startTime = Date.now();

    // 1. Attempt Valhalla multi-waypoint sequence solve
    try {
      const res = await api.calculateSequenceRoute(validCoords);
      const durationMs = Date.now() - startTime;
      if (res && res.coordinates && res.coordinates.length > 0) {
        const payload = {
          coordinates: res.coordinates,
          distanceMeters: res.distanceMeters,
          durationSeconds: res.durationSeconds,
          isRoadSnapped: true
        };
        await setCachedGeometry(cacheKey, payload);
        diagnosticLogger.logRoutingEvent({
          endpoint: '/api/route/sequence',
          status: 200,
          level: 'success',
          summary: `✅ /api/route/sequence succeeded: HTTP 200 (${res.coordinates.length} coords, ${validCoords.length} stops) in ${durationMs}ms`,
          isRoadSnapped: true,
          cacheHit: false,
          durationMs,
          details: { coordsCount: res.coordinates.length, stopCount: validCoords.length }
        });
        return payload;
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const status = err.status || (err.message && err.message.includes('Failed to fetch') ? 'offline' : 'ERR');
      diagnosticLogger.logRoutingEvent({
        endpoint: '/api/route/sequence',
        status,
        level: 'warn',
        summary: `❌ /api/route/sequence failed: HTTP ${status} (${err.message || 'unknown'}) → checking cache`,
        isRoadSnapped: false,
        cacheHit: false,
        durationMs,
        details: { error: err.message, status, stopCount: validCoords.length }
      });
    }

    // 2. Check IndexedDB cache
    const cached = await getCachedGeometry(cacheKey);
    if (cached && cached.coordinates && cached.coordinates.length > 0) {
      diagnosticLogger.logRoutingEvent({
        endpoint: '/api/route/sequence',
        status: 'CACHE',
        level: 'info',
        summary: `💾 /api/route/sequence cache hit: IndexedDB (${cached.coordinates.length} coords) → road-snapped line`,
        isRoadSnapped: true,
        cacheHit: true,
        details: { coordsCount: cached.coordinates.length, cacheKey }
      });
      return { ...cached, isRoadSnapped: true };
    }

    // 3. Cache miss: Return raw stops with isRoadSnapped: false
    diagnosticLogger.logRoutingEvent({
      endpoint: '/api/route/sequence',
      status: 'FALLBACK',
      level: 'warn',
      summary: `⚠️ /api/route/sequence fallback: Cache miss → sequence dots (${validCoords.length} stops approximate)`,
      isRoadSnapped: false,
      cacheHit: false,
      details: { stopCount: validCoords.length }
    });
    return {
      coordinates: validCoords,
      isRoadSnapped: false
    };
  },

  /**
   * Starts persistent Android Foreground Service (with notification) & iOS background location.
   */
  async startNavigationTracking(options = {}) {
    try {
      if (typeof AcedRouting.startNavigationTracking === 'function') {
        return await AcedRouting.startNavigationTracking({
          title: options.title || 'ACED Route Navigation Active',
          text: options.text || 'Guiding to next stop'
        });
      }
    } catch (err) {
      console.warn('[routingService] startNavigationTracking notice:', err);
    }
    return { success: false };
  },

  /**
   * Stops persistent foreground tracking and dismisses navigation notification.
   */
  async stopNavigationTracking() {
    try {
      if (typeof AcedRouting.stopNavigationTracking === 'function') {
        return await AcedRouting.stopNavigationTracking();
      }
    } catch (err) {
      console.warn('[routingService] stopNavigationTracking notice:', err);
    }
    return { success: false };
  },

  /**
   * Speaks navigation instruction using native neural TTS (Android TextToSpeech / iOS AVSpeechSynthesizer)
   */
  async speak(text, options = {}) {
    if (!text || !text.trim()) return;
    const lang = options.lang || getLanguage();
    try {
      if (typeof AcedRouting.speak === 'function') {
        return await AcedRouting.speak({
          text,
          language: lang,
          lang,
          stopPrevious: options.stopPrevious !== false
        });
      }
    } catch (err) {
      console.warn('[routingService] native speak fallback to Web Speech:', err);
    }

    // Web Speech API fallback
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'es' ? 'es-US' : 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  },

  /**
   * Stops any currently speaking voice prompt.
   */
  async stopSpeech() {
    try {
      if (typeof AcedRouting.stopSpeech === 'function') {
        return await AcedRouting.stopSpeech();
      }
    } catch {
      // Ignore
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  },

  /**
   * Subscribes to location updates from the foreground tracking service.
   */
  addLocationListener(callback) {
    if (typeof AcedRouting.addListener === 'function') {
      return AcedRouting.addListener('locationUpdate', callback);
    }
    return { remove: () => {} };
  },

  getActiveRegion() {
    return localStorage.getItem(ACTIVE_REGION_KEY);
  },

  setActiveRegion(regionId) {
    localStorage.setItem(ACTIVE_REGION_KEY, regionId);
  }
};

export default routingService;
