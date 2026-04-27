/**
 * KPI Prefetch utility
 *
 * When a site is selected on the map (before the user has clicked "open
 * telemetry"), call this to warm the backend adapter cache and store the
 * bundle in the browser's IndexedDB.  When charts actually mount they get
 * instant cache hits instead of cold DB queries.
 */

import api from './api';
import { localCache } from './localCache';

export const PREFETCH_KPI_NAMES = [
  'DL_DRB_TPUT',
  'AVG_DL_PRB_UTIL',
  'DATA_RAN_ACC',
  'DL_VOL_GB',
  'DL_PKTLOSS_RT',
  'RRC_FAIL',
  'DUAC_FAIL',
  'UL_DRB_TPUT',
  'AVG_UL_PRB_UTIL',
  'HOSR',
  'ERAB_DROP_CDT',
];

const PREFETCH_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Sites already prefetched this session (avoids repeat fetches on re-hover) */
const prefetchedKeys = new Set<string>();

/**
 * Fire-and-forget: warm the KPI cache for a site+date.
 * Safe to call on map-hover / site-focus before the panel opens.
 */
export function prefetchSiteKpis(siteId: string, dateId: string): void {
  if (!siteId || !dateId) return;
  const key = `${siteId}:${dateId}`;
  if (prefetchedKeys.has(key)) return;
  prefetchedKeys.add(key);

  void (async () => {
    try {
      const browserKey = `kpi-batch:${siteId}:${dateId}`;
      const cached = await localCache.get(browserKey);
      if (cached) return; // browser cache already warm

      const bundle = await api.getSiteKPIBatch(siteId, PREFETCH_KPI_NAMES, dateId);
      if (bundle) {
        await localCache.set(browserKey, bundle, { ttlMs: PREFETCH_TTL_MS });
        // Also populate per-KPI cache entries so individual chart fetches hit cache
        for (const [kpiName, result] of Object.entries(bundle as Record<string, any>)) {
          if (!result) continue;
          const cacheKey = `site-kpi-series:${siteId}:${dateId}:daily:30:${kpiName}`;
          await localCache.set(cacheKey, { success: true, data: result }, {
            ttlMs: PREFETCH_TTL_MS,
            groupNamespace: 'site-date-kpi',
            group: `${siteId}:${dateId}`,
            maxGroups: 10,
          });
        }
      }
    } catch {
      // Prefetch is best-effort — silently ignore failures
      prefetchedKeys.delete(key); // allow retry
    }
  })();
}
