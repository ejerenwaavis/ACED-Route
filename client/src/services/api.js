import { Capacitor } from '@capacitor/core';

// ACED Route API Service
// Default production endpoint per requirement: route.aceddivision.com
const DEFAULT_API_BASE = 'https://route.aceddivision.com';

export const getApiBase = () => {
  const saved = localStorage.getItem('aced_api_base');
  if (saved) return saved;

  // On native mobile devices (Capacitor), default strictly to production server
  if (Capacitor.isNativePlatform()) {
    return DEFAULT_API_BASE;
  }

  return (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3000'
      : (window.location.pathname.startsWith('/acedroute')
          ? `${window.location.origin}/acedroute`
          : DEFAULT_API_BASE)
  );
};

export const setApiBase = (url) => {
  localStorage.setItem('aced_api_base', url);
};

export const getToken = () => localStorage.getItem('aced_jwt');
export const setToken = (t) => localStorage.setItem('aced_jwt', t);
export const removeToken = () => localStorage.removeItem('aced_jwt');

export const getUser = () => {
  const t = getToken();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    return payload;
  } catch (e) {
    return null;
  }
};

async function request(path, options = {}) {
  const base = getApiBase();
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    // If token expired, clear
    // removeToken();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return data;
}

export const api = {
  // Health
  checkHealth: () => request('/api/health'),

  // Manifests
  getManifests: () => request('/api/manifest'),
  getManifest: (id) => request(`/api/manifest/${id}`),
  uploadManifest: (routeDate, stops) =>
    request('/api/manifest', {
      method: 'POST',
      body: JSON.stringify({ routeDate, stops })
    }),
  getSuggestedOrder: (id) => request(`/api/manifest/${id}/suggest`),
  reorderManifest: (id, stops) =>
    request(`/api/manifest/${id}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ stops })
    }),
  updateStop: (id, stopIndex, data) =>
    request(`/api/manifest/${id}/stop/${stopIndex}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),
  completeManifest: (id, finalOrder) =>
    request(`/api/manifest/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ finalOrder })
    }),

  // Brands
  findBrand: (tracking) => request(`/api/brand/find/${encodeURIComponent(tracking)}`),
  upsertBrand: (brandName, trackingPrefix) =>
    request('/api/brand', {
      method: 'POST',
      body: JSON.stringify({ brandName, trackingPrefix })
    }),

  // Valhalla Routing Proxies
  calculateSequenceRoute: (stops) =>
    request('/api/route/sequence', {
      method: 'POST',
      body: JSON.stringify({ stops })
    }),
  calculateActiveRoute: (start, end) =>
    request('/api/route/active', {
      method: 'POST',
      body: JSON.stringify({ start, end })
    }),

  // Offline Regions Catalog & Detection
  getRegions: () => request('/api/regions'),
  getRegion: (id) => request(`/api/regions/${id}`),
  detectRegion: (data) =>
    request('/api/regions/detect', {
      method: 'POST',
      body: JSON.stringify(data)
    })
};

export default api;

