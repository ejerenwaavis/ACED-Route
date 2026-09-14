/**
 * Client-Side Geocode Cache
 * Prevents repeating Google Maps Geocoding API calls across app restarts and uploads.
 */

import { SUWANEE_SAMPLE_POOL } from '../data/sampleManifestPool.js';

const CACHE_STORAGE_KEY = 'aced_geocode_cache_v1';

// In-memory lookup initialized from localStorage
let memoryCache = null;

function getCache() {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    memoryCache = raw ? JSON.parse(raw) : {};
  } catch (e) {
    memoryCache = {};
  }

  // Auto-seed known real-world sample pool coordinates into cache
  if (Array.isArray(SUWANEE_SAMPLE_POOL)) {
    for (const item of SUWANEE_SAMPLE_POOL) {
      const key = normalizeAddress(item.address);
      if (!memoryCache[key]) {
        memoryCache[key] = [item.lng, item.lat];
      }
    }
  }

  return memoryCache;
}

function saveCache() {
  if (!memoryCache) return;
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(memoryCache));
  } catch (e) {
    console.warn('[geocodeCache] Failed to save to localStorage:', e.message);
  }
}

/**
 * Normalizes an address string for exact cache hit matching.
 * Strips periods, commas, extra whitespace, and standardizes case.
 */
export function normalizeAddress(raw) {
  if (!raw) return '';
  if (typeof raw === 'object') {
    const parts = [raw.street || raw.raw, raw.city, raw.state, raw.postalCode || raw.zip].filter(Boolean);
    raw = parts.join(', ');
  }
  return String(raw)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if coordinates are cached for this address.
 * Returns [lng, lat] or null.
 */
export function getCachedCoordinates(address) {
  if (!address) return null;
  const key = normalizeAddress(address);
  const cache = getCache();
  const entry = cache[key];
  if (entry && Array.isArray(entry) && entry.length >= 2) {
    return [entry[0], entry[1]]; // [lng, lat]
  }
  return null;
}

/**
 * Stores coordinates for an address in the persistent cache.
 */
export function setCachedCoordinates(address, coordinates) {
  if (!address || !coordinates || coordinates.length < 2) return;
  const key = normalizeAddress(address);
  const cache = getCache();
  cache[key] = [coordinates[0], coordinates[1]]; // [lng, lat]
  saveCache();
}

/**
 * Bulk caches an array of { address, coordinates: [lng, lat] }
 */
export function bulkCacheAddresses(items) {
  if (!Array.isArray(items)) return;
  const cache = getCache();
  let changed = false;
  for (const item of items) {
    if (item.address && item.coordinates && item.coordinates.length >= 2) {
      const key = normalizeAddress(item.address);
      cache[key] = [item.coordinates[0], item.coordinates[1]];
      changed = true;
    }
  }
  if (changed) saveCache();
}
