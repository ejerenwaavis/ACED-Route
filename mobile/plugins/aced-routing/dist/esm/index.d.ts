/**
 * ACED Route — Offline Valhalla Routing Capacitor Plugin Definitions
 *
 * NOTE ON COORDINATE CONVENTIONS:
 * - Routing input coordinates (start, end, waypoints) are provided as [latitude, longitude].
 * - Returned route coordinates (coordinates) are strictly provided as [longitude, latitude] pairs
 *   to conform directly with standard GeoJSON and MapLibre GL source geometry conventions.
 */

export interface StepInstruction {
  /**
   * Spoken / visual turn instruction (e.g. " Turn left onto Main Street\).
 */
 instruction: string;
 /**
 * Street names associated with this maneuver leg.
 */
 streetNames?: string[];
 /**
 * Distance in meters for this maneuver step.
 */
 distanceMeters: number;
 /**
 * Estimated duration in seconds for this maneuver step.
 */
 timeSeconds: number;
 /**
 * Valhalla maneuver type indicator (e.g. 1=Start, 2=Right, 3=Left, etc.).
 */
 type: number;
}

export interface CheckRegionOptions {
 /**
 * Unique name of the region (e.g. \us-northeast\, \new-york\).
 */
 region: string;
}

export interface CheckRegionResult {
 /**
 * True if the Valhalla routing tile directory and metadata exist locally.
 */
 available: boolean;
 /**
 * Total disk size in megabytes occupied by this region bundle.
 */
 sizeMB: number;
}

export interface DownloadRegionOptions {
 /**
 * Remote URL to the pre-built region bundle archive (.tar.zst or .zip).
 */
 bundleUrl: string;
 /**
 * Unique name of the region to store locally.
 */
 regionName: string;
}

export interface DownloadRegionResult {
 /**
 * True if the bundle was downloaded and extracted to the local tiles directory.
 */
 success: boolean;
}

export interface DeleteRegionOptions {
 /**
 * Unique name of the region to purge from local storage.
 */
 regionName: string;
}

export interface DeleteRegionResult {
 /**
 * True if local tile bundle was successfully removed.
 */
 success: boolean;
}

export interface CalculateRouteOptions {
 /**
 * Departure coordinate as [latitude, longitude].
 */
 start: [number, number];
 /**
 * Destination coordinate as [latitude, longitude].
 */
 end: [number, number];
 /**
 * Optional intermediate stop waypoints, each as [latitude, longitude].
 */
 waypoints?: [number, number][];
}

export interface CalculateRouteResult {
 /**
 * Array of coordinates as [longitude, latitude] pairs (GeoJSON / MapLibre convention).
 */
 coordinates: [number, number][];
 /**
 * Total distance along the calculated road network in meters.
 */
 distanceMeters: number;
 /**
 * Total travel duration in seconds.
 */
 durationSeconds: number;
 /**
 * Ordered list of turn-by-turn guidance maneuver steps.
 */
 instructions: StepInstruction[];
}

export interface AcedRoutingPlugin {
 /**
 * Checks whether a pre-built offline tile bundle is installed for the specified region.
 */
 checkRegionAvailable(options: CheckRegionOptions): Promise<CheckRegionResult>;

 /**
 * Downloads and extracts a pre-compiled Valhalla tile bundle from a remote URL.
 * Note: This strictly extracts pre-built bundles; no on-device building is performed.
 */
 downloadRegionData(options: DownloadRegionOptions): Promise<DownloadRegionResult>;

 /**
 * Deletes local tiles and configuration for the specified region.
 */
 deleteRegionData(options: DeleteRegionOptions): Promise<DeleteRegionResult>;

 /**
 * Executes high-performance offline routing between start, end, and optional waypoints.
 * Returns GeoJSON [lng, lat] coordinate pairs and turn-by-turn guidance steps.
 */
 calculateRoute(options: CalculateRouteOptions): Promise<CalculateRouteResult>;
}
