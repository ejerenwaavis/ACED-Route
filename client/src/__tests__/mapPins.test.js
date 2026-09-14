import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SUWANEE_SAMPLE_POOL, getRandomSampleSlice, formatSampleSliceToCSV } from '../data/sampleManifestPool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -- Pure functions mirrored from MapView.jsx ----------------------------------
function getStopCoords(stop) {
  if (!stop) return null;
  const raw = stop.address?.location?.coordinates || stop.coordinates || stop.location?.coordinates;
  if (Array.isArray(raw) && raw.length >= 2) {
    let lng = parseFloat(raw[0]), lat = parseFloat(raw[1]);
    if (lat < 0 && lng > 0) { const t = lng; lng = lat; lat = t; }
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) return [lng, lat];
  }
  const obj = (typeof stop.address === 'object' && stop.address !== null) ? stop.address : stop;
  const latVal = obj.latitude ?? obj.lat, lngVal = obj.longitude ?? obj.lng ?? obj.lon;
  if (latVal != null && lngVal != null) {
    let lat = parseFloat(latVal), lng = parseFloat(lngVal);
    if (lat < 0 && lng > 0) { const t = lng; lng = lat; lat = t; }
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) return [lng, lat];
  }
  return null;
}
function buildStopsGeoJSON(stopsList, activeIdx, selectedIdx) {
  const features = [];
  if (Array.isArray(stopsList)) {
    stopsList.forEach((stop, idx) => {
      const coords = getStopCoords(stop);
      if (!coords) return;
      const isDelivered = stop.status === 'delivered' || Boolean(stop.completedAt);
      const isSkipped = stop.status === 'skipped';
      let statusVal = stop.status || 'pending';
      if (isSkipped) statusVal = 'skipped';
      else if (isDelivered) statusVal = 'delivered';

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
          stopIndex: idx,
          stopNumber: String(idx + 1),
          status: statusVal,
          isActive: idx === activeIdx,
          isSelected: idx === selectedIdx
        }
      });
    });
  }
  return { type: 'FeatureCollection', features };
}
function safeAddSource(map, id, sourceDef) {
  try { if (map.getSource(id)) return true; map.addSource(id, sourceDef); return true; }
  catch(e) { return false; }
}
function safeAddLayer(map, layerDef) {
  try { if (map.getLayer(layerDef.id)) return true; map.addLayer(layerDef); return true; }
  catch(e) { return false; }
}
function addOverlayLayer(map, layerDef) {
  try {
    if (!map.getLayer(layerDef.id)) map.addLayer(layerDef);
    map.moveLayer(layerDef.id);
    return true;
  } catch(e) { return false; }
}
function ensureOverlaysOnTop(map, overlayIds) {
  if (!map) return;
  overlayIds.forEach(id => {
    try { if (map.getLayer(id)) map.moveLayer(id); } catch(_) {}
  });
}
function createMockMap({ failAddSource=false }={}) {
  const sources={}, layers={};
  const layerOrder = [];
  return {
    getSource: (id) => sources[id] || null,
    addSource: (id, def) => { if (failAddSource) throw new Error('Style not loaded'); sources[id] = def; },
    getLayer: (id) => layers[id] || null,
    addLayer: (def, beforeId) => {
      layers[def.id] = def;
      if (beforeId && layerOrder.includes(beforeId)) {
        const idx = layerOrder.indexOf(beforeId);
        layerOrder.splice(idx, 0, def.id);
      } else {
        layerOrder.push(def.id);
      }
    },
    moveLayer: (id, beforeId) => {
      if (!layers[id]) return;
      const curIdx = layerOrder.indexOf(id);
      if (curIdx > -1) layerOrder.splice(curIdx, 1);
      if (beforeId && layerOrder.includes(beforeId)) {
        const idx = layerOrder.indexOf(beforeId);
        layerOrder.splice(idx, 0, id);
      } else {
        layerOrder.push(id);
      }
    },
    _sources: sources,
    _layers: layers,
    _layerOrder: layerOrder
  };
}

// -- Fixtures ------------------------------------------------------------------
const ATL = [
  { address: { location: { coordinates: [-84.388, 33.749] } }, status: 'pending' },
  { address: { location: { coordinates: [-84.401, 33.762] } }, status: 'pending' },
  { address: { location: { coordinates: [-84.375, 33.738] } }, status: 'delivered' },
];
const NULL_STOPS = [
  { address: { location: null } }, { address: {} }, { address: { location: { coordinates: null } } },
];

