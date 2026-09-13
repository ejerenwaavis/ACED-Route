import React, { useState } from 'react';
import {
  UploadCloud,
  FileText,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  SlidersHorizontal,
  MapPin,
  ListOrdered,
  Layers
} from 'lucide-react';
import {
  parseManifestContent,
  buildStopsFromRows,
  SAMPLE_MANIFEST_CSV
} from '../utils/manifestParser';
import { api } from '../services/api';

export default function UploadPage({ onManifestUploaded }) {
  const [file, setFile] = useState(null);
  const [rawText, setRawText] = useState('');
  const [routeDate, setRouteDate] = useState(new Date().toISOString().split('T')[0]);
  const [parsedStops, setParsedStops] = useState([]);
  const [fields, setFields] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [showMapping, setShowMapping] = useState(false);
  const [sortBySeq, setSortBySeq] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPaste, setShowPaste] = useState(false);

  const applyParsedResult = (result, autoSort = false) => {
    setFields(result.fields || []);
    setRawRows(result.rawRows || []);
    setColumnMapping(result.mapping || {});

    let stops = result.stops || [];
    const hasSeq = Boolean(result.mapping && result.mapping.seqCol);
    if (hasSeq) {
      setSortBySeq(true);
      stops = [...stops].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    } else {
      setSortBySeq(false);
    }
    setParsedStops(stops);
    setShowMapping(true);
  };

  // Parse file input
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setError(null);
    try {
      const text = await selectedFile.text();
      const result = await parseManifestContent(text);
      if (!result.stops.length) throw new Error('No valid stops found in this CSV.');
      applyParsedResult(result);
    } catch (err) {
      setError(err.message || 'Failed to parse manifest file.');
    }
  };

  // Parse pasted raw text
  const handleParseText = async () => {
    if (!rawText.trim()) return;
    setError(null);
    try {
      const result = await parseManifestContent(rawText);
      if (!result.stops.length) throw new Error('No valid stops found in pasted content.');
      applyParsedResult(result);
    } catch (err) {
      setError(err.message || 'Failed to parse manifest content.');
    }
  };

  // Load sample manifest for quick testing
  const handleLoadSample = async () => {
    setRawText(SAMPLE_MANIFEST_CSV);
    const result = await parseManifestContent(SAMPLE_MANIFEST_CSV);
    applyParsedResult(result);
    setShowPaste(true);
    setError(null);
  };

  // User manually changes a column mapping in the UI
  const handleMappingChange = (key, value) => {
    const updatedMapping = { ...columnMapping, [key]: value };
    setColumnMapping(updatedMapping);

    let updatedStops = buildStopsFromRows(rawRows, fields, updatedMapping);
    if (sortBySeq && updatedMapping.seqCol) {
      updatedStops = [...updatedStops].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }
    setParsedStops(updatedStops);
  };

  // Toggle sequence sorting
  const handleToggleSort = (checked) => {
    setSortBySeq(checked);
    if (checked && columnMapping.seqCol) {
      setParsedStops([...parsedStops].sort((a, b) => (a.sequence || 0) - (b.sequence || 0)));
    } else if (!checked) {
      // Restore natural file order
      const naturalStops = buildStopsFromRows(rawRows, fields, columnMapping);
      setParsedStops(naturalStops);
    }
  };

  // Submit to POST /api/manifest
  const handleSubmit = async () => {
    if (!parsedStops.length) {
      setError('Please provide at least one stop.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payloadStops = parsedStops.map((s) => ({
        trackingNumber: s.trackingNumber,
        address: s.address,
        coordinates: s.coordinates,
        status: s.status || 'pending'
      }));
      const createdManifest = await api.uploadManifest(routeDate, payloadStops);
      onManifestUploaded(createdManifest);
    } catch (err) {
      setError(err.message || 'Failed to upload and geocode manifest.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2 className="card-title">
              <UploadCloud size={22} color="#38bdf8" /> Upload Today's Manifest
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Adaptive parser auto-detects barcodes, delivery addresses, scanned GPS coordinates, and stop sequences from any carrier or dispatch CSV.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleLoadSample}>
            <Sparkles size={14} color="#f59e0b" />
            <span>Sample Route</span>
          </button>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220, 38, 38, 0.15)',
            border: '1px solid rgba(220, 38, 38, 0.4)',
            color: '#f87171',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem'
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Route Date Field */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            Route Date:
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={18} color="#94a3b8" />
            <input
              type="date"
              value={routeDate}
              onChange={(e) => setRouteDate(e.target.value)}
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#fff',
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                fontSize: '0.9rem'
              }}
            />
          </div>
        </div>

        {/* Upload Mode Selector */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            className={`btn btn-sm ${!showPaste ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowPaste(false)}
          >
            File Upload (CSV)
          </button>
          <button
            className={`btn btn-sm ${showPaste ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowPaste(true)}
          >
            Paste Text
          </button>
        </div>

        {!showPaste ? (
          <div
            className="dropzone"
            onClick={() => document.getElementById('manifestFileInput').click()}
          >
            <input
              id="manifestFileInput"
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <UploadCloud size={36} color="#38bdf8" style={{ margin: '0 auto 0.5rem' }} />
            <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
              {file ? file.name : 'Tap to select a Manifest CSV file'}
            </p>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Supports OnTrac, Amazon, FedEx, UPS, LaserShip, or custom dispatch spreadsheets
            </p>
          </div>
        ) : (
          <div>
            <textarea
              rows={5}
              placeholder="Paste comma/tab-separated manifest rows here..."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              style={{
                width: '100%',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '0.75rem',
                color: '#fff',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                marginBottom: '0.5rem'
              }}
            />
            <button className="btn btn-secondary btn-sm" onClick={handleParseText}>
              Parse Pasted Stops
            </button>
          </div>
        )}

        {/* Column Mapping Selector (Displayed once a file or content is loaded) */}
        {fields.length > 0 && (
          <div style={{
            marginTop: '1.25rem',
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '10px',
            padding: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', color: '#f8fafc' }}>
                <SlidersHorizontal size={16} color="#38bdf8" />
                <span>Column Mapping (Auto-Detected)</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                onClick={() => setShowMapping(!showMapping)}
              >
                {showMapping ? 'Hide Columns' : 'Inspect Columns'}
              </button>
            </div>

            {showMapping && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
                {/* Tracking / Barcode */}
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                    Barcode / Tracking:
                  </label>
                  <select
                    value={columnMapping.trackingCol || ''}
                    onChange={(e) => handleMappingChange('trackingCol', e.target.value)}
                    style={{
                      width: '100%',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      color: '#38bdf8',
                      padding: '0.45rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem'
                    }}
                  >
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Delivery Address */}
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                    Delivery Address:
                  </label>
                  <select
                    value={columnMapping.addressCol || ''}
                    onChange={(e) => handleMappingChange('addressCol', e.target.value)}
                    style={{
                      width: '100%',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      color: '#4ade80',
                      padding: '0.45rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem'
                    }}
                  >
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Scanned GPS Coordinates */}
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                    Scanned GPS Coordinates:
                  </label>
                  <select
                    value={columnMapping.gpsCol || ''}
                    onChange={(e) => handleMappingChange('gpsCol', e.target.value)}
                    style={{
                      width: '100%',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      color: '#f59e0b',
                      padding: '0.45rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem'
                    }}
                  >
                    <option value="">(None / Geocode by Address)</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Sequence Number */}
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
                    Manifest Sequence Order:
                  </label>
                  <select
                    value={columnMapping.seqCol || ''}
                    onChange={(e) => handleMappingChange('seqCol', e.target.value)}
                    style={{
                      width: '100%',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      color: '#a78bfa',
                      padding: '0.45rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem'
                    }}
                  >
                    <option value="">(None / As Uploaded)</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Sequence sorting toggle */}
            {columnMapping.seqCol && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="sortSeqCheck"
                  checked={sortBySeq}
                  onChange={(e) => handleToggleSort(e.target.checked)}
                  style={{ accentColor: '#38bdf8', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="sortSeqCheck" style={{ fontSize: '0.82rem', color: '#e2e8f0', cursor: 'pointer' }}>
                  Sort stops in original delivery sequence (<strong>{columnMapping.seqCol}</strong>)
                </label>
              </div>
            )}
          </div>
        )}

        {/* Parsed Stops Preview */}
        {parsedStops.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <CheckCircle2 size={16} color="#4ade80" />
                <span>Found {parsedStops.length} Stops Ready for Import</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <span className="badge badge-blue">{parsedStops.length} stops</span>
                {columnMapping.gpsCol && (
                  <span className="badge" style={{ background: '#065f46', color: '#34d399' }}>GPS Coordinates Active</span>
                )}
              </div>
            </div>

            <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #334155', borderRadius: '8px' }}>
              <table className="preview-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    {columnMapping.seqCol && <th style={{ width: '60px' }}>Seq</th>}
                    <th>Tracking / Barcode</th>
                    <th>Delivery Address</th>
                    <th>Scanned GPS / Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedStops.map((stop, i) => (
                    <tr key={i}>
                      <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                      {columnMapping.seqCol && (
                        <td style={{ color: '#a78bfa', fontWeight: 600, fontSize: '0.8rem' }}>
                          #{stop.sequence}
                        </td>
                      )}
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {stop.trackingNumber}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {stop.address}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {stop.coordinates ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                              fontSize: '0.72rem',
                              background: '#14532d',
                              color: '#86efac',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '4px',
                              fontFamily: 'monospace'
                            }}>
                              <MapPin size={11} />
                              {stop.coordinates[1].toFixed(4)}, {stop.coordinates[0].toFixed(4)}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Google Geocode</span>
                          )}

                          {stop.status === 'delivered' && (
                            <span style={{
                              fontSize: '0.7rem',
                              background: '#065f46',
                              color: '#6ee7b7',
                              padding: '0.1rem 0.35rem',
                              borderRadius: '4px',
                              fontWeight: 600
                            }}>
                              Delivered
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={handleSubmit}
              disabled={loading}
              style={{ marginTop: '1.25rem' }}
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Processing & Saving Manifest...</span>
                </>
              ) : (
                <>
                  <UploadCloud size={20} />
                  <span>Save Manifest & Generate Route ({parsedStops.length} Stops)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

