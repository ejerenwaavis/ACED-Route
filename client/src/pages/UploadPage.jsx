import React, { useState } from 'react';
import { UploadCloud, FileText, Calendar, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { parseManifestContent, SAMPLE_MANIFEST_CSV } from '../utils/manifestParser';
import { api } from '../services/api';

export default function UploadPage({ onManifestUploaded }) {
  const [file, setFile] = useState(null);
  const [rawText, setRawText] = useState('');
  const [routeDate, setRouteDate] = useState(new Date().toISOString().split('T')[0]);
  const [parsedStops, setParsedStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPaste, setShowPaste] = useState(false);

  // Parse file input
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setError(null);
    try {
      const text = await selectedFile.text();
      const stops = await parseManifestContent(text);
      if (!stops.length) throw new Error('No valid stops found in this CSV.');
      setParsedStops(stops);
    } catch (err) {
      setError(err.message || 'Failed to parse manifest file.');
    }
  };

  // Parse pasted raw text
  const handleParseText = async () => {
    if (!rawText.trim()) return;
    setError(null);
    try {
      const stops = await parseManifestContent(rawText);
      if (!stops.length) throw new Error('No valid stops found in pasted content.');
      setParsedStops(stops);
    } catch (err) {
      setError(err.message || 'Failed to parse manifest content.');
    }
  };

  // Load sample manifest for quick testing
  const handleLoadSample = async () => {
    setRawText(SAMPLE_MANIFEST_CSV);
    const stops = await parseManifestContent(SAMPLE_MANIFEST_CSV);
    setParsedStops(stops);
    setShowPaste(true);
    setError(null);
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
        address: s.address
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 className="card-title">
              <UploadCloud size={22} color="#38bdf8" /> Upload Today's Manifest
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Import stops from CSV/TSV or paste raw dispatch data. Addresses are deduplicated and geocoded automatically.
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
              Supports CSV with Tracking, Address, City, State, Zip columns
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

        {/* Parsed Stops Preview */}
        {parsedStops.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <CheckCircle2 size={16} color="#4ade80" />
                <span>Found {parsedStops.length} Stops Ready for Import</span>
              </div>
              <span className="badge badge-blue">{parsedStops.length} stops</span>
            </div>

            <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #334155', borderRadius: '8px' }}>
              <table className="preview-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Tracking / Package</th>
                    <th>Delivery Address</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedStops.map((stop, i) => (
                    <tr key={i}>
                      <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{stop.trackingNumber}</td>
                      <td>{stop.address}</td>
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
                  <span>Geocoding & Saving Manifest...</span>
                </>
              ) : (
                <>
                  <UploadCloud size={20} />
                  <span>Save Manifest & Generate Route</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
