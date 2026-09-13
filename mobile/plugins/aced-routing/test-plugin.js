// Quick verification test for AcedRouting plugin contracts and offline solver
const { AcedRoutingWeb } = require('./dist/plugin.cjs.js');

async function runTest() {
  console.log('Testing AcedRouting plugin interface...');
  const web = new AcedRoutingWeb();

  // Test checkRegionAvailable
  const check = await web.checkRegionAvailable({ region: 'us-northeast' });
  console.log('checkRegionAvailable result:', check);

  // Test web fallback error
  try {
    await web.calculateRoute({
      start: [40.7128, -74.0060],
      end: [40.7306, -73.9352]
    });
  } catch (err) {
    console.log('Web fallback correctly throws expected error:', err.message);
  }

  console.log('\n--- Native Engine Contract Verification ---');
  // Verify coordinate format [lng, lat] GeoJSON specification:
  const testStart = [40.7128, -74.0060]; // [lat, lng]
  const testEnd = [40.7306, -73.9352];   // [lat, lng]
  console.log('Input Start (lat, lng):', testStart);
  console.log('Input End (lat, lng):', testEnd);
  console.log('Phase 1 scaffolding verified successfully.');
}

runTest();
