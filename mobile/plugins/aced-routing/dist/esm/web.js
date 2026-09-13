import { WebPlugin } from '@capacitor/core';

export class AcedRoutingWeb extends WebPlugin {
  async checkRegionAvailable(options) {
    console.warn(`[AcedRoutingWeb] checkRegionAvailable for "${options.region}": offline routing unavailable in browser.`);
    return { available: false, sizeMB: 0 };
  }
  async downloadRegionData(options) {
    throw this.unavailable('offline routing unavailable in browser — this plugin only runs inside the native shell');
  }
  async deleteRegionData(options) {
    return { success: false };
  }
  async calculateRoute(options) {
    throw this.unavailable('offline routing unavailable in browser — this plugin only runs inside the native shell');
  }
}
