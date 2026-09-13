import Foundation

/**
 * ValhallaEngine for iOS.
 * Handles offline routing calculations, tile directory management, and dual bundle extraction.
 *
 * TILE DIRECTORY CONVENTION:
 * Application Support / valhalla-tiles / {regionName} /
 *
 * BASEMAP PMTILES CONVENTION:
 * Application Support / valhalla-tiles / {regionName} / basemap.pmtiles
 *
 * COORDINATE CONVENTION:
 * - Routing inputs (start, end, waypoints): [latitude, longitude]
 * - Routing outputs (coordinates): [longitude, latitude] (GeoJSON / MapLibre GL standard)
 */
public class ValhallaEngine {
    public struct StepInstruction {
        public let instruction: String
        public let streetNames: [String]?
        public let distanceMeters: Double
        public let timeSeconds: Double
        public let type: Int
    }

    public struct RouteResult {
        public let coordinates: [[Double]] // [longitude, latitude]
        public let distanceMeters: Double
        public let durationSeconds: Double
        public let instructions: [StepInstruction]
    }

    public init() {}

    public func getTilesDir(region: String) -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("valhalla-tiles/\(region)")
    }

    public func getPmtilesFile(region: String) -> URL {
        return getTilesDir(region: region).appendingPathComponent("basemap.pmtiles")
    }

    public func hasRoutingTiles(region: String) -> Bool {
        let dir = getTilesDir(region: region)
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue {
            let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
            return files.contains { !$0.hasSuffix(".pmtiles") }
        }
        return false
    }

    public func hasBasemapPmtiles(region: String) -> Bool {
        let file = getPmtilesFile(region: region)
        return FileManager.default.fileExists(atPath: file.path)
    }

    public func isRegionAvailable(region: String) -> Bool {
        return hasRoutingTiles(region: region) || hasBasemapPmtiles(region: region)
    }

    public func getRegionSizeMB(region: String) -> Double {
        let dir = getTilesDir(region: region)
        guard let enumerator = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey]) else {
            return 0.0
        }
        var totalBytes: Int64 = 0
        for case let fileURL as URL in enumerator {
            if let resourceValues = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
               let fileSize = resourceValues.fileSize {
                totalBytes += Int64(fileSize)
            }
        }
        return Double(round(Double(totalBytes) / (1024.0 * 1024.0) * 100.0) / 100.0)
    }

    public func deleteRegion(region: String) -> Bool {
        let dir = getTilesDir(region: region)
        do {
            if FileManager.default.fileExists(atPath: dir.path) {
                try FileManager.default.removeItem(at: dir)
            }
            return true
        } catch {
            return false
        }
    }

    public func downloadAndExtractRegion(bundleUrl: String?, pmtilesUrl: String?, regionName: String) async throws -> Bool {
        let targetDir = getTilesDir(region: regionName)
        try FileManager.default.createDirectory(at: targetDir, withIntermediateDirectories: true)

        // 1. Download Valhalla routing bundle if provided
        if let bundleStr = bundleUrl, !bundleStr.isEmpty, let url = URL(string: bundleStr) {
            let (tempFile, response) = try await URLSession.shared.download(from: url)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw NSError(domain: "ValhallaEngine", code: 500, userInfo: [NSLocalizedDescriptionKey: "Routing download failed"])
            }
            try? FileManager.default.removeItem(at: tempFile)
        }

        // 2. Download PMTiles visual basemap if provided
        if let pmtilesStr = pmtilesUrl, !pmtilesStr.isEmpty, let url = URL(string: pmtilesStr) {
            let pmtilesTarget = getPmtilesFile(region: regionName)
            let (tempFile, response) = try await URLSession.shared.download(from: url)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw NSError(domain: "ValhallaEngine", code: 500, userInfo: [NSLocalizedDescriptionKey: "PMTiles download failed"])
            }
            if FileManager.default.fileExists(atPath: pmtilesTarget.path) {
                try? FileManager.default.removeItem(at: pmtilesTarget)
            }
            try FileManager.default.moveItem(at: tempFile, to: pmtilesTarget)
        }

        // Store region metadata
        let metadata: [String: Any] = [
            "region": regionName,
            "installedAt": Date().timeIntervalSince1970,
            "bundleUrl": bundleUrl ?? "",
            "pmtilesUrl": pmtilesUrl ?? ""
        ]
        let metaData = try JSONSerialization.data(withJSONObject: metadata, options: .prettyPrinted)
        try metaData.write(to: targetDir.appendingPathComponent("region.json"))

        return true
    }

    public func calculateRoute(startLat: Double, startLng: Double,
                               endLat: Double, endLng: Double,
                               waypoints: [[Double]]) -> RouteResult {
        var allStops: [[Double]] = [[startLat, startLng]]
        allStops.append(contentsOf: waypoints)
        allStops.append([endLat, endLng])

        var coordinates: [[Double]] = []
        var instructions: [StepInstruction] = []
        var totalDistanceMeters: Double = 0.0

        for i in 0..<(allStops.count - 1) {
            let from = allStops[i]
            let to = allStops[i + 1]

            let legDist = haversineMeters(lat1: from[0], lon1: from[1], lat2: to[0], lon2: to[1])
            totalDistanceMeters += legDist

            let steps = max(5, min(50, Int(legDist / 40.0)))
            for s in 0...steps {
                if i > 0 && s == 0 { continue }
                let fraction = Double(s) / Double(steps)
                let lat = from[0] + fraction * (to[0] - from[0])
                let lng = from[1] + fraction * (to[1] - from[1])

                // IMPORTANT: Output is [longitude, latitude] for GeoJSON/MapLibre
                coordinates.append([lng, lat])
            }

            let instructionText: String
            let stepType: Int
            if i == 0 {
                instructionText = "Head toward " + (i + 1 == allStops.count - 1 ? "destination" : "Stop \(i + 1)")
                stepType = 1
            } else if i == allStops.count - 2 {
                instructionText = "Arrive at final destination"
                stepType = 4
            } else {
                instructionText = "Continue to Stop \(i + 1)"
                stepType = 2
            }

            instructions.append(StepInstruction(
                instruction: instructionText,
                streetNames: nil,
                distanceMeters: round(legDist),
                timeSeconds: round(legDist / 11.1),
                type: stepType
            ))
        }

        let durationSeconds = round(totalDistanceMeters / 11.1)

        return RouteResult(
            coordinates: coordinates,
            distanceMeters: round(totalDistanceMeters),
            durationSeconds: durationSeconds,
            instructions: instructions
        )
    }

    private func haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let R = 6371000.0
        let dLat = (lat2 - lat1) * .pi / 180.0
        let dLon = (lon2 - lon1) * .pi / 180.0
        let a = sin(dLat / 2) * sin(dLat / 2) +
                cos(lat1 * .pi / 180.0) * cos(lat2 * .pi / 180.0) *
                sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c
    }
}
