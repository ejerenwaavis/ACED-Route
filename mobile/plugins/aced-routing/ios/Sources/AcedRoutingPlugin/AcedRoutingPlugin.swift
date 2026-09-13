import Foundation
import Capacitor

/**
 * AcedRoutingPlugin for iOS.
 * Bridges native offline routing calculations to the Capacitor webview.
 *
 * Input coordinates: [latitude, longitude]
 * Output coordinates: [longitude, latitude] (GeoJSON / MapLibre GL standard)
 */
@objc(AcedRoutingPlugin)
public class AcedRoutingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AcedRoutingPlugin"
    public let jsName = "AcedRouting"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkRegionAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadRegionData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRegionData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calculateRoute", returnType: CAPPluginReturnPromise)
    ]

    private let engine = ValhallaEngine()

    @objc public func checkRegionAvailable(_ call: CAPPluginCall) {
        guard let region = call.getString("region"), !region.isEmpty else {
            call.reject("Must provide a region identifier")
            return
        }

        let available = engine.isRegionAvailable(region: region)
        let sizeMB = engine.getRegionSizeMB(region: region)

        call.resolve([
            "available": available,
            "sizeMB": sizeMB
        ])
    }

    @objc public func downloadRegionData(_ call: CAPPluginCall) {
        guard let bundleUrl = call.getString("bundleUrl"),
              let regionName = call.getString("regionName") else {
            call.reject("Must provide both bundleUrl and regionName")
            return
        }

        Task {
            do {
                let success = try await engine.downloadAndExtractBundle(bundleUrl: bundleUrl, regionName: regionName)
                call.resolve(["success": success])
            } catch {
                call.reject("Failed to download region data: \(error.localizedDescription)")
            }
        }
    }

    @objc public func deleteRegionData(_ call: CAPPluginCall) {
        guard let regionName = call.getString("regionName"), !regionName.isEmpty else {
            call.reject("Must provide regionName")
            return
        }

        let success = engine.deleteRegion(region: regionName)
        call.resolve(["success": success])
    }

    @objc public func calculateRoute(_ call: CAPPluginCall) {
        guard let startArr = call.getArray("start") as? [Double], startArr.count >= 2,
              let endArr = call.getArray("end") as? [Double], endArr.count >= 2 else {
            call.reject("Must provide start [lat, lng] and end [lat, lng] coordinates")
            return
        }

        var waypointsList: [[Double]] = []
        if let waypointsRaw = call.getArray("waypoints") as? [[Double]] {
            waypointsList = waypointsRaw
        }

        let result = engine.calculateRoute(
            startLat: startArr[0],
            startLng: startArr[1],
            endLat: endArr[0],
            endLng: endArr[1],
            waypoints: waypointsList
        )

        var instructionsJson: [[String: Any]] = []
        for step in result.instructions {
            var stepDict: [String: Any] = [
                "instruction": step.instruction,
                "distanceMeters": step.distanceMeters,
                "timeSeconds": step.timeSeconds,
                "type": step.type
            ]
            if let names = step.streetNames {
                stepDict["streetNames"] = names
            }
            instructionsJson.append(stepDict)
        }

        call.resolve([
            "coordinates": result.coordinates, // [lng, lat]
            "distanceMeters": result.distanceMeters,
            "durationSeconds": result.durationSeconds,
            "instructions": instructionsJson
        ])
    }
}
