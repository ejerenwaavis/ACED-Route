/**
 * ACED Route — Offline Valhalla Routing Capacitor Plugin Definitions
 *
 * NOTE ON COORDINATE CONVENTIONS:
 * - Routing input coordinates (`start`, `end`, `waypoints`) are provided as `[latitude, longitude]`.
 * - Returned route coordinates (`coordinates`) are strictly provided as `[longitude, latitude]` pairs
 *   to conform directly with standard GeoJSON and MapLibre GL source geometry conventions.
 */
export interface StepInstruction {
    /**
     * Spoken / visual turn instruction (e.g. "Turn left onto Main Street").
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
     * Unique name of the region (e.g. "us-northeast", "us-dc").
     */
    region: string;
}
export interface CheckRegionResult {
    /**
     * True if both the Valhalla routing tile directory and the .pmtiles visual basemap exist locally.
     */
    available: boolean;
    /**
     * Total disk size in megabytes occupied by this region bundle.
     */
    sizeMB: number;
    /**
     * True if Valhalla routing tiles are extracted and ready.
     */
    hasRoutingTiles?: boolean;
    /**
     * True if the visual basemap (.pmtiles) archive exists.
     */
    hasBasemapPmtiles?: boolean;
    /**
     * Native file path to the .pmtiles file on the device filesystem.
     */
    pmtilesPath?: string;
}
export interface DownloadRegionOptions {
    /**
     * Remote URL to the pre-built Valhalla routing bundle archive (.zip).
     */
    bundleUrl: string;
    /**
     * Remote URL to the pre-built .pmtiles visual basemap archive.
     */
    pmtilesUrl?: string;
    /**
     * Unique name of the region to store locally.
     */
    regionName: string;
}
export interface DownloadRegionResult {
    /**
     * True if both the routing bundle and PMTiles basemap were successfully downloaded and stored.
     */
    success: boolean;
    /**
     * Native path to the downloaded .pmtiles file.
     */
    pmtilesPath?: string;
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
     * Downloads both the Valhalla routing bundle (extracted to tiles directory) and
     * the .pmtiles visual basemap archive (stored as a single file, read in place).
     */
    downloadRegionData(options: DownloadRegionOptions): Promise<DownloadRegionResult>;
    /**
     * Deletes local tiles and visual basemap for the specified region.
     */
    deleteRegionData(options: DeleteRegionOptions): Promise<DeleteRegionResult>;
    /**
     * Executes high-performance offline routing between start, end, and optional waypoints.
     * Returns GeoJSON [lng, lat] coordinate pairs and turn-by-turn guidance steps.
     */
    calculateRoute(options: CalculateRouteOptions): Promise<CalculateRouteResult>;
}
//# sourceMappingURL=definitions.d.ts.map