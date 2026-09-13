import { WebPlugin } from '@capacitor/core';
import type {
  AcedRoutingPlugin,
  CheckRegionOptions,
  CheckRegionResult,
  DownloadRegionOptions,
  DownloadRegionResult,
  DeleteRegionOptions,
  DeleteRegionResult,
  CalculateRouteOptions,
  CalculateRouteResult,
} from './definitions';

export class AcedRoutingWeb extends WebPlugin implements AcedRoutingPlugin {
  async checkRegionAvailable(options: CheckRegionOptions): Promise<CheckRegionResult> {
    console.warn(
      `[AcedRoutingWeb] checkRegionAvailable for "${options.region}": offline routing is unavailable in browser environment.`
    );
    return { available: false, sizeMB: 0 };
  }

  async downloadRegionData(options: DownloadRegionOptions): Promise<DownloadRegionResult> {
    throw this.unavailable(
      'offline routing unavailable in browser — this plugin only runs inside the native shell'
    );
  }

  async deleteRegionData(options: DeleteRegionOptions): Promise<DeleteRegionResult> {
    console.warn(
      `[AcedRoutingWeb] deleteRegionData for "${options.regionName}": no-op in browser.`
    );
    return { success: false };
  }

 async calculateRoute(options: CalculateRouteOptions): Promise<CalculateRouteResult> {
 throw this.unavailable(
 'offline routing unavailable in browser — this plugin only runs inside the native shell'
 );
 }
}
