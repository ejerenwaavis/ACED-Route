import Papa from 'papaparse';

/**
 * Parses GPS coordinates from formats like:
 * "34.087636093609035 -84.09498098306358"
 * "34.0876, -84.0949"
 * Returns [lng, lat] for GeoJSON / Mongo, or null if invalid.
 */
export function parseGpsCoordinates(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.trim();
  const match = cleaned.match(/^(-?\d{1,3}(?:\.\d+)?)[,\s/]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;

  const num1 = parseFloat(match[1]);
  const num2 = parseFloat(match[2]);
  if (isNaN(num1) || isNaN(num2)) return null;

  let lat, lng;
  if (Math.abs(num1) <= 90 && Math.abs(num2) <= 180) {
    lat = num1;
    lng = num2;
  } else if (Math.abs(num2) <= 90 && Math.abs(num1) <= 180) {
    lat = num2;
    lng = num1;
  } else {
    return null;
  }

  return [lng, lat]; // GeoJSON format: [longitude, latitude]
}

/**
 * Tests if a string looks like raw GPS coordinates instead of a street address
 */
export function isCoordinateString(str) {
  return parseGpsCoordinates(str) !== null;
}

/**
 * Tests if a string looks like a postal street address (contains numbers + street keywords)
 */
export function isStreetAddressString(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (isCoordinateString(s)) return false;
  const hasDigits = /\d/.test(s);
  const hasLetters = /[a-zA-Z]{2,}/.test(s);
  const hasStreetKeywords = /\b(rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace|trce|trace|loop|cir|circle|cove|trail|trl|run|sq|square|row|xing|crossing)\b/i.test(s);
  return (hasDigits && hasLetters) || hasStreetKeywords;
}

/**
 * Intelligent Column Detection
 * Inspects both header labels and first rows of data to detect tracking, address, gps, seq, and status.
 */
export function detectColumns(fields = [], sampleRows = []) {
  const cols = fields.map((f) => ({ raw: f, clean: f.trim().toLowerCase() }));

  // 1. Detect GPS / Scanned Coordinates Column (so it NEVER gets confused with address)
  let gpsCol = cols.find((c) =>
    /^(last\s*)?(gps|coord|coordinates|geo|geolocation|lat.*lng)/i.test(c.clean) ||
    /(gps\s*location|scan\s*coord|delivery\s*gps)/i.test(c.clean)
  )?.raw;

  if (!gpsCol && sampleRows.length > 0) {
    for (const c of cols) {
      const matchCount = sampleRows.filter((r) => isCoordinateString(r[c.raw])).length;
      if (matchCount >= Math.min(2, sampleRows.length)) {
        gpsCol = c.raw;
        break;
      }
    }
  }

  // 2. Detect Barcode / Tracking Number Column
  let trackingCol = cols.find((c) =>
    /^(barcode|tracking|tracking\s*#|tracking\s*no|tracking_no|tracking_number|trackingnumber|package_id|pkg_id|pkg\s*#|label_id|waybill|pro_number|pro\s*#)$/i.test(c.clean)
  )?.raw;

  if (!trackingCol) {
    trackingCol = cols.find((c) =>
      /(barcode|tracking|package|pkg|label|waybill)/i.test(c.clean) &&
      !/(gps|address|time|date|event|status|seq)/i.test(c.clean)
    )?.raw;
  }

  if (!trackingCol && cols.length > 0) {
    trackingCol = cols[0].raw;
  }

  // 3. Detect Delivery Address Column
  // Strictly EXCLUDE GPS column and coordinate columns!
  const addressCandidates = cols.filter(
    (c) =>
      c.raw !== gpsCol &&
      !/(gps|coord|coordinate|ip\b|mac\b|email|web|url|event|time|date|seq|status|barcode|track|pkg|package)/i.test(c.clean)
  );

  let addressCol = addressCandidates.find((c) =>
    /^(delivery\s*address|deliveryaddress|street\s*address|streetaddress|address\s*1|address1|dest\s*address|destination\s*address|ship\s*to\s*address|shiptoaddress|cust\s*address|customer\s*address)$/i.test(c.clean)
  )?.raw;

  if (!addressCol) {
    addressCol = addressCandidates.find((c) => /^address$/i.test(c.clean))?.raw;
  }

  if (!addressCol) {
    addressCol = addressCandidates.find((c) => /address/i.test(c.clean))?.raw;
  }

  if (!addressCol) {
    addressCol = addressCandidates.find((c) => /^(street|destination|dest)$/i.test(c.clean))?.raw;
  }

  // Value-based heuristic fallback: test rows for street addresses
  if (!addressCol && sampleRows.length > 0) {
    for (const c of addressCandidates) {
      const matchCount = sampleRows.filter((r) => isStreetAddressString(r[c.raw])).length;
      if (matchCount >= Math.min(2, sampleRows.length)) {
        addressCol = c.raw;
        break;
      }
    }
  }

  // 4. Secondary Address Components (if split)
  const cityCol = cols.find((c) => /^(city|town|locality)$/i.test(c.clean))?.raw;
  const stateCol = cols.find((c) => /^(state|province|region)$/i.test(c.clean))?.raw;
  const zipCol = cols.find((c) => /^(zip|zipcode|zip\s*code|postal|postal\s*code)$/i.test(c.clean))?.raw;

  // 5. Sequence Column (e.g. Seq No in OnTrac / Amazon manifests)
  const seqCol = cols.find((c) =>
    /^(seq|seq\s*no|seq_no|sequence|sequence\s*no|stop\s*no|stop\s*#|stop_number|run\s*order)$/i.test(c.clean)
  )?.raw;

  // 6. Delivery Status / Event Column (e.g. Last Event)
  const statusCol = cols.find((c) =>
    /^(last\s*event|status|delivery\s*status|event|state)$/i.test(c.clean)
  )?.raw;

  return {
    trackingCol: trackingCol || '',
    addressCol: addressCol || '',
    gpsCol: gpsCol || '',
    cityCol: cityCol || '',
    stateCol: stateCol || '',
    zipCol: zipCol || '',
    seqCol: seqCol || '',
    statusCol: statusCol || ''
  };
}

/**
 * Builds structured stops from rows based on mapping configuration
 */
export function buildStopsFromRows(rows, fields, mapping = {}) {
  const {
    trackingCol,
    addressCol,
    gpsCol,
    cityCol,
    stateCol,
    zipCol,
    seqCol,
    statusCol
  } = mapping;

  const stops = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // 1. Build delivery address
    let address = '';
    if (addressCol && row[addressCol]) {
      address = String(row[addressCol]).trim();
      if (cityCol && row[cityCol] && !address.toLowerCase().includes(row[cityCol].toLowerCase())) {
        address += `, ${row[cityCol].trim()}`;
      }
      if (stateCol && row[stateCol] && !address.toLowerCase().includes(row[stateCol].toLowerCase())) {
        address += ` ${row[stateCol].trim()}`;
      }
      if (zipCol && row[zipCol] && !address.includes(row[zipCol])) {
        address += ` ${row[zipCol].trim()}`;
      }
    } else {
      // Fallback: join columns that are not tracking, gps, status, or seq
      address = Object.entries(row)
        .filter(([k, v]) => {
          if (k === trackingCol || k === gpsCol || k === seqCol || k === statusCol) return false;
          if (isCoordinateString(v)) return false;
          return Boolean(v);
        })
        .map(([, v]) => String(v).trim())
        .join(', ')
        .trim();
    }

    // 2. Extract tracking number
    const trackingNumber = (trackingCol && row[trackingCol])
      ? String(row[trackingCol]).trim()
      : `PKG-${i + 1}`;

    // 3. Extract GPS coordinates if present
    let coordinates = null;
    if (gpsCol && row[gpsCol]) {
      coordinates = parseGpsCoordinates(row[gpsCol]);
    }

    // 4. Extract sequence number if present
    let seq = null;
    if (seqCol && row[seqCol] !== undefined && row[seqCol] !== null && row[seqCol] !== '') {
      const parsedSeq = parseFloat(row[seqCol]);
      if (!isNaN(parsedSeq)) seq = parsedSeq;
    }

    // 5. Extract delivery status
    let status = 'pending';
    if (statusCol && row[statusCol]) {
      const ev = String(row[statusCol]).toLowerCase();
      if (ev.includes('delivered') || ev.includes('complete')) {
        status = 'delivered';
      } else if (ev.includes('attempt') || ev.includes('skip')) {
        status = 'skipped';
      }
    }

    if (address || coordinates) {
      stops.push({
        trackingNumber,
        address: address || (coordinates ? `GPS: ${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}` : 'Unknown Address'),
        coordinates, // [lng, lat]
        sequence: seq !== null ? seq : i + 1,
        status,
        rawRow: row
      });
    }
  }

  return stops;
}

/**
 * Parse CSV / TSV text or file and extract structured stops.
 * Returns { stops, fields, mapping, rawRows }.
 */
export function parseManifestContent(csvString, customMapping = null) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const fields = results.meta.fields || [];
          const rows = results.data || [];

          if (!rows.length) {
            return resolve({ stops: [], fields, mapping: {}, rawRows: [] });
          }

          const sampleRows = rows.slice(0, 10);
          const detected = detectColumns(fields, sampleRows);
          const mapping = customMapping ? { ...detected, ...customMapping } : detected;
          const stops = buildStopsFromRows(rows, fields, mapping);

          resolve({
            stops,
            fields,
            mapping,
            rawRows: rows
          });
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(err)
    });
  });
}

export const SAMPLE_MANIFEST_CSV = `Tracking Number,Delivery Address,City,State,Zip
TRK8829101,350 5th Ave,New York,NY,10118
TRK8829102,45 Rockefeller Plaza,New York,NY,10111
TRK8829103,11 W 53rd St,New York,NY,10019
TRK8829104,89 E 42nd St,New York,NY,10017
TRK8829105,20 W 34th St,New York,NY,10001
TRK8829106,770 Broadway,New York,NY,10003`;
