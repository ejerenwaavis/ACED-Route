const Address = require('../models/Address');

function normalize(raw) {
  return raw
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the Address doc for a raw address string, geocoding via Google
 * only if it hasn't been seen before. This is the "geocode once, reuse
 * forever" cache every app should call through — never geocode directly
/**
 * Returns the Address doc for a raw address string.
 * If scanned coordinates [lng, lat] are provided (e.g. from scanner GPS),
 * uses them directly to save API quota and preserve ground-truth accuracy.
 * Otherwise geocodes via Google Maps API only if unseen.
 */
async function getOrGeocodeAddress(rawAddress, coordinates) {
  const normalizedAddress = normalize(rawAddress);

  // Normalize coordinates if passed as object { lat, lng }
  let validCoords = null;
  if (Array.isArray(coordinates) && coordinates.length === 2 && !isNaN(coordinates[0]) && !isNaN(coordinates[1])) {
    validCoords = [Number(coordinates[0]), Number(coordinates[1])]; // [lng, lat]
  } else if (coordinates && typeof coordinates === 'object' && coordinates.lat !== undefined && coordinates.lng !== undefined) {
    validCoords = [Number(coordinates.lng), Number(coordinates.lat)];
  }

  let addr = await Address.findOne({ normalizedAddress });
  if (addr) {
    // If address previously had no coordinates or placeholder, and we now have real GPS, update it!
    if (validCoords && (!addr.location || !addr.location.coordinates || addr.geocodeSource === 'no_api_key')) {
      addr.location = { type: 'Point', coordinates: validCoords };
      addr.geocodeSource = 'scanned_gps';
      await addr.save();
    }
    return addr;
  }

  // If we already have scanned coordinates from the manifest, use them directly!
  if (validCoords) {
    return await Address.create({
      raw: rawAddress,
      normalizedAddress,
      street: rawAddress,
      location: {
        type: 'Point',
        coordinates: validCoords
      },
      geocodeSource: 'scanned_gps',
      geocodedAt: new Date()
    });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn(`[geocode] GOOGLE_MAPS_API_KEY not set; using placeholder coordinates for "${rawAddress}"`);
    return await Address.create({
      raw: rawAddress,
      normalizedAddress,
      street: rawAddress,
      location: {
        type: 'Point',
        coordinates: [-73.9851, 40.7488]
      },
      geocodeSource: 'no_api_key',
      geocodedAt: new Date()
    });
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    rawAddress
  )}&key=${key}`;

  const resp = await fetch(url);
  const data = await resp.json();

  if (data.status !== 'OK' || !data.results.length) {
    console.warn(`[geocode] Google geocode status: ${data.status} for "${rawAddress}"`);
    return await Address.create({
      raw: rawAddress,
      normalizedAddress,
      street: rawAddress,
      location: {
        type: 'Point',
        coordinates: [-73.9851, 40.7488]
      },
      geocodeSource: `error_${data.status}`,
      geocodedAt: new Date()
    });
  }

  const result = data.results[0];
  const components = {};
  for (const c of result.address_components) {
    if (c.types.includes('locality')) components.city = c.long_name;
    if (c.types.includes('administrative_area_level_1')) components.state = c.short_name;
    if (c.types.includes('postal_code')) components.postalCode = c.long_name;
    if (c.types.includes('country')) components.country = c.short_name;
  }

  addr = await Address.create({
    raw: rawAddress,
    normalizedAddress,
    street: result.formatted_address,
    ...components,
    location: {
      type: 'Point',
      coordinates: [result.geometry.location.lng, result.geometry.location.lat]
    },
    geocodeSource: 'google',
    geocodedAt: new Date()
  });

  return addr;
}

module.exports = { normalize, getOrGeocodeAddress };
