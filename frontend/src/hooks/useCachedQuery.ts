import { useEffect, useState, useRef } from 'react';
import { localCache } from '../services/localCache';

interface UseCachedQueryOptions {
  ttlMs?: number; // Cache time-to-live in milliseconds
  enabled?: boolean; // Whether to fetch (default: true)
  skipCache?: boolean; // Skip cache and always fetch fresh (default: false)
}

interface UseCachedQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  isFromCache: boolean; // True if data came from cache instead of fresh fetch
  refetch: () => Promise<void>; // Manually trigger a fresh fetch
}

/**
 * Hook for cached API queries
 * Automatically caches API responses and serves from cache on subsequent calls
 *
 * @example
 * const { data, loading, error, isFromCache } = useCachedQuery(
 *   async () => api.query({ ... }),
 *   'my-query-key',
 *   { ttlMs: 5 * 60 * 1000 }
 * );
 */
export function useCachedQuery<T>(
  queryFn: () => Promise<T>,
  cacheKey: string,
  options: UseCachedQueryOptions = {}
): UseCachedQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const isMountedRef = useRef(true);

  const fetchData = async (fromManualRefetch = false) => {
    if (!options.enabled && !fromManualRefetch) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Try cache first (unless skipCache is true)
      if (!options.skipCache && !fromManualRefetch) {
        const cached = await localCache.get<T>(cacheKey);
        if (cached && isMountedRef.current) {
          setData(cached);
          setIsFromCache(true);
          setLoading(false);
          return;
        }
      }

      // Fetch fresh data
      const result = await queryFn();
      if (isMountedRef.current) {
        setData(result);
        setIsFromCache(false);
        setError(null);

        // Cache the result
        await localCache.set(cacheKey, result, {
          ttlMs: options.ttlMs,
        });
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setData(null);
        setIsFromCache(false);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [cacheKey, options.enabled, options.skipCache]);

  const refetch = async () => {
    await fetchData(true);
  };

  return { data, loading, error, isFromCache, refetch };
}

/**
 * Hook for cached API queries that depend on parameters
 *
 * @example
 * const { data, loading } = useCachedQueryWithParams(
 *   (params) => api.query(params),
 *   params,
 *   `query-${JSON.stringify(params)}`
 * );
 */
export function useCachedQueryWithParams<P, T>(
  queryFn: (params: P) => Promise<T>,
  params: P | null,
  cacheKey: string,
  options: UseCachedQueryOptions = {}
): UseCachedQueryResult<T> {
  return useCachedQuery(
    () => {
      if (!params) throw new Error('Parameters are required');
      return queryFn(params);
    },
    cacheKey,
    options
  );
}
