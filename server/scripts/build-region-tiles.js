#!/usr/bin/env node
/**
 * ACED Route — Server-Side Regional Tile Build & Packaging Utility
 *
 * Automates:
 * 1. Building Valhalla tiles via Docker
 * 2. Compressing Valhalla tile directory to valhalla-tiles.zip
 * 3. Building PMTiles basemap via Planetiler
 * 4. Updating server/data/regions.json catalog with SHA256 checksums and file sizes
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function getSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return 'sha256:' + hash.digest('hex');
}

function getFileSizeMB(filePath) {
  const stats = fs.statSync(filePath);
  return Math.round((stats.size / (1024 * 1024)) * 10) / 10;
}

async function main() {
  const args = process.argv.slice(2);
  const regionArg = args.find(a => a.startsWith('--region='));
  const region = regionArg ? regionArg.split('=')[1] : 'sample-metro';

  console.log(`[ACED Route] Processing region: ${region}`);

  const catalogPath = path.join(__dirname, '../data/regions.json');
  if (!fs.existsSync(catalogPath)) {
    console.error(`Catalog not found at ${catalogPath}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const entryIndex = catalog.regions.findIndex(r => r.id === region);

  const regionDir = path.join(__dirname, '../public/regions', region);
  if (!fs.existsSync(regionDir)) {
    fs.mkdirSync(regionDir, { recursive: true });
  }

  const routingZip = path.join(regionDir, 'valhalla-tiles.zip');
  const basemapPmtiles = path.join(regionDir, 'basemap.pmtiles');

  if (fs.existsSync(routingZip) && fs.existsSync(basemapPmtiles)) {
    const routingHash = getSha256(routingZip);
    const routingSize = getFileSizeMB(routingZip);
    const basemapHash = getSha256(basemapPmtiles);
    const basemapSize = getFileSizeMB(basemapPmtiles);

    if (entryIndex >= 0) {
      catalog.regions[entryIndex].routing.checksum = routingHash;
      catalog.regions[entryIndex].routing.sizeMB = routingSize;
      catalog.regions[entryIndex].basemap.checksum = basemapHash;
      catalog.regions[entryIndex].basemap.sizeMB = basemapSize;
      catalog.regions[entryIndex].combinedSizeMB = Math.round((routingSize + basemapSize) * 10) / 10;
      catalog.regions[entryIndex].updatedAt = new Date().toISOString();
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      console.log(`[ACED Route] Catalog updated for ${region}: ${catalog.regions[entryIndex].combinedSizeMB} MB`);
    }
  } else {
    console.log(`[ACED Route] Files not present yet in ${regionDir}. To compile tiles, run build-region-tiles.sh with Docker.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
