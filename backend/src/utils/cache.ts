/**
 * In-memory cache for fast data access
 */
import NodeCache from 'node-cache';
import { logger } from './logger.js';

const cacheTTL = parseInt(process.env.CACHE_TTL || '300'); // 5 minutes default

export const cache = new NodeCache({
  stdTTL: cacheTTL,
  checkperiod: 60,
  useClones: false, // Better performance
});

// Cache statistics
cache.on('set', (key) => {
  logger.debug(`Cache SET: ${key}`);
});

cache.on('expired', (key) => {
  logger.debug(`Cache EXPIRED: ${key}`);
});

/**
 * Get or set cache with async function
 */
export async function cacheOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  // Try to get from cache
  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    logger.debug(`Cache HIT: ${key}`);
    return cached;
  }

  // Cache miss - fetch data
  logger.debug(`Cache MISS: ${key}`);
  const data = await fetchFn();
  
  // Store in cache
  cache.set(key, data, ttl || cacheTTL);
  
  return data;
}

/**
 * Invalidate cache by pattern
 */
export function invalidatePattern(pattern: string): void {
  const keys = cache.keys();
  const matchingKeys = keys.filter(key => key.includes(pattern));
  
  matchingKeys.forEach(key => cache.del(key));
  
  logger.info(`Invalidated ${matchingKeys.length} cache entries matching: ${pattern}`);
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.flushAll();
  logger.info('Cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return cache.getStats();
}

/**
 * Re-export CACHE_KEYS from constants
 */
export { CACHE_KEYS } from '../config/constants.js';
