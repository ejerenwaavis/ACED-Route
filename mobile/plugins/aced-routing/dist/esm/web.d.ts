import { WebPlugin } from '@capacitor/core';
import type { AcedRoutingPlugin, CheckRegionOptions, CheckRegionResult, DownloadRegionOptions, DownloadRegionResult, DeleteRegionOptions, DeleteRegionResult, CalculateRouteOptions, CalculateRouteResult, SpeakOptions } from './definitions';
export declare class AcedRoutingWeb extends WebPlugin implements AcedRoutingPlugin {
    private watchId;
    checkRegionAvailable(options: CheckRegionOptions): Promise<CheckRegionResult>;
    downloadRegionData(options: DownloadRegionOptions): Promise<DownloadRegionResult>;
    deleteRegionData(options: DeleteRegionOptions): Promise<DeleteRegionResult>;
    calculateRoute(options: CalculateRouteOptions): Promise<CalculateRouteResult>;
    startNavigationTracking(): Promise<void>;
    stopNavigationTracking(): Promise<void>;
    speak(options: SpeakOptions): Promise<void>;
    stopSpeech(): Promise<void>;
}
//# sourceMappingURL=web.d.ts.map