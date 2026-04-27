/**
 * API Service Wrapper with Automatic Caching
 * Wraps your existing API calls and caches responses automatically
 *
 * Usage:
 * - All queries to the data API (3.20.40.252:9876/api/query) are automatically cached
 * - Default cache TTL: 1 hour (configurable per call)
 * - Falls back to live data if cache is stale
 */

import api from './api';
import { localCache } from './localCache';

/**
 * Cache configuration for different query types
 */
const CACHE_CONFIG: Record<string, { ttl: number }> = {
  // KPI data - cache for 1 hour
  'kpi:': { ttl: 60 * 60 * 1000 },
  // Site data - cache for 30 minutes
  'site:': { ttl: 30 * 60 * 1000 },
  // Map data - cache for 2 hours
  'map:': { ttl: 2 * 60 * 60 * 1000 },
  // RCA data - cache for 1 hour
  'rca:': { ttl: 60 * 60 * 1000 },
  // Worst offenders - cache for 30 minutes
  'offender:': { ttl: 30 * 60 * 1000 },
  // Default - cache for 1 hour
  'default': { ttl: 60 * 60 * 1000 },
};

/**
 * Generate cache key from query parameters
 */
function generateCacheKey(
  endpoint: string,
  params?: Record<string, any> | string
): string {
  const paramStr =
    typeof params === 'string'
      ? params
      : params
        ? JSON.stringify(params)
        : '';
  return `${endpoint}:${paramStr}`;
}

/**
 * Get TTL for a cache key based on its type
 */
function getCacheTTL(cacheKey: string): number {
  for (const [prefix, config] of Object.entries(CACHE_CONFIG)) {
    if (cacheKey.startsWith(prefix)) {
      return config.ttl;
    }
  }
  return CACHE_CONFIG.default.ttl;
}

/**
 * Wrapper to add caching to any async API call
 */
async function cachedCall<T>(
  cacheKey: string,
  apiFn: () => Promise<T>,
  skipCache = false
): Promise<T> {
  // Try to get from cache first
  if (!skipCache) {
    const cached = await localCache.get<T>(cacheKey);
    if (cached) {
      console.debug(`[Cache HIT] ${cacheKey}`);
      return cached;
    }
  }

  // Call API and cache result
  console.debug(`[Cache MISS] ${cacheKey} - fetching from API`);
  const result = await apiFn();
  const ttl = getCacheTTL(cacheKey);
  await localCache.set(cacheKey, result, { ttlMs: ttl });

  return result;
}

/**
 * Extended API service with automatic caching
 * All methods return the same data as the original api service, but with caching
 */
export const apiWithCache = {
  // Map data (cached for 2 hours)
  getMapSites: async (skipCache = false) => {
    return cachedCall(
      'map:sites',
      () => api.getMapSites(),
      skipCache
    );
  },

  getAllSectors: async (skipCache = false) => {
    return cachedCall(
      'map:sectors',
      () => api.getAllSectors(),
      skipCache
    );
  },

  // KPI data (cached for 1 hour)
  getAvailableKPIs: async (skipCache = false) => {
    return cachedCall(
      'kpi:available',
      () => api.getAvailableKPIs(),
      skipCache
    );
  },

  getKPITimeSeries: async (siteId: string, kpi: string, days: number, frequency: 'daily' | 'hourly' | undefined, date: string, skipCache = false) => {
    const cacheKey = generateCacheKey('kpi:timeseries', { siteId, kpi, days, frequency, date });
    return cachedCall(
      cacheKey,
      () => api.getSiteKPITimeSeries(siteId, kpi, days, frequency, date),
      skipCache
    );
  },

  getKPIDateRange: async (skipCache = false) => {
    return cachedCall(
      'kpi:daterange',
      () => api.getKPIDateRange(),
      skipCache
    );
  },

  // Site RCA data (cached for 1 hour)
  getSiteRCA: async (siteId: string, dateId: string, skipCache = false) => {
    const cacheKey = generateCacheKey('rca:site', { siteId, dateId });
    return cachedCall(
      cacheKey,
      () => api.getSiteRCA(siteId, dateId),
      skipCache
    );
  },

  // Worst offenders (cached for 30 minutes)
  getOffenderSiteIds: async (dateId: string, skipCache = false) => {
    const cacheKey = generateCacheKey('offender:sites', { dateId });
    return cachedCall(
      cacheKey,
      () => api.getOffenderSiteIds(dateId),
      skipCache
    );
  },

  // Pass-through methods (not cached or custom caching)
  startOssParameterChange: api.startOssParameterChange,
  getOssParameterChangeStatus: api.getOssParameterChangeStatus,
  executeIntent: api.executeIntent,
  askTelecomQuestion: api.askTelecomQuestion,
  appgenAgentV1Chat: api.appgenAgentV1Chat,

  /**
   * Manually clear cache for specific keys or all
   */
  clearCache: async (cacheKeyPattern?: string) => {
    if (cacheKeyPattern) {
      // Clear specific pattern
      const beforeStats = localCache.getStats();
      console.log(`Clearing cache pattern: ${cacheKeyPattern}`, beforeStats);
      // Note: For targeted clearing, you may need to enhance localCache
      // For now, this clears all
      await localCache.clearAll();
    } else {
      // Clear all
      await localCache.clearAll();
      console.log('Cache cleared');
    }
  },

  /**
   * Get cache statistics
   */
  getCacheStats: () => {
    return localCache.getStats();
  },
};

export default apiWithCache;
