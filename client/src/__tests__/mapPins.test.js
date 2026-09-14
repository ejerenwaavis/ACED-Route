import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  const obj = stop.address || stop;
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
function createMockMap({ failAddSource=false }={}) {
  const sources={}, layers={};
  return { getSource:(id)=>sources[id]||null, addSource:(id,def)=>{ if(failAddSource) throw new Error('Style not loaded'); sources[id]=def; },
           getLayer:(id)=>layers[id]||null, addLayer:(def)=>{ layers[def.id]=def; }, _sources:sources, _layers:layers };
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

// Summary
console.log('\n=== Results: '+pass+' passed, '+fail+' failed ===\n');
if(fail>0) process.exit(1);