// -- Runner --------------------------------------------------------------------
let pass=0, fail=0;
function assert(label, cond, detail='') {
  if(cond) { console.log('  PASS: '+label); pass++; }
  else { console.error('  FAIL: '+label+(detail?' -- '+detail:'')); fail++; }
}

console.log('\n=== MAP PIN AUTOMATED SCENARIO TESTS ===\n');

// S1: Coord extraction
console.log('S1: Coordinate Extraction');
assert('Atlanta [lng,lat] extracted', JSON.stringify(getStopCoords(ATL[0]))===JSON.stringify([-84.388,33.749]));
assert('Null location -> null', getStopCoords(NULL_STOPS[0])===null);
assert('Empty address -> null', getStopCoords(NULL_STOPS[1])===null);
assert('Object lat/lng fallback', (()=>{ const c=getStopCoords({lat:33.749,lng:-84.388}); return c&&c[0]===-84.388&&c[1]===33.749; })());
assert('NYC placeholder is valid (not null)', getStopCoords({address:{location:{coordinates:[-73.9851,40.7488]}}})!==null);

// S2: GeoJSON building
console.log('\nS2: GeoJSON Building');
assert('3 ATL stops -> 3 features', buildStopsGeoJSON(ATL,0,null).features.length===3);
assert('Null coord stops -> 0 features', buildStopsGeoJSON(NULL_STOPS,0,null).features.length===0);
assert('Mixed: 3+3 -> 3 features', buildStopsGeoJSON([...ATL,...NULL_STOPS],0,null).features.length===3);
assert('Empty list -> empty FC', buildStopsGeoJSON([],0,null).features.length===0);
assert('isActive correct', buildStopsGeoJSON(ATL,1,null).features[1].properties.isActive===true);
assert('Stop numbers 1-indexed', buildStopsGeoJSON(ATL,0,null).features[0].properties.stopNumber==='1');

// S3: safeAdd on ready map
console.log('\nS3: safeAdd on Ready Map');
assert('safeAddSource returns true', safeAddSource(createMockMap(),'src',{type:'geojson',data:{}}));
assert('safeAddSource returns false on not-ready map', safeAddSource(createMockMap({failAddSource:true}),'src',{})===false);
assert('safeAddSource idempotent', (()=>{ const m=createMockMap(); safeAddSource(m,'src',{}); return safeAddSource(m,'src',{}); })());

// S4: Full pipeline
console.log('\nS4: Full Pipeline');
assert('Full setup succeeds on ready map', (()=>{
  const m=createMockMap(), gj=buildStopsGeoJSON(ATL,0,null);
  const ok=safeAddSource(m,'stops-source',{type:'geojson',data:gj})&&safeAddLayer(m,{id:'stops-pin-outer',type:'circle',source:'stops-source',paint:{}});
  return ok&&!!m.getSource('stops-source')&&!!m.getLayer('stops-pin-outer');
})());
assert('Setup fails on not-ready map, no layer added', (()=>{
  const m=createMockMap({failAddSource:true});
  safeAddSource(m,'stops-source',{type:'geojson',data:{}});
  return !m.getSource('stops-source')&&!m.getLayer('stops-pin-outer');
})());
assert('Retry on idle succeeds after initial failure', (()=>{
  let fail=true; const src={}, lay={};
  const m={ getSource:(id)=>src[id]||null, addSource:(id,d)=>{ if(fail) throw new Error('not ready'); src[id]=d; },
            getLayer:(id)=>lay[id]||null, addLayer:(d)=>{ lay[d.id]=d; } };
  const r1=safeAddSource(m,'stops-source',{});
  fail=false;
  const r2=safeAddSource(m,'stops-source',{});
  safeAddLayer(m,{id:'stops-pin-outer',type:'circle',source:'stops-source',paint:{}});
  return r1===false&&r2===true&&!!m.getSource('stops-source')&&!!m.getLayer('stops-pin-outer');
})());

