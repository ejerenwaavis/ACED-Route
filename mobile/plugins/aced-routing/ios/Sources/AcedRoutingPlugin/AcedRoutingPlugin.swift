import Foundation
import Capacitor
import AVFoundation
import CoreLocation

/**
 * AcedRoutingPlugin for iOS.
 * Bridges native offline routing calculations, PMTiles basemap management,
 * background navigation location updates, and neural speech synthesis to the Capacitor webview.
 *
 * Input coordinates: [latitude, longitude]
 * Output coordinates: [longitude, latitude] (GeoJSON / MapLibre GL standard)
 */
@objc(AcedRoutingPlugin)
public class AcedRoutingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "AcedRoutingPlugin"
    public let jsName = "AcedRouting"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkRegionAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadRegionData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRegionData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calculateRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startNavigationTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopNavigationTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeech", returnType: CAPPluginReturnPromise)
    ]

    private let engine = ValhallaEngine()
    private var locationManager: CLLocationManager?
    private let speechSynthesizer = AVSpeechSynthesizer()

    override public func load() {
        super.load()
        setupAudioSession()
    }

    private func setupAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .voicePrompt,
                options: [.duckOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("[AcedRoutingPlugin] Failed to configure AVAudioSession: \(error)")
        }
    }

    @objc public func checkRegionAvailable(_ call: CAPPluginCall) {
        guard let region = call.getString("region"), !region.isEmpty else {
            call.reject("Must provide a region identifier")
            return
        }

        let available = engine.isRegionAvailable(region: region)
        let sizeMB = engine.getRegionSizeMB(region: region)
        let hasRouting = engine.hasRoutingTiles(region: region)
        let hasBasemap = engine.hasBasemapPmtiles(region: region)
        let pmtilesUrl = engine.getPmtilesFile(region: region)

        call.resolve([
            "available": available,
            "sizeMB": sizeMB,
            "hasRoutingTiles": hasRouting,
            "hasBasemapPmtiles": hasBasemap,
            "pmtilesPath": hasBasemap ? pmtilesUrl.path : nil
        ])
    }

    @objc public func downloadRegionData(_ call: CAPPluginCall) {
        guard let regionName = call.getString("regionName"), !regionName.isEmpty else {
            call.reject("Must provide regionName")
            return
        }

        let bundleUrl = call.getString("bundleUrl")
        let pmtilesUrl = call.getString("pmtilesUrl")

        Task {
            do {
                let success = try await engine.downloadAndExtractRegion(
                    bundleUrl: bundleUrl,
                    pmtilesUrl: pmtilesUrl,
                    regionName: regionName
                )
                let pmtilesPath = self.engine.getPmtilesFile(region: regionName).path
                call.resolve([
                    "success": success,
                    "pmtilesPath": pmtilesPath
                ])
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

    @objc public func startNavigationTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.locationManager == nil {
                self.locationManager = CLLocationManager()
                self.locationManager?.delegate = self
                self.locationManager?.desiredAccuracy = kCLLocationAccuracyBestForNavigation
                self.locationManager?.distanceFilter = 1.0
                self.locationManager?.activityType = .automotiveNavigation
                self.locationManager?.allowsBackgroundLocationUpdates = true
                self.locationManager?.pausesLocationUpdatesAutomatically = false
            }

            self.locationManager?.requestWhenInUseAuthorization()
            self.locationManager?.startUpdatingLocation()
            self.locationManager?.startUpdatingHeading()
            call.resolve()
        }
    }

    @objc public func stopNavigationTracking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.locationManager?.stopUpdatingLocation()
            self.locationManager?.stopUpdatingHeading()
            call.resolve()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }

        let data: [String: Any] = [
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy,
            "altitude": loc.altitude,
            "bearing": loc.course >= 0 ? loc.course : 0.0,
            "speed": loc.speed >= 0 ? loc.speed : 0.0,
            "time": loc.timestamp.timeIntervalSince1970 * 1000.0
        ]
        self.notifyListeners("locationUpdate", data: data)
    }

    @objc public func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.resolve()
            return
        }

        let lang = call.getString("language") ?? "en"
        let localeCode = lang.lowercased().hasPrefix("es") ? "es-US" : "en-US"

        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = Float(call.getDouble("rate") ?? Double(AVSpeechUtteranceDefaultSpeechRate))
        utterance.pitchMultiplier = Float(call.getDouble("pitch") ?? 1.0)

        // Select best voice (enhanced/neural if available on device)
        if #available(iOS 16.0, *) {
            let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == localeCode }
            if let neuralVoice = voices.first(where: { $0.quality == .premium || $0.quality == .enhanced }) {
                utterance.voice = neuralVoice
            } else {
                utterance.voice = AVSpeechSynthesisVoice(language: localeCode)
            }
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: localeCode)
        }

        if speechSynthesizer.isSpeaking {
            speechSynthesizer.stopSpeaking(at: .immediate)
        }

        speechSynthesizer.speak(utterance)
        call.resolve()
    }

    @objc public func stopSpeech(_ call: CAPPluginCall) {
        if speechSynthesizer.isSpeaking {
            speechSynthesizer.stopSpeaking(at: .immediate)
        }
        call.resolve()
    }
}
