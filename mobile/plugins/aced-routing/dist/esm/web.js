import { WebPlugin } from '@capacitor/core';
export class AcedRoutingWeb extends WebPlugin {
    async checkRegionAvailable(options) {
        console.warn(`[AcedRoutingWeb] checkRegionAvailable for "${options.region}": offline routing is unavailable in browser environment.`);
        return { available: false, sizeMB: 0 };
    }
    async downloadRegionData(options) {
        throw this.unavailable('offline routing unavailable in browser — this plugin only runs inside the native shell');
    }
    async deleteRegionData(options) {
        console.warn(`[AcedRoutingWeb] deleteRegionData for "${options.regionName}": no-op in browser.`);
        return { success: false };
    }
    async calculateRoute(options) {
        throw this.unavailable('offline routing unavailable in browser — this plugin only runs inside the native shell');
    }
}