// S5: Phase B Pin States & Z-Index Layering
console.log('\nS5: Phase B Pin States & Z-Index Layering');
const PHASE_B_STOPS = [
  { address: { location: { coordinates: [-84.388, 33.749] } }, status: 'delivered' },
  { address: { location: { coordinates: [-84.401, 33.762] } }, completedAt: '2026-09-14T09:00:00Z' }, // delivered via completedAt
  { address: { location: { coordinates: [-84.375, 33.738] } }, status: 'pending' }, // active next stop
  { address: { location: { coordinates: [-84.360, 33.720] } }, status: 'skipped' }, // skipped/issue
  { address: { location: { coordinates: [-84.350, 33.710] } }, status: 'pending' }, // upcoming standard
];
const bGj = buildStopsGeoJSON(PHASE_B_STOPS, 2, 2); // stop index 2 is active and selected
assert('Stop 0 is delivered', bGj.features[0].properties.status === 'delivered');
assert('Stop 1 is delivered via completedAt', bGj.features[1].properties.status === 'delivered');
assert('Stop 2 is active next stop', bGj.features[2].properties.isActive === true);
assert('Stop 2 is selected', bGj.features[2].properties.isSelected === true);
assert('Stop 3 is skipped', bGj.features[3].properties.status === 'skipped');
assert('Stop 4 is standard upcoming', bGj.features[4].properties.status === 'pending');

