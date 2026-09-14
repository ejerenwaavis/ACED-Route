import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Trash2,
  Copy,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Database,
  RefreshCw
} from 'lucide-react';
import { diagnosticLogger } from '../services/diagnosticLogger';

export default function SystemLogModal({ isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'error', 'warn', 'success'
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Initial fetch
    setLogs(diagnosticLogger.getLogs());

    // Subscribe to live log updates
    const unsubscribe = diagnosticLogger.subscribe(() => {
      setLogs(diagnosticLogger.getLogs());
    });

    return () => unsubscribe();
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter((log) => {
    if (filter === 'error') return log.level === 'error' || log.status === 404 || log.status === 500;
    if (filter === 'warn') return log.level === 'warn' || log.status === 'FALLBACK';
    if (filter === 'success') return log.level === 'success' || log.status === 'CACHE';
    return true;
  });

  const handleCopy = () => {
    const text = diagnosticLogger.exportLogsAsText();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    diagnosticLogger.downloadLogsFile();
  };

  const handleClear = async () => {
    if (window.confirm('Clear all stored system & network diagnostic logs?')) {
      await diagnosticLogger.clearLogs();
      setLogs([]);
    }
  };

  const getStatusBadge = (log) => {
    if (log.status === 'CACHE') {
      return (
        <span style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
          CACHE
        </span>
      );
    }
    if (log.status === 200 || log.level === 'success') {
      return (
        <span style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
          200 OK
        </span>
      );
    }
    if (log.status === 404) {
      return (
        <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
          404 ERR
        </span>
      );
    }
    if (log.status === 'FALLBACK' || log.level === 'warn') {
      return (
        <span style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
          FALLBACK
        </span>
      );
    }
    return (
      <span style={{ background: 'rgba(148, 163, 184, 0.2)', color: '#94a3b8', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
        {log.status || log.level.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '720px',
          width: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#17191C',
          border: '1px solid #2E3238',
          borderRadius: '16px',
          padding: '1.25rem',
          boxShadow: '0 20px 40px rgba(0,0,0,0.8)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={20} color="#F28C28" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>
              System & Routing Diagnostic Logs
            </h3>
            <span style={{ background: '#2E3238', color: '#94a3b8', fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '12px' }}>
              {logs.length} / 500 entries
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.25rem' }}
          >
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 0.75rem 0' }}>
          Persistent ring buffer of network calls, Valhalla routing queries, and fallback states.
        </p>

        {/* Action Controls Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', background: '#0f172a', padding: '0.5rem 0.75rem', borderRadius: '10px' }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {['all', 'error', 'warn', 'success'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? '#F28C28' : '#1e293b',
                  color: filter === f ? '#0f172a' : '#94a3b8',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.25rem 0.55rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize'
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Export / Clear buttons */}
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              onClick={handleCopy}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              title="Copy all logs to clipboard"
            >
              {copied ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="btn btn-primary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              title="Download text file of diagnostic logs"
            >
              <Download size={13} />
              <span>Download (.txt)</span>
            </button>
            <button
              onClick={handleClear}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', color: '#ef4444' }}
              title="Clear all logs"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Log Entries Container */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            background: '#090d16',
            borderRadius: '10px',
            border: '1px solid #1e293b',
            padding: '0.5rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '0.78rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            minHeight: '260px'
          }}
        >
          {filteredLogs.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', fontStyle: 'italic', padding: '2rem' }}>
              No diagnostic logs found matching filter '{filter}'
            </div>
          ) : (
            [...filteredLogs].reverse().map((log) => (
              <div
                key={log.id}
                style={{
                  background: '#131926',
                  borderRadius: '6px',
                  padding: '0.45rem 0.65rem',
                  borderLeft: `3px solid ${
                    log.level === 'error' || log.status === 404 ? '#ef4444' :
                    log.status === 'CACHE' ? '#38bdf8' :
                    log.level === 'warn' || log.status === 'FALLBACK' ? '#f59e0b' :
                    '#22c55e'
                  }`
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ color: '#64748b', fontSize: '0.72rem' }}>{log.timeStr}</span>
                    {getStatusBadge(log)}
                    <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{log.endpoint}</span>
                  </div>
                  {log.durationMs != null && (
                    <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{log.durationMs}ms</span>
                  )}
                </div>
                <div style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35 }}>
                  {log.summary}
                </div>
                {log.details && (
                  <div style={{ marginTop: '0.25rem', color: '#94a3b8', fontSize: '0.7rem', opacity: 0.85 }}>
                    <code>{JSON.stringify(log.details)}</code>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #2E3238' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Latest: {diagnosticLogger.getLastFetchOutcome()}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
