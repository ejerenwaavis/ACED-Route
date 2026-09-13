#!/usr/bin/env bash
# ==============================================================================
# ACED Route — Server-Side Valhalla Routing & PMTiles Basemap Build Pipeline
#
# Builds offline routing bundles and visual basemap archives ahead of time
# on server/CI. Device clients NEVER build tiles on-device; they only download
# and extract these pre-built bundles.
# ==============================================================================

set -euo pipefail

REGION="${1:-us-dc}"
PBF_URL="${2:-https://download.geofabrik.de/north-america/us/district-of-columbia-latest.osm.pbf}"
OUT_DIR="${3:-$(pwd)/server/public/regions/${REGION}}"

echo "======================================================================"
echo "ACED Route — Building Regional Bundle: ${REGION}"
echo "Source OSM PBF: ${PBF_URL}"
echo "Destination:    ${OUT_DIR}"
echo "======================================================================"

WORK_DIR="/tmp/aced-tile-build/${REGION}"
mkdir -p "${WORK_DIR}" "${OUT_DIR}"

PBF_FILE="${WORK_DIR}/${REGION}.osm.pbf"
if [ ! -f "${PBF_FILE}" ]; then
  echo ">>> [1/4] Downloading Geofabrik extract..."
  curl -fsSL -o "${PBF_FILE}" "${PBF_URL}"
else
  echo ">>> [1/4] Using cached OSM PBF at ${PBF_FILE}"
fi

echo ">>> [2/4] Building Valhalla routing tiles via official Docker container..."
VALHALLA_TILES_DIR="${WORK_DIR}/valhalla_tiles"
mkdir -p "${VALHALLA_TILES_DIR}"

docker run --rm \
  -v "${WORK_DIR}:/data" \
  -v "${VALHALLA_TILES_DIR}:/custom_tiles" \
  ghcr.io/valhalla/valhalla:latest \
  bash -c "
    valhalla_build_config --mjolnir-tile-dir /custom_tiles --mjolnir-tile-extract /custom_tiles/valhalla_tiles.tar > /custom_tiles/valhalla.json && \
    valhalla_build_admin_db --config /custom_tiles/valhalla.json /data/${REGION}.osm.pbf && \
    valhalla_build_tiles --config /custom_tiles/valhalla.json /data/${REGION}.osm.pbf && \
    valhalla_build_extract --config /custom_tiles/valhalla.json
  "

echo ">>> [3/4] Compressing Valhalla bundle to archive..."
ROUTING_ARCHIVE="${OUT_DIR}/valhalla-tiles.zip"
(cd "${VALHALLA_TILES_DIR}" && zip -r -q "${ROUTING_ARCHIVE}" .)

echo ">>> [4/4] Generating PMTiles visual basemap..."
PMTILES_FILE="${OUT_DIR}/basemap.pmtiles"
# Planetiler / Protomaps basemap extract:
if command -v planetiler >/dev/null 2>&1; then
  planetiler --osm-path="${PBF_FILE}" --output="${PMTILES_FILE}" --nodepath=false
else
  docker run --rm \
    -v "${WORK_DIR}:/data" \
    -v "${OUT_DIR}:/output" \
    ghcr.io/onthegomap/planetiler:latest \
    --osm-path="/data/${REGION}.osm.pbf" \
    --output="/output/basemap.pmtiles" \
    --nodepath=false
fi

ROUTING_HASH=$(sha256sum "${ROUTING_ARCHIVE}" | awk '{print $1}')
ROUTING_SIZE=$(du -m "${ROUTING_ARCHIVE}" | awk '{print $1}')

BASEMAP_HASH=$(sha256sum "${PMTILES_FILE}" | awk '{print $1}')
BASEMAP_SIZE=$(du -m "${PMTILES_FILE}" | awk '{print $1}')

echo "======================================================================"
echo "Build Complete for ${REGION}:"
echo "  Routing Bundle:  ${ROUTING_ARCHIVE} (${ROUTING_SIZE} MB, SHA: ${ROUTING_HASH})"
echo "  PMTiles Basemap: ${PMTILES_FILE} (${BASEMAP_SIZE} MB, SHA: ${BASEMAP_HASH})"
echo "======================================================================"