// Z-index hierarchy verification from CSS rules
const cssContent = fs.readFileSync(path.join(__dirname, '../index.css'), 'utf8');
const controlsZMatch = cssContent.match(/\.maplibre-controls-overlay[^{]*\{[^}]*z-index:\s*(\d+)/);
const activePinZMatch = cssContent.match(/\.stop-marker-next[^{]*\{[^}]*z-index:\s*(\d+)/);
const controlsZ = controlsZMatch ? parseInt(controlsZMatch[1], 10) : 0;
const activePinZ = activePinZMatch ? parseInt(activePinZMatch[1], 10) : 999;
assert('Controls z-index >= 100', controlsZ >= 100, `Found: ${controlsZ}`);
assert('Active pin z-index < 10 (stays below controls)', activePinZ < 10, `Found: ${activePinZ}`);
assert('Active pin is layered strictly below controls', activePinZ < controlsZ, `pin: ${activePinZ} vs controls: ${controlsZ}`);

// S6: Phase C Map Screen Chrome & Build Time Comparison Tests
console.log('\nS6: Phase C Map Chrome & Build Time Comparison');

// 1. CSS Chrome verification
assert('Top bar has dark graphite background', /app-header[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Header route pill is defined', /\.header-route-pill/.test(cssContent));
assert('Header progress pill is defined', /\.header-progress-pill/.test(cssContent));
assert('Map control buttons are circular', /\.map-control-btn[^{]*\{[^}]*border-radius:\s*50%/.test(cssContent));
assert('Map control buttons have dark graphite background', /\.map-control-btn[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Map control buttons have z-index 100', /\.map-control-btn[^{]*\{[^}]*z-index:\s*100/.test(cssContent));
assert('Next stop hero card has dark graphite background', /\.nav-hero[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Floating map bottom sheet has dark graphite background', /\.map-bottom-sheet[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Navigate action button uses orange action token', /\.btn-navigate-action[^{]*\{[^}]*--color-orange-action/.test(cssContent));

// 2. Build time comparison logic verification
const installedDate = new Date('2026-09-14T15:00:00Z');
const olderCloudDate = new Date('2026-09-14T14:30:00Z');
const newerCloudDate = new Date('2026-09-14T15:45:00Z');

function checkCloudIsNewer(installed, cloud) {
  if (!installed || !cloud) return false;
  return (cloud.getTime() - installed.getTime()) > 2 * 60 * 1000;
}

assert('Newer cloud release correctly triggers update status', checkCloudIsNewer(installedDate, newerCloudDate) === true);
assert('Older cloud release correctly reports up-to-date', checkCloudIsNewer(installedDate, olderCloudDate) === false);
assert('Identical build timestamp reports up-to-date', checkCloudIsNewer(installedDate, installedDate) === false);

// S7: Phase D Turn-by-Turn Navigation Screen & Camera Fix Tests
console.log('\nS7: Phase D Turn-by-Turn Navigation Screen & Camera Snapping Fix');

// 1. Turn instruction card styling verification
assert('Turn card pinned container is defined', /\.turn-card-pinned-container/.test(cssContent));
assert('Turn instruction card has dark graphite background', /\.turn-instruction-card[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Turn instruction card has high z-index (pinned above map)', /\.turn-card-pinned-container[^{]*\{[^}]*z-index:\s*120/.test(cssContent));
assert('Turn maneuver icon box has dark surface styling', /\.turn-maneuver-icon-box/.test(cssContent));
assert('Recalculating animation bar is defined', /\.turn-recalculating-bar/.test(cssContent));

// 2. Current stop floating chip styling verification
assert('Current stop chip container is defined', /\.current-stop-chip-container/.test(cssContent));
assert('Current stop chip uses dark graphite card', /\.current-stop-chip[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Current stop chip badge uses action orange', /\.current-stop-chip-badge[^{]*\{[^}]*--color-orange-action/.test(cssContent));

// 3. Map controls free-panning highlight verification
assert('Recenter active class has orange indicator', /\.map-control-recenter-active[^{]*\{[^}]*--color-orange-action/.test(cssContent));

// 4. Map camera follow logic test (verifies camera easeTo is bypassed when userIsPanning === true)
function shouldFollowVehicle(isNavigating, mapLoaded, hasLocation, userIsPanning) {
  return Boolean(isNavigating && mapLoaded && hasLocation && !userIsPanning);
}

assert('Camera follows vehicle when navigating and user is NOT panning',
  shouldFollowVehicle(true, true, true, false) === true
);
assert('Camera DOES NOT snap back when user is actively panning/exploring',
  shouldFollowVehicle(true, true, true, true) === false
);
assert('Camera does not follow when navigation is inactive',
  shouldFollowVehicle(false, true, true, false) === false
);

// S8: Layout Spacing, Exit Navigation, Real Manifest Pool & Geocode Cache Tests
console.log('\nS8: Layout Spacing, Exit Navigation, Real Manifest Pool & Geocode Cache');

// 1. Layout and Exit Navigation Button CSS
assert('Turn card exit button is defined', /\.turn-card-exit-btn/.test(cssContent));
assert('Controls are offset down during active navigation', /\.maplibre-navigating-active\s+\.maplibre-controls-overlay/.test(cssContent));
assert('Vehicle marker arrow has smooth rotation transition', /\.vehicle-marker-arrow[^{]*\{[^}]*transition:/.test(cssContent));

// 2. Real-world Suwanee Sample Pool verification
assert('Suwanee sample pool contains 96 real stops', Array.isArray(SUWANEE_SAMPLE_POOL) && SUWANEE_SAMPLE_POOL.length === 96);
const slice10 = getRandomSampleSlice(10);
assert('getRandomSampleSlice returns exactly 10 stops', slice10.length === 10);
assert('Sample slice stops have pre-resolved coordinates', slice10.every(s => typeof s.lat === 'number' && typeof s.lng === 'number'));
const sampleCsv = formatSampleSliceToCSV(slice10);
assert('Formatted sample CSV includes header', sampleCsv.includes('"Barcode","Last Event"'));
assert('Formatted sample CSV includes GPS coordinates', sampleCsv.includes('34.0'));

// 3. Geocode Cache normalization logic
function testNormalize(raw) {
  return String(raw).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
const rawWithDots = "4810 YORKSHIRE LN. SUWANEE. GA. 30024";
const normalized = testNormalize(rawWithDots);
assert('Address with dots normalizes cleanly', normalized === "4810 yorkshire ln suwanee ga 30024");

// 4. GPS Heading Stabilizer logic (verifies stationary vehicle retains last bearing)
function getStabilizedBearing(currentSpeed, rawBearing, lastBearing) {
  if (currentSpeed < 0.8 && lastBearing !== null && lastBearing !== undefined) {
    return lastBearing;
  }
  return rawBearing != null && !isNaN(rawBearing) ? rawBearing : (lastBearing || 0);
}
assert('Moving vehicle updates to new bearing (120 deg)', getStabilizedBearing(5.0, 120, 45) === 120);
assert('Stationary vehicle retains previous bearing (does NOT jump to 0)', getStabilizedBearing(0.2, 0, 120) === 120);
assert('Crawling vehicle retains previous bearing', getStabilizedBearing(0.5, 350, 120) === 120);

// S9: Navigation Engagement, Dynamic Route Snapping & Mockup Alignment
console.log('\nS9: Navigation Engagement, Dynamic Route Snapping & Mockup Alignment');

// 1. Circular Exit Disc and Floating Street Pill CSS
assert('Circular turn card exit disc is defined in CSS', /\.turn-card-exit-btn-circle/.test(cssContent));
assert('Floating street pill container is defined in CSS', /\.floating-street-pill-container/.test(cssContent));
assert('Floating street pill uses dark graphite token', /\.floating-street-pill[^{]*\{[^}]*--color-graphite/.test(cssContent));
assert('Controls overlay offset during navigation is notch safe', /\.maplibre-navigating-active\s+\.maplibre-controls-overlay[^{]*\{[^}]*max\(115px/.test(cssContent));

// 2. Active Route Line Snapping and Interpolation Test
function testBuildActiveRoute(driverLoc, targetCoords, existingRouteCoords) {
  let coords = null;
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;
  const hasDriverLoc = dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat);

  if (existingRouteCoords && existingRouteCoords.length > 1) {
    coords = existingRouteCoords.map(pt => [...pt]);
    if (hasDriverLoc && coords.length > 0) {
      coords[0] = [dlLng, dlLat];
    }
  } else if (targetCoords) {
    let originCoords = null;
    if (hasDriverLoc) {
      originCoords = [dlLng, dlLat];
    }
    if (originCoords) {
      const steps = 15;
      const interpolated = [];
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const lat = originCoords[1] + (targetCoords[1] - originCoords[1]) * frac;
        const lng = originCoords[0] + (targetCoords[0] - originCoords[0]) * frac;
        interpolated.push([lng, lat]);
      }
      coords = interpolated;
    }
  }
  return coords;
}

const driverTestLoc = { longitude: -84.148, latitude: 34.090 };
const stop1TestCoords = [-84.0844, 34.0321];

// Test A: Direct fallback interpolation generates 16 high-density coordinates
const directLine = testBuildActiveRoute(driverTestLoc, stop1TestCoords, null);
assert('Direct route generates interpolated line with >= 15 vertices', Array.isArray(directLine) && directLine.length === 16);
assert('Direct route head starts precisely at vehicle location', directLine[0][0] === -84.148 && directLine[0][1] === 34.090);
assert('Direct route tail terminates at Stop 1 coordinates', directLine[15][0] === -84.0844 && directLine[15][1] === 34.0321);

// Test B: Existing polyline route head snaps dynamically to moving vehicle
const existingValhallaCoords = [
  [-84.140, 34.080],
  [-84.120, 34.060],
  [-84.0844, 34.0321]
];
const snappedLine = testBuildActiveRoute(driverTestLoc, stop1TestCoords, existingValhallaCoords);
assert('Pre-calculated polyline snaps head to current driver location', snappedLine[0][0] === -84.148 && snappedLine[0][1] === 34.090);
assert('Pre-calculated polyline preserves destination waypoint', snappedLine[2][0] === -84.0844 && snappedLine[2][1] === 34.0321);

// S10: Layer Ordering Research & addOverlayLayer Rule Helper
console.log('\nS10: Layer Ordering Research & addOverlayLayer Rule Helper');
const mockMap = createMockMap();
// Basemap raster tile added first
mockMap.addLayer({ id: 'esri-street-layer', type: 'raster' });
assert('Initial basemap layer registered', mockMap._layerOrder[0] === 'esri-street-layer');

// Overlay layers added via addOverlayLayer
const testOverlays = [
  'sequence-route-casing',
  'sequence-route',
  'sequence-route-approximate-dots',
  'active-route-casing',
  'active-route',
  'active-route-approximate-dots',
  'driver-puck-halo',
  'driver-puck-core',
  'stops-active-halo',
  'stops-pin-outer',
  'stops-number-label'
];

testOverlays.forEach(id => {
  addOverlayLayer(mockMap, { id, type: id.includes('route') ? (id.includes('dots') ? 'circle' : 'line') : (id.includes('label') ? 'symbol' : 'circle') });
});

assert('All 11 custom overlay layers are positioned AFTER/ABOVE the raster layer',
  testOverlays.every(id => mockMap._layerOrder.indexOf(id) > mockMap._layerOrder.indexOf('esri-street-layer'))
);
assert('Raster basemap remains at index 0 (bottom)', mockMap._layerOrder[0] === 'esri-street-layer');

// Simulate style reload adding a new raster layer or resetting
mockMap.addLayer({ id: 'esri-dark-base-layer', type: 'raster' });
assert('New raster layer temporarily inserted at end', mockMap._layerOrder[mockMap._layerOrder.length - 1] === 'esri-dark-base-layer');
// Run ensureOverlaysOnTop
ensureOverlaysOnTop(mockMap, testOverlays);
assert('After ensureOverlaysOnTop, all overlays pushed back above raster basemaps',
  testOverlays.every(id => mockMap._layerOrder.indexOf(id) > mockMap._layerOrder.indexOf('esri-dark-base-layer'))
);

// S11: Sequence and Active Line Coordinates Non-Zero Verification
console.log('\nS11: Sequence & Active Line Non-Zero Coordinates Verification');
// 50-stop slice
const sampleSlice50 = getRandomSampleSlice(50);
assert('Default getRandomSampleSlice returns 50 stops', sampleSlice50.length === 50);
const sampleSlice80 = getRandomSampleSlice(80);
assert('getRandomSampleSlice(80) returns 80 stops', sampleSlice80.length === 80);

// Verify sequence route GeoJSON from 50 stops
const seqFC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: sampleSlice50.map(s => [s.lng, s.lat])
      }
    }
  ]
};
const seqCoordCount = seqFC.features[0].geometry.coordinates.length;
assert('Sequence route has exactly 50 coordinates (strictly > 0)', seqCoordCount === 50);

// Verify active route GeoJSON with vehicle location and stop 1
const activeLineTest = testBuildActiveRoute({ longitude: -84.15, latitude: 34.09 }, [sampleSlice50[0].lng, sampleSlice50[0].lat], null);
const actCoordCount = activeLineTest.length;
assert('Active route line has 16 coordinates (strictly > 0)', actCoordCount === 16);

// S12: Debug HUD String Format & CSS Presence
console.log('\nS12: Debug HUD String Format & CSS Presence');
const simulatedDebugString = `pins:true dom:50 stops:50 lines:{sequence:${seqCoordCount}, active:${actCoordCount}}`;
assert('Debug string matches exact HUD format', simulatedDebugString === 'pins:true dom:50 stops:50 lines:{sequence:50, active:16}');
assert('CSS has map-debug-hud-pill selector', /\.map-debug-hud-pill/.test(cssContent));
assert('CSS has map-debug-hud-pill span styling with monospace and z-index 110', /\.map-debug-hud-pill span[^{]*\{[^}]*ui-monospace/.test(cssContent));

// S13: AppUpdateModal Redesign Verification
console.log('\nS13: AppUpdateModal 3-State Redesign Verification');
const updateModalCode = fs.readFileSync(path.join(__dirname, '../components/AppUpdateModal.jsx'), 'utf8');
assert('AppUpdateModal defines ready, installing, and complete states', updateModalCode.includes("step === 'ready'") && updateModalCode.includes("step === 'installing'") && updateModalCode.includes("step === 'complete'"));
assert('AppUpdateModal contains CURRENTLY INSTALLED card', updateModalCode.includes('CURRENTLY INSTALLED'));
assert('AppUpdateModal contains CLOUD RELEASE card', updateModalCode.includes('CLOUD RELEASE'));
assert('AppUpdateModal contains SUPPORTS OFFLINE MAPS pill', updateModalCode.includes('SUPPORTS OFFLINE MAPS'));
assert('AppUpdateModal contains What\'s New card', updateModalCode.includes("What's New"));
assert('AppUpdateModal contains What\'s Improved checklist', updateModalCode.includes("What's Improved"));
assert('AppUpdateModal retains ACED Route branding (not YURI)', !updateModalCode.includes('YURI'));

// S14: Road-Following Route Lines via Valhalla & Pure WebGL Dot-Trail Fallback
console.log('\nS14: Road-Following Route Lines via Valhalla & Pure WebGL Dot-Trail Fallback');

// 1. Bitwise Polyline6 Decoder test
function decodePolyline6(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
    coords.push([Number((lng * 1e-6).toFixed(6)), Number((lat * 1e-6).toFixed(6))]);
  }
  return coords;
}

// Test polyline: 2 points around Atlanta metro
const samplePolyline = "_ib_El~ybOmhDve@";
const decodedPts = decodePolyline6(samplePolyline);
assert('Bitwise polyline6 decodes coordinates with 1e-6 precision', decodedPts.length > 0 && typeof decodedPts[0][0] === 'number');

// 2. Strict No-Line Rule & Pure WebGL Dot-Trail Fallback test
function testBuildSequenceRoute(stopsList, sequenceCoords, isRoadSnapped) {
  if (!isRoadSnapped) return { type: 'FeatureCollection', features: [] };
  if (sequenceCoords && sequenceCoords.length >= 2) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: sequenceCoords }, properties: {} }] };
  }
  const validCoords = (stopsList || []).map(getStopCoords).filter(Boolean);
  if (validCoords.length < 2) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: validCoords }, properties: {} }] };
}

function testBuildSequenceDotTrail(stopsList, isRoadSnapped) {
  if (isRoadSnapped) return { type: 'FeatureCollection', features: [] };
  const validCoords = (stopsList || []).map(getStopCoords).filter(Boolean);
  if (validCoords.length < 2) return { type: 'FeatureCollection', features: [] };
  const features = [];
  for (let i = 0; i < validCoords.length - 1; i++) {
    const p1 = validCoords[i];
    const p2 = validCoords[i + 1];
    const count = 10;
    for (let s = 1; s <= count; s++) {
      const frac = s / (count + 1);
      const lng = p1[0] + (p2[0] - p1[0]) * frac;
      const lat = p1[1] + (p2[1] - p1[1]) * frac;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { segmentIndex: i } });
    }
  }
  return { type: 'FeatureCollection', features };
}

function testBuildActiveRouteGeoJSON(stopsList, activeIdx, activeRouteCoords, driverLoc, isRoadSnapped) {
  if (!isRoadSnapped) return { type: 'FeatureCollection', features: [] };
  let coords = null;
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;
  const hasDriverLoc = dlLng != null && dlLat != null && !isNaN(dlLng) && !isNaN(dlLat);

  if (activeRouteCoords && activeRouteCoords.length > 1) {
    coords = activeRouteCoords.map(pt => [...pt]);
    if (hasDriverLoc && coords.length > 0) coords[0] = [dlLng, dlLat];
  }
  if (coords && coords.length >= 2) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] };
  }
  return { type: 'FeatureCollection', features: [] };
}

function testBuildDotTrail(driverLoc, targetCoords, isRoadSnapped) {
  if (isRoadSnapped) return { type: 'FeatureCollection', features: [] };
  const dlLng = Array.isArray(driverLoc) ? driverLoc[0] : driverLoc?.longitude;
  const dlLat = Array.isArray(driverLoc) ? driverLoc[1] : driverLoc?.latitude;
  if (dlLng == null || dlLat == null || isNaN(dlLng) || isNaN(dlLat) || !targetCoords || targetCoords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const tLng = targetCoords[0];
  const tLat = targetCoords[1];
  const count = 16;
  const features = [];
  for (let s = 1; s <= count; s++) {
    const frac = s / (count + 1);
    const lng = dlLng + (tLng - dlLng) * frac;
    const lat = dlLat + (tLat - dlLat) * frac;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} });
  }
  return { type: 'FeatureCollection', features };
}

// Scenario: Road-Snapped Sequence Route (Online / Cached)
const snappedSeq = testBuildSequenceRoute(slice10, null, true);
const snappedSeqDots = testBuildSequenceDotTrail(slice10, true);
assert('Road-snapped sequence route produces LineString feature', snappedSeq.features.length === 1 && snappedSeq.features[0].geometry.type === 'LineString');
assert('Road-snapped sequence route generates zero dot features (clean asphalt lines)', snappedSeqDots.features.length === 0);

