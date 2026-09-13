'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

const core = require('@capacitor/core');

class AcedRoutingWeb extends core.WebPlugin {
  async checkRegionAvailable(options) {
    console.warn(`[AcedRoutingWeb] checkRegionAvailable for "${options.region}": offline routing is unavailable in browser environment.`);
    return { available: false, sizeMB: 0 };
  }

  async downloadRegionData(options) {
    throw this.unavailable(
      'offline routing unavailable in browser — this plugin only runs inside the native shell'
    );
  }

  async deleteRegionData(options) {
    console.warn(`[AcedRoutingWeb] deleteRegionData for "${options.regionName}": no-op in browser.`);
    return { success: false };
  }

  async calculateRoute(options) {
    throw this.unavailable(
      'offline routing unavailable in browser — this plugin only runs inside the native shell'
    );
  }
}

const AcedRouting = core.registerPlugin('AcedRouting', {
  web: () => Promise.resolve(new AcedRoutingWeb()),
});

exports.AcedRouting = AcedRouting;
exports.AcedRoutingWeb = AcedRoutingWeb;
