package com.aceddivisionllc.routing;

import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * AcedRoutingPlugin exposes native Valhalla offline routing, PMTiles basemap
 * management, foreground GPS tracking, and neural voice guidance to the Capacitor webview.
 *
 * Input coordinates: [latitude, longitude]
 * Output coordinates: [longitude, latitude] (GeoJSON / MapLibre GL convention)
 */
@CapacitorPlugin(name = "AcedRouting")
public class AcedRoutingPlugin extends Plugin {
    private static final String TAG = "AcedRoutingPlugin";
    private ValhallaEngine valhallaEngine;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    public void load() {
        super.load();
        valhallaEngine = new ValhallaEngine(getContext());
        initTts();
        Log.i(TAG, "AcedRoutingPlugin initialized with tiles directory: " + 
              valhallaEngine.getTilesDir("default").getParent());
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true;
                    selectBestVoice(Locale.US);
                    Log.i(TAG, "TextToSpeech initialized successfully");
                } else {
                    Log.w(TAG, "TextToSpeech init returned status: " + status);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize TextToSpeech", e);
        }
    }

    private void selectBestVoice(Locale locale) {
        if (tts == null || !ttsReady) return;
        try {
            tts.setLanguage(locale);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    Voice bestVoice = null;
                    for (Voice v : voices) {
                        if (v.getLocale() != null && v.getLocale().getLanguage().equalsIgnoreCase(locale.getLanguage())) {
                            String vName = v.getName().toLowerCase();
                            // Prioritize Google Speech Services neural/high quality voice variants
                            if (v.getQuality() == Voice.QUALITY_VERY_HIGH ||
                                vName.contains("-x-") ||
                                vName.contains("neural") ||
                                vName.contains("network")) {
                                bestVoice = v;
                                break;
                            }
                            if (bestVoice == null) {
                                bestVoice = v;
                            }
                        }
                    }
                    if (bestVoice != null) {
                        tts.setVoice(bestVoice);
                        Log.i(TAG, "Selected TTS voice: " + bestVoice.getName());
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error selecting TTS voice", e);
        }
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
            boolean hasRouting = valhallaEngine.hasRoutingTiles(region);
            boolean hasBasemap = valhallaEngine.hasBasemapPmtiles(region);
            File pmtilesFile = valhallaEngine.getPmtilesFile(region);

            JSObject ret = new JSObject();
            ret.put("available", available);
            ret.put("sizeMB", sizeMB);
            ret.put("hasRoutingTiles", hasRouting);
            ret.put("hasBasemapPmtiles", hasBasemap);
            ret.put("pmtilesPath", pmtilesFile.exists() ? pmtilesFile.getAbsolutePath() : null);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "checkRegionAvailable error", e);
            call.reject("Failed to check region availability: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadRegionData(PluginCall call) {
        String bundleUrl = call.getString("bundleUrl");
        String pmtilesUrl = call.getString("pmtilesUrl");
        String regionName = call.getString("regionName");

        if (regionName == null || regionName.isEmpty()) {
            call.reject("Must provide regionName");
            return;
        }

        if ((bundleUrl == null || bundleUrl.isEmpty()) && (pmtilesUrl == null || pmtilesUrl.isEmpty())) {
            call.reject("Must provide at least bundleUrl or pmtilesUrl");
            return;
        }

        bridge.execute(() -> {
            try {
                boolean success = valhallaEngine.downloadAndExtractRegion(bundleUrl, pmtilesUrl, regionName);
                File pmtilesFile = valhallaEngine.getPmtilesFile(regionName);

                JSObject ret = new JSObject();
                ret.put("success", success);
                ret.put("pmtilesPath", pmtilesFile.exists() ? pmtilesFile.getAbsolutePath() : null);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "downloadRegionData error", e);
                call.reject("Failed to download and extract region data: " + e.getMessage());
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

    private double lastValidBearing = 0.0;
    private Location lastReportedLocation = null;

    @PluginMethod
    public void startNavigationTracking(PluginCall call) {
        try {
            NavigationForegroundService.setLocationCallback(location -> {
                double speed = location.hasSpeed() ? (double) location.getSpeed() : 0.0;
                double bearing = lastValidBearing;

                // Only update bearing when vehicle is genuinely moving (>= 0.8 m/s or >= 2.5m displacement)
                // This eliminates erratic compass jitter and prevents snapping back to 0.0 when stopped
                if (location.hasBearing() && speed >= 0.8) {
                    bearing = (double) location.getBearing();
                    lastValidBearing = bearing;
                } else if (lastReportedLocation != null) {
                    float distMoved = lastReportedLocation.distanceTo(location);
                    if (distMoved >= 2.5f) {
                        float calcBearing = lastReportedLocation.bearingTo(location);
                        if (calcBearing < 0) calcBearing += 360.0f;
                        bearing = (double) calcBearing;
                        lastValidBearing = bearing;
                    }
                }
                lastReportedLocation = location;

                JSObject data = new JSObject();
                data.put("latitude", location.getLatitude());
                data.put("longitude", location.getLongitude());
                data.put("accuracy", location.getAccuracy());
                data.put("altitude", location.getAltitude());
                data.put("bearing", bearing);
                data.put("speed", speed);
                data.put("time", location.getTime());
                notifyListeners("locationUpdate", data);
            });

            Intent serviceIntent = new Intent(getContext(), NavigationForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start navigation tracking", e);
            call.reject("Failed to start navigation tracking: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopNavigationTracking(PluginCall call) {
        try {
            NavigationForegroundService.setLocationCallback(null);
            Intent serviceIntent = new Intent(getContext(), NavigationForegroundService.class);
            getContext().stopService(serviceIntent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop navigation tracking", e);
            call.reject("Failed to stop navigation tracking: " + e.getMessage());
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }

        String lang = call.getString("language", "en");
        Locale locale = lang.toLowerCase().startsWith("es") ? new Locale("es", "US") : Locale.US;

        if (tts != null && ttsReady) {
            try {
                selectBestVoice(locale);
                Double rateVal = call.getDouble("rate");
                float rate = rateVal != null ? rateVal.floatValue() : 1.0f;
                Double pitchVal = call.getDouble("pitch");
                float pitch = pitchVal != null ? pitchVal.floatValue() : 1.0f;
                tts.setSpeechRate(rate);
                tts.setPitch(pitch);

                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "aced_nav_" + System.currentTimeMillis());
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "TTS speak failed", e);
                call.reject("TTS speak failed: " + e.getMessage());
            }
        } else {
            // If TTS is not yet ready or failed, resolve gracefully so navigation is not blocked
            Log.w(TAG, "TTS not ready when requested: " + text);
            call.resolve();
        }
    }

    @PluginMethod
    public void stopSpeech(PluginCall call) {
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(getContext().getPackageName(), 0);
            long versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = pInfo.getLongVersionCode();
            } else {
                versionCode = pInfo.versionCode;
            }
            JSObject res = new JSObject();
            res.put("versionCode", versionCode);
            res.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.0");
            res.put("packageName", getContext().getPackageName());
            res.put("lastUpdateTime", pInfo.lastUpdateTime);
            res.put("firstInstallTime", pInfo.firstInstallTime);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Failed to get app version", e);
            call.reject("Failed to get app version: " + e.getMessage());
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("apkUrl is required");
            return;
        }

        new Thread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                        Intent manageUnknown = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        manageUnknown.setData(Uri.parse("package:" + getContext().getPackageName()));
                        manageUnknown.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(manageUnknown);
                    }
                }

                File cacheDir = getContext().getExternalCacheDir();
                if (cacheDir == null) {
                    cacheDir = getContext().getCacheDir();
                }
                File destFile = new File(cacheDir, "acedroute-update.apk");
                if (destFile.exists()) {
                    destFile.delete();
                }

                Log.i(TAG, "Downloading update APK from: " + apkUrl);
                URL url = new URL(apkUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "ACED-Route-Android");

                int status = conn.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM || status == 307 || status == 308) {
                    String newUrl = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = (HttpURLConnection) new URL(newUrl).openConnection();
                    conn.setRequestProperty("User-Agent", "ACED-Route-Android");
                }

                try (InputStream in = conn.getInputStream();
                     OutputStream out = new FileOutputStream(destFile)) {
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = in.read(buffer)) != -1) {
                        out.write(buffer, 0, bytesRead);
                    }
                    out.flush();
                } finally {
                    conn.disconnect();
                }

                Log.i(TAG, "Update APK downloaded successfully. Size: " + destFile.length() + " bytes");

                Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    destFile
                );

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                getContext().startActivity(installIntent);

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("message", "Installer opened");
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Failed to download/install APK", e);
                call.reject("Failed to install APK: " + e.getMessage());
            }
        }).start();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {}
        }
        NavigationForegroundService.setLocationCallback(null);
    }
}