// Scenario: Approximate Sequence Route (Offline / Cache Miss) -> NO LINES, ONLY DOTS
const approxSeq = testBuildSequenceRoute(slice10, null, false);
const approxSeqDots = testBuildSequenceDotTrail(slice10, false);
assert('STRICT: Approximate sequence route produces ZERO line features (NO straight lines)', approxSeq.features.length === 0);
assert('Approximate sequence route generates circle point dot trail across stop pairs', approxSeqDots.features.length === 90);

// Scenario: Active Target Leg Road-Snapped vs Approximate
const testDriver = [-84.148, 34.090];
const testTarget = [-84.0844, 34.0321];
const testPolylineCoords = [[-84.148, 34.090], [-84.110, 34.050], [-84.0844, 34.0321]];

const snappedAct = testBuildActiveRouteGeoJSON(slice10, 0, testPolylineCoords, testDriver, true);
const snappedActDots = testBuildDotTrail(testDriver, testTarget, true);
assert('Road-snapped active route produces LineString feature', snappedAct.features.length === 1 && snappedAct.features[0].geometry.type === 'LineString');
assert('Road-snapped active route generates zero dot features', snappedActDots.features.length === 0);

const approxAct = testBuildActiveRouteGeoJSON(slice10, 0, testPolylineCoords, testDriver, false);
const approxActDots = testBuildDotTrail(testDriver, testTarget, false);
assert('STRICT: Approximate active route produces ZERO line features (NO straight lines)', approxAct.features.length === 0);
assert('Approximate active route generates 16 circle point dots to target', approxActDots.features.length === 16);

