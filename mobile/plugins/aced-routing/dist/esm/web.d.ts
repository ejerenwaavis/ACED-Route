import { WebPlugin } from '@capacitor/core';
import type { AcedRoutingPlugin, CheckRegionOptions, CheckRegionResult, DownloadRegionOptions, DownloadRegionResult, DeleteRegionOptions, DeleteRegionResult, CalculateRouteOptions, CalculateRouteResult } from './definitions';
export declare class AcedRoutingWeb extends WebPlugin implements AcedRoutingPlugin {
    checkRegionAvailable(options: CheckRegionOptions): Promise<CheckRegionResult>;
    downloadRegionData(options: DownloadRegionOptions): Promise<DownloadRegionResult>;
    deleteRegionData(options: DeleteRegionOptions): Promise<DeleteRegionResult>;
    calculateRoute(options: CalculateRouteOptions): Promise<CalculateRouteResult>;
}
//# sourceMappingURL=web.d.ts.map