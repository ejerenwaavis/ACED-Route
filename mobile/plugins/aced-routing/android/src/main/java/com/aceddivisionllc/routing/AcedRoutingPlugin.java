package com.aceddivisionllc.routing;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * AcedRoutingPlugin exposes native Valhalla offline routing to the Capacitor webview.
 *
 * All offline routing calculations operate 100% locally with zero online API dependencies.
 * Input coordinates: [latitude, longitude]
 * Output coordinates: [longitude, latitude] (GeoJSON / MapLibre GL convention)
 */
@CapacitorPlugin(name = "AcedRouting")
public class AcedRoutingPlugin extends Plugin {
    private static final String TAG = "AcedRoutingPlugin";
    private ValhallaEngine valhallaEngine;

    @Override
    public void load() {
        super.load();
        valhallaEngine = new ValhallaEngine(getContext());
        Log.i(TAG, "AcedRoutingPlugin initialized with tiles directory: " + 
              valhallaEngine.getTilesDir("default").getParent());
    }

    @PluginMethod
    public void checkRegionAvailable(PluginCall call) {
        String region = call.getString("region");
        if (region == null || region.isEmpty()) {
            call.reject("Must provide a region identifier");
            return;
        }

        try {
            boolean available = valhallaEngine.isRegionAvailable(region);
            double sizeMB = valhallaEngine.getRegionSizeMB(region);

            JSObject ret = new JSObject();
            ret.put("available", available);
            ret.put("sizeMB", sizeMB);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "checkRegionAvailable error", e);
            call.reject("Failed to check region availability: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadRegionData(PluginCall call) {
        String bundleUrl = call.getString("bundleUrl");
        String regionName = call.getString("regionName");

        if (bundleUrl == null || regionName == null) {
            call.reject("Must provide both bundleUrl and regionName");
            return;
        }

        // Execute download and extraction asynchronously in background thread
        bridge.execute(() -> {
            try {
                boolean success = valhallaEngine.downloadAndExtractBundle(bundleUrl, regionName);
                JSObject ret = new JSObject();
                ret.put("success", success);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "downloadRegionData error", e);
                call.reject("Failed to download and extract region bundle: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void deleteRegionData(PluginCall call) {
        String regionName = call.getString("regionName");
        if (regionName == null || regionName.isEmpty()) {
            call.reject("Must provide regionName");
            return;
        }

        try {
            boolean deleted = valhallaEngine.deleteRegion(regionName);
            JSObject ret = new JSObject();
            ret.put("success", deleted);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "deleteRegionData error", e);
            call.reject("Failed to delete region data: " + e.getMessage());
        }
    }

    @PluginMethod
    public void calculateRoute(PluginCall call) {
        JSArray startArr = call.getArray("start");
        JSArray endArr = call.getArray("end");

        if (startArr == null || startArr.length() < 2 || endArr == null || endArr.length() < 2) {
            call.reject("Must provide start [lat, lng] and end [lat, lng] coordinates");
            return;
        }

        bridge.execute(() -> {
            try {
                double startLat = startArr.getDouble(0);
                double startLng = startArr.getDouble(1);
                double endLat = endArr.getDouble(0);
                double endLng = endArr.getDouble(1);

                List<double[]> waypoints = new ArrayList<>();
                JSArray waypointsArr = call.getArray("waypoints");
                if (waypointsArr != null) {
                    for (int i = 0; i < waypointsArr.length(); i++) {
                        JSONArray wp = waypointsArr.getJSONArray(i);
                        if (wp.length() >= 2) {
                            waypoints.add(new double[]{wp.getDouble(0), wp.getDouble(1)});
                        }
                    }
                }

                ValhallaEngine.RouteResult result = valhallaEngine.calculateRoute(
                        startLat, startLng, endLat, endLng, waypoints
                );

                // Build coordinates array in [longitude, latitude] GeoJSON format
                JSArray coordsJson = new JSArray();
                for (double[] point : result.coordinates) {
                    JSONArray pt = new JSONArray();
                    pt.put(point[0]); // longitude
                    pt.put(point[1]); // latitude
                    coordsJson.put(pt);
                }

                // Build instructions array
                JSArray instJson = new JSArray();
                for (ValhallaEngine.StepInstruction step : result.instructions) {
                    JSONObject sObj = new JSONObject();
                    sObj.put("instruction", step.instruction);
                    sObj.put("distanceMeters", step.distanceMeters);
                    sObj.put("timeSeconds", step.timeSeconds);
                    sObj.put("type", step.type);
                    if (step.streetNames != null) {
                        sObj.put("streetNames", new JSONArray(step.streetNames));
                    }
                    instJson.put(sObj);
                }

                JSObject ret = new JSObject();
                ret.put("coordinates", coordsJson);
                ret.put("distanceMeters", result.distanceMeters);
                ret.put("durationSeconds", result.durationSeconds);
                ret.put("instructions", instJson);

                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "calculateRoute error", e);
                call.reject("Route calculation failed: " + e.getMessage());
            }
        });
    }
}
