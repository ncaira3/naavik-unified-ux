# Client-Side Caching Guide

## Overview

The application implements a **3-tier caching strategy** for lightning-fast data retrieval:

1. **Memory Cache** - Ultra-fast in-process cache (cleared on page refresh)
2. **IndexedDB** - Persistent browser storage (~50MB+ capacity)
3. **localStorage** - Fallback browser storage (~5MB limit)

## Architecture

```
API Call
  ↓
Memory Cache (Hit = immediate response)
  ↓ (Miss)
IndexedDB (Hit = restore to memory + return)
  ↓ (Miss)
localStorage (Hit = restore to memory + return)
  ↓ (Miss)
Fetch from API → Cache in all three layers
```

## Usage

### Option 1: Automatic Caching via `apiWithCache` (Recommended)

Replace API calls with the cached version. Data is automatically cached with sensible defaults:

```typescript
// Before (no caching)
const kpis = await api.getAvailableKPIs();

// After (automatic caching)
const kpis = await apiWithCache.getAvailableKPIs();

// Force fresh data (bypass cache)
const kpis = await apiWithCache.getAvailableKPIs(skipCache = true);
```

**Default Cache TTLs:**
- KPI data: 1 hour
- Site data: 30 minutes
- Map data: 2 hours
- RCA data: 1 hour
- Worst offenders: 30 minutes

### Option 2: Custom Caching with Hook

Use `useCachedQuery` for component-level data fetching with caching:

```typescript
import { useCachedQuery } from '../hooks/useCachedQuery';

export function MyComponent() {
  const { data, loading, error, isFromCache, refetch } = useCachedQuery(
    () => api.getMapSites(),
    'my-map-sites',
    { ttlMs: 5 * 60 * 1000 } // 5-minute cache
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {isFromCache && <span className="text-gray-500">(from cache)</span>}
      {/* Render data */}
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

### Option 3: Direct Cache Service

For fine-grained control, use `localCache` directly:

```typescript
import { localCache } from '../services/localCache';

// Set data in cache
await localCache.set('my-key', myData, {
  ttlMs: 5 * 60 * 1000 // 5-minute TTL
});

// Get data from cache
const data = await localCache.get('my-key');

// Delete specific entry
await localCache.delete('my-key');

// Clear all cache
await localCache.clearAll();

// Get cache statistics
const stats = localCache.getStats();
console.log(`Memory entries: ${stats.memoryEntries}`);
console.log(`localStorage entries: ${stats.localStorageEntries}`);
```

## Configuration

### Cache TTLs

Edit cache TTLs in `apiWithCache.ts`:

```typescript
const CACHE_CONFIG: Record<string, { ttl: number }> = {
  'kpi:': { ttl: 60 * 60 * 1000 },      // 1 hour
  'site:': { ttl: 30 * 60 * 1000 },     // 30 minutes
  'map:': { ttl: 2 * 60 * 60 * 1000 },  // 2 hours
  'rca:': { ttl: 60 * 60 * 1000 },      // 1 hour
  'offender:': { ttl: 30 * 60 * 1000 }, // 30 minutes
  'default': { ttl: 60 * 60 * 1000 },   // 1 hour
};
```

### Storage Backends

The service automatically selects the best available storage:

- **IndexedDB** (preferred) - 50MB+, supports complex objects
- **localStorage** (fallback) - 5MB, simple key-value
- **Memory only** (if both unavailable) - Fast but cleared on refresh

## Performance Impact

### Before Caching
```
First load:  2000ms (API fetch)
Reload:      2000ms (API fetch again)
Same data:   2000ms (API fetch again)
```

### After Caching
```
First load:  2000ms (API fetch, then cached)
Memory hit:  <1ms   (in-process memory cache)
Disk hit:    10-50ms (IndexedDB/localStorage)
Reload:      10-50ms (restored from disk)
```

## Monitoring

Check cache status in browser console:

```javascript
// Get cache stats
console.log(apiWithCache.getCacheStats());
// Output: { memoryEntries: 5, localStorageEntries: 3 }

// Open DevTools → Application tab
// → IndexedDB → naavik_cache_db → api_cache
// → See all cached entries with timestamps
```

## Clearing Cache

```typescript
// Clear all cache programmatically
await apiWithCache.clearCache();

// Or from DevTools
// → Application → Storage → Clear site data
```

## Best Practices

1. **Use `apiWithCache` for all data API calls** - Automatic caching with smart TTLs

2. **Force refresh when needed**
   ```typescript
   // Skip cache and fetch fresh
   const data = await apiWithCache.getMapSites(skipCache = true);
   ```

3. **Monitor cache size** - Clear periodically if it grows too large
   ```typescript
   const stats = apiWithCache.getCacheStats();
   if (stats.memoryEntries > 100) {
     await apiWithCache.clearCache();
   }
   ```

4. **Use appropriate TTLs** - Shorter TTLs for data that changes frequently
   ```typescript
   useCachedQuery(queryFn, 'realtime-data', {
     ttlMs: 5 * 1000 // 5-second cache for realtime data
   });
   ```

## Troubleshooting

### Cache not working?

1. Check browser DevTools → Application → Storage
2. Verify IndexedDB is available (might be disabled in private browsing)
3. Check console for warnings about `localCache`
4. Manually clear cache: `await apiWithCache.clearCache()`

### Data seems stale?

- Reduce TTL for that data type
- Force refresh with `skipCache = true`
- Check cache creation timestamp in DevTools

### Storage space issues?

- Monitor: `apiWithCache.getCacheStats()`
- Clear periodically: `await apiWithCache.clearCache()`
- Reduce TTLs for less critical data
- IndexedDB can usually handle 50MB+ safely

## Implementation Details

### Cache Keys

Cache keys are generated from endpoint + parameters:
```
'kpi:timeseries:{"siteId":"UST123","kpi":"THPT",...}'
'rca:site:{"siteId":"UST456","dateId":"2026-02-01"}'
```

### TTL Management

Entries are validated before use:
- If expired: automatically removed and fresh data fetched
- No background cleanup needed
- Cleanup happens on-demand as entries are accessed

### Storage Priority

1. Check memory cache (instant access)
2. If missing, check IndexedDB (async)
3. If missing, check localStorage (async)
4. If all miss, fetch from API and populate all layers

## Adding Caching to New API Methods

When adding new API calls to `apiWithCache`:

```typescript
// In apiWithCache.ts
myNewQuery: async (param: string, skipCache = false) => {
  const cacheKey = generateCacheKey('prefix:query', { param });
  return cachedCall(
    cacheKey,
    () => api.myNewQuery(param),
    skipCache
  );
},

// In CACHE_CONFIG
'prefix:': { ttl: 30 * 60 * 1000 }, // 30 minutes
```

## Migration Path

1. **Phase 1** - Use `apiWithCache` for read-only queries
2. **Phase 2** - Add cache invalidation after mutations (PUT/POST/DELETE)
3. **Phase 3** - Implement selective cache clearing
4. **Phase 4** - Add background cache synchronization if needed

## References

- [IndexedDB MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [localStorage MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [Cache Expiration Strategies](https://en.wikipedia.org/wiki/Cache_replacement_policies)
