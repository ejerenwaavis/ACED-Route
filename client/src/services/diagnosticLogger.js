/**
 * ACED Route — Client-Side Diagnostic Logging Service
 * Maintains a persistent ring buffer of up to 500 routing and network events
 * stored in IndexedDB (with localStorage fallback).
 *
 * Provides human-readable logging, HUD status reporting, and file export for troubleshooting.
 */

const DB_NAME = 'aced_routing_db';
const DB_VERSION = 2; // Incremented to add system_logs store alongside geometry_cache
const STORE_NAME = 'system_logs';
const LOCAL_STORAGE_KEY = 'aced_system_logs_v1';
const MAX_LOG_ENTRIES = 500;

// In-memory cache of log entries for synchronous reads and HUD reporting
let inMemoryLogs = [];
let isInitialized = false;
let lastFetchOutcome = 'none';
const subscribers = new Set();

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function openDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('geometry_cache')) {
          db.createObjectStore('geometry_cache', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Initialize logs from IndexedDB or localStorage
 */
async function initLogger() {
  if (isInitialized) return inMemoryLogs;
  try {
    const db = await openDB();
    if (db && db.objectStoreNames.contains(STORE_NAME)) {
      inMemoryLogs = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const res = req.result || [];
          // Keep most recent MAX_LOG_ENTRIES
          resolve(res.slice(-MAX_LOG_ENTRIES));
        };
        req.onerror = () => resolve([]);
      });
    } else if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        inMemoryLogs = JSON.parse(raw).slice(-MAX_LOG_ENTRIES);
      }
    }
  } catch (err) {
    console.warn('[diagnosticLogger] Failed to restore logs:', err.message);
    inMemoryLogs = [];
  }

  isInitialized = true;

  // Restore lastFetchOutcome from most recent routing log if available
  const lastRouting = [...inMemoryLogs].reverse().find(l => l.endpoint);
  if (lastRouting) {
    const statusPart = lastRouting.status || (lastRouting.level === 'error' ? 'ERR' : 'OK');
    const note = lastRouting.cacheHit ? 'cache-hit' : (lastRouting.isRoadSnapped ? 'snapped' : 'cache-miss');
    lastFetchOutcome = `${lastRouting.endpoint.replace('/api/route', '')} ${statusPart} (${note})`;
  }

  return inMemoryLogs;
}

// Kick off initialization
if (typeof window !== 'undefined') {
  initLogger();
}

/**
 * Persist inMemoryLogs to IndexedDB or localStorage
 */
async function persistLogs() {
  try {
    const db = await openDB();
    if (db && db.objectStoreNames.contains(STORE_NAME)) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      // Clear and re-populate with bounded ring buffer
      store.clear();
      for (const log of inMemoryLogs) {
        store.put(log);
      }
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(inMemoryLogs));
    }
  } catch (_) {}
}

function notifySubscribers(newEntry) {
  subscribers.forEach((fn) => {
    try {
      fn(newEntry, inMemoryLogs);
    } catch (_) {}
  });
}

export const diagnosticLogger = {
  /**
   * Records a routing or network event with human-readable summary.
   *
   * @param {Object} options
   * @param {string} options.endpoint e.g. '/api/route/active' or '/api/route/sequence'
   * @param {number|string} [options.status] HTTP status code (200, 404, 500, etc.)
   * @param {string} [options.level='info'] 'info' | 'warn' | 'error' | 'success'
   * @param {string} options.summary Formatted human-readable message
   * @param {boolean} [options.isRoadSnapped=null] Whether geometry is road-snapped
   * @param {boolean} [options.cacheHit=null] Whether result came from IndexedDB cache
   * @param {number} [options.durationMs=null] Round-trip latency in milliseconds
   * @param {Object} [options.details=null] Any extra debug metadata
   */
  logRoutingEvent({
    endpoint,
    status = null,
    level = 'info',
    summary,
    isRoadSnapped = null,
    cacheHit = null,
    durationMs = null,
    details = null,
  }) {
    const now = new Date();
    const timeStr = formatTime(now);

    const entry = {
      id: Date.now() + Math.random(),
      timestamp: now.getTime(),
      timeStr,
      endpoint: endpoint || '',
      status: status != null ? status : '',
      level,
      summary: summary || `${timeStr} ${endpoint}`,
      isRoadSnapped,
      cacheHit,
      durationMs,
      details
    };

    inMemoryLogs.push(entry);
    if (inMemoryLogs.length > MAX_LOG_ENTRIES) {
      inMemoryLogs.shift();
    }

    // Update lastFetchOutcome for Debug HUD
    if (endpoint) {
      const epShort = endpoint.replace('/api/route', '');
      const statStr = status != null ? status : (level === 'error' ? 'fail' : 'ok');
      const noteStr = cacheHit ? 'cache-hit' : (isRoadSnapped ? 'snapped' : 'cache-miss');
      lastFetchOutcome = `${epShort} ${statStr} (${noteStr})`;
    }

    // Persist asynchronously
    persistLogs();
    notifySubscribers(entry);

    // Also mirror to console for developer inspectability
    const prefix = `[ACED Logger ${timeStr}]`;
    if (level === 'error') {
      console.error(prefix, entry.summary, details || '');
    } else if (level === 'warn') {
      console.warn(prefix, entry.summary, details || '');
    } else {
      console.log(prefix, entry.summary, details || '');
    }

    return entry;
  },

  /**
   * Returns current in-memory log list (up to limit entries, newest last).
   */
  getLogs(limit = MAX_LOG_ENTRIES) {
    return inMemoryLogs.slice(-limit);
  },

  /**
   * Clears all log entries from memory and storage.
   */
  async clearLogs() {
    inMemoryLogs = [];
    lastFetchOutcome = 'none';
    try {
      const db = await openDB();
      if (db && db.objectStoreNames.contains(STORE_NAME)) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    } catch (_) {}
    notifySubscribers(null);
  },

  /**
   * Returns the short status of the most recent routing network fetch for HUD display.
   * e.g. "/active 404 (cache-miss)" or "/sequence 200 (snapped)"
   */
  getLastFetchOutcome() {
    return lastFetchOutcome;
  },

  /**
   * Generates a plain-text human-readable export of all stored logs.
   */
  exportLogsAsText() {
    const header = [
      '================================================================================',
      'ACED ROUTE — SYSTEM & ROUTING DIAGNOSTIC LOGS',
      `Generated: ${new Date().toISOString()} (${formatTime()})`,
      `Total Log Entries: ${inMemoryLogs.length}`,
      '================================================================================',
      ''
    ].join('\n');

    const lines = inMemoryLogs.map((entry) => {
      let line = `[${entry.timeStr}] [${entry.level.toUpperCase()}] ${entry.summary}`;
      if (entry.durationMs != null) {
        line += ` (${entry.durationMs}ms)`;
      }
      if (entry.details && Object.keys(entry.details).length > 0) {
        line += `\n  Details: ${JSON.stringify(entry.details)}`;
      }
      return line;
    });

    return header + lines.join('\n');
  },

  /**
   * Triggers an automated file download of the system diagnostic logs (.txt).
   */
  downloadLogsFile() {
    const textContent = this.exportLogsAsText();
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `aced-route-system-logs-${dateStamp}.txt`;

    if (typeof document !== 'undefined') {
      const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    }
    return false;
  },

  /**
   * Subscribe to log events (for real-time HUD and UI updates).
   */
  subscribe(fn) {
    if (typeof fn === 'function') {
      subscribers.add(fn);
    }
    return () => subscribers.delete(fn);
  }
};
