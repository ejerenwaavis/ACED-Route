import { AcedRouting } from 'aced-routing';

const ACTIVE_REGION_KEY = 'aced_active_region';

/**
 * High-level offline routing and regional basemap management service.
 */
export const routingService = {
  /**
   * Returns whether current device connection is Wi-Fi.
   */
  isWifiConnection() {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const conn = navigator.connection;
      if (conn && conn.type) {
        return conn.type === 'wifi';
      }
    }
    // Default to true/permitted if connection API not supported in WebView
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
   * Returns coordinates as [lng, lat] GeoJSON array.
   */
  async calculateRoute(start, end, waypoints = []) {
    return await AcedRouting.calculateRoute({
      start,
      end,
      waypoints
    });
  },

  getActiveRegion() {
    return localStorage.getItem(ACTIVE_REGION_KEY);
  },

  setActiveRegion(regionId) {
    localStorage.setItem(ACTIVE_REGION_KEY, regionId);
  }
};
