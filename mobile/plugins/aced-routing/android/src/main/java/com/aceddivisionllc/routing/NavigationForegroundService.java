package com.aceddivisionllc.routing;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * NavigationForegroundService keeps GPS tracking alive in the background
 * during active turn-by-turn navigation with a sticky system tray notification.
 */
public class NavigationForegroundService extends Service implements LocationListener {
    private static final String TAG = "NavForegroundService";
    public static final String CHANNEL_ID = "aced_route_navigation_channel";
    public static final int NOTIFICATION_ID = 8801;

    public interface LocationCallback {
        void onLocationUpdate(Location location);
    }

    private static LocationCallback locationCallback;

    public static void setLocationCallback(LocationCallback callback) {
        locationCallback = callback;
    }

    private LocationManager locationManager;
    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends Binder {
        public NavigationForegroundService getService() {
            return NavigationForegroundService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startInForeground();
        requestLocationUpdates();
        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "ACED Route Navigation",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows turn-by-turn navigation and GPS tracking status");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void startInForeground() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = null;
        if (launchIntent != null) {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, flags);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("ACED Route Navigation Active")
                .setContentText("Turn-by-turn voice guidance & GPS tracking active")
                .setSmallIcon(android.R.drawable.ic_menu_directions)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
                .setPriority(NotificationCompat.PRIORITY_LOW);

        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
        }

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void requestLocationUpdates() {
        if (locationManager == null) return;
        try {
            // Request updates from GPS_PROVIDER (high accuracy)
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        1000L, // 1000ms minimum interval
                        1.0f,  // 1 meter minimum delta
                        this
                );
            }
            // Request updates from NETWORK_PROVIDER as immediate fallback
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        1000L,
                        1.0f,
                        this
                );
            }

            // Immediately emit last known location if available
            Location lastGps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location lastNet = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            Location best = lastGps != null ? lastGps : lastNet;
            if (best != null && locationCallback != null) {
                locationCallback.onLocationUpdate(best);
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission missing", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to request location updates", e);
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location != null && locationCallback != null) {
            locationCallback.onLocationUpdate(location);
        }
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception e) {
                Log.w(TAG, "Error removing location updates", e);
            }
        }
        stopForeground(true);
        Log.i(TAG, "NavigationForegroundService destroyed");
    }
}
