import { AcedRouting } from 'aced-routing';
import { Network } from '@capacitor/network';
import { getLanguage } from '../utils/i18n';

const ACTIVE_REGION_KEY = 'aced_active_region';

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
   * Runs local 100% offline routing calculation.
   * Input start: [lat, lng]
   * Input end: [lat, lng]
   * Input waypoints: [[lat, lng], ...]
   * Returns coordinates as [lng, lat] GeoJSON array and turn-by-turn maneuver steps.
   */
  async calculateRoute(start, end, waypoints = []) {
    return await AcedRouting.calculateRoute({
      start,
      end,
      waypoints
    });
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