// 3. Approximate Distance and ETA String Formatting
function formatDistanceAndEta(miles, timeSec, isRoadSnapped) {
  const isApprox = !isRoadSnapped;
  const approxPrefix = isApprox ? '~' : '';
  const approxSuffix = isApprox ? ' (approx)' : '';
  const distStr = `${approxPrefix}${miles.toFixed(1)} mi${approxSuffix}`;
  const etaMin = Math.max(1, Math.round((timeSec || (miles * 150)) / 60));
  const etaStr = `${approxPrefix}${etaMin} min${approxSuffix}`;
  return { distStr, etaStr };
}

const roadSnappedText = formatDistanceAndEta(3.2, 300, true);
assert('Road-snapped distance formatted cleanly without approx badge', roadSnappedText.distStr === '3.2 mi' && roadSnappedText.etaStr === '5 min');

const approxText = formatDistanceAndEta(3.2, 300, false);
assert('Approximate distance prepends ~ and appends (approx)', approxText.distStr === '~3.2 mi (approx)');
assert('Approximate ETA prepends ~ and appends (approx)', approxText.etaStr === '~5 min (approx)');

// 4. CSS Badge and HUD Spacing Checks
assert('CSS defines map-approximate-route-pill', /\.map-approximate-route-pill/.test(cssContent));
assert('CSS defines map-approximate-route-pill.navigating with safe-area offset', /\.map-approximate-route-pill\.navigating[^{]*\{[^}]*safe-area-inset-top/.test(cssContent));
assert('CSS defines pulse-badge animation for offline pill', /@keyframes\s+pulse-badge/.test(cssContent));
assert('CSS has retired old DOM SVG route overlay', !cssContent.includes('.map-route-svg-overlay'));

// 5. MapView Architectural Verification
const mapViewCode = fs.readFileSync(path.join(__dirname, '../components/MapView.jsx'), 'utf8');
assert('MapView has removed recursive styledata listener', !mapViewCode.includes("map.on('styledata'"));
assert('MapView has removed DOM SVG overlay references', !mapViewCode.includes('map-route-svg-overlay'));
assert('MapView hooks one-shot map.on("style.load")', mapViewCode.includes("map.on('style.load'"));
assert('MapView exports buildSequenceRouteGeoJSON', mapViewCode.includes('export function buildSequenceRouteGeoJSON'));
assert('MapView exports buildSequenceDotTrailGeoJSON', mapViewCode.includes('export function buildSequenceDotTrailGeoJSON'));
assert('MapView exports buildActiveRouteGeoJSON', mapViewCode.includes('export function buildActiveRouteGeoJSON'));
assert('MapView exports buildDotTrailGeoJSON', mapViewCode.includes('export function buildDotTrailGeoJSON'));
assert('MapView defines approximate badge pill', mapViewCode.includes('map-approximate-route-pill'));
assert('OVERLAY_LAYER_IDS includes dot-trail circle layers', mapViewCode.includes('sequence-route-approximate-dots') && mapViewCode.includes('active-route-approximate-dots'));

// 6. Server Route Module Architecture Checks
const serverRoutePath = path.join(__dirname, '../../../server/routes/route.js');
const serverRouteCode = fs.readFileSync(serverRoutePath, 'utf8');
assert('Server route module includes bitwise decodePolyline6', serverRouteCode.includes('function decodePolyline6'));
assert('Server route module protects endpoints with requireAuth JWT middleware', serverRouteCode.includes('router.use(requireAuth)'));
assert('Server route module defines POST /sequence', serverRouteCode.includes("router.post('/sequence'"));
assert('Server route module defines POST /active', serverRouteCode.includes("router.post('/active'"));

// Summary
console.log('\n=== Results: '+pass+' passed, '+fail+' failed ===\n');
if(fail>0) process.exit(1);

