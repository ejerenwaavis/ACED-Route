import Papa from 'papaparse';

/**
 * Parse CSV / TSV text or file and extract trackingNumber and address pairs.
 */
export function parseManifestContent(csvString) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvString, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const stops = [];
          const fields = results.meta.fields || [];

          // Find tracking column
          const trackingCol = fields.find((f) =>
            /track|barcode|package|pkg|label|id/i.test(f)
          ) || fields[0];

          // Find address column(s)
          const addressCol = fields.find((f) =>
            /address|street|dest|location|stop/i.test(f)
          );
          const cityCol = fields.find((f) => /city/i.test(f));
          const stateCol = fields.find((f) => /state/i.test(f));
          const zipCol = fields.find((f) => /zip|postal/i.test(f));

          for (const row of results.data) {
            let address = '';
            if (addressCol && row[addressCol]) {
              address = row[addressCol].trim();
              if (cityCol && row[cityCol]) address += `, ${row[cityCol].trim()}`;
              if (stateCol && row[stateCol]) address += ` ${row[stateCol].trim()}`;
              if (zipCol && row[zipCol]) address += ` ${row[zipCol].trim()}`;
            } else {
              // Join all non-tracking columns
              address = Object.entries(row)
                .filter(([k]) => k !== trackingCol)
                .map(([, v]) => v)
                .filter(Boolean)
                .join(', ')
                .trim();
            }

            const trackingNumber = (trackingCol && row[trackingCol])
              ? String(row[trackingCol]).trim()
              : `PKG-${Math.floor(100000 + Math.random() * 900000)}`;

            if (address) {
              stops.push({ trackingNumber, address });
            }
          }

          resolve(stops);
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
