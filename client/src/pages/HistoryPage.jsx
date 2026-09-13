import React, { useState, useEffect } from 'react';
import { Clock, Calendar, CheckCircle2, ChevronRight, AlertCircle, RefreshCw, Play } from 'lucide-react';
import { api } from '../services/api';

export default function HistoryPage({ onResumeRoute }) {
  const [manifests, setManifests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadManifests();
  }, []);

  const loadManifests = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getManifests();
      setManifests(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load manifests');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-green">Completed</span>;
      case 'in_progress':
        return <span className="badge badge-blue">In Progress</span>;
      case 'sequenced':
        return <span className="badge badge-yellow">Sequenced</span>;
      default:
        return <span className="badge badge-gray">{status || 'Uploaded'}</span>;
    }
  };

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 className="card-title">
              <Clock size={20} color="#38bdf8" /> Manifest History
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Your past manifests and active delivery runs.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadManifests}>
            <RefreshCw size={14} />
          </button>
        </div>

        {error && (
          <div style={{ background: 'rgba(220, 38, 38, 0.15)', padding: '0.75rem', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            Loading manifests...
          </div>
        ) : manifests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
            No manifests found. Upload a manifest to begin.
          </div>
        ) : (
          <div>
            {manifests.map((m) => {
              const dateStr = m.routeDate
                ? new Date(m.routeDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                : 'Date unknown';
              const stopsCount = m.stops?.length || 0;
              const deliveredCount = m.stops?.filter((s) => s.status === 'delivered' || s.completedAt).length || 0;

              return (
                <div
                  key={m._id}
                  className="card"
                  style={{
                    background: '#0f172a',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                    marginBottom: '0.75rem'
                  }}
                  onClick={() => onResumeRoute(m)}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <Calendar size={16} color="#38bdf8" />
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{dateStr}</span>
                      {getStatusBadge(m.status)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      {stopsCount} stops • {deliveredCount} delivered
                    </div>
                  </div>

                  <button className="btn btn-secondary btn-sm" style={{ gap: '0.35rem' }}>
                    <Play size={12} />
                    <span>Open</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
