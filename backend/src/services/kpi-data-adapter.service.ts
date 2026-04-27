/**
 * KPI Data Adapter
 *
 * Sits between route handlers and the remote DB. Instead of one round-trip
 * per KPI chart, it fires a SINGLE query for ALL common KPIs for a site+date
 * window, caches the whole bundle, and serves individual KPIs out of the cache.
 *
 * Promise coalescing ensures that even if 6 chart components mount at the same
 * millisecond and all miss cache simultaneously, only one DB query fires.
 */

import { NaavikDBConnector, KPIDataPoint } from './naavik-db-connector.service.js';
import { siteIdMapper } from './site-id-mapper.service.js';
import { dataAnonymizer } from './data-anonymizer.service.js';
import { logger } from '../utils/logger.js';
import type { KPIQueryResult, KPITimeSeriesPoint } from '../models/kpi.model.js';

// ── KPI names to fetch in every bundle ──────────────────────────────────────
// Keep this in sync with what charts actually display.
export const COMMON_KPI_NAMES = [
  'DL_DRB_TPUT',
  'AVG_DL_PRB_UTIL',
  'DATA_RAN_ACC',
  'D_ERB_ATTEMPTS',
  'D_ERB_DROP',
  'D_ERB_FAIL',
  'DATA_ERB_RET',
  'DL_VOL_GB',
  'DL_PKTLOSS_RT',
  'ERAB_DROP_CDT',
  'RRC_FAIL',
  'DUAC_FAIL',
  'UL_DRB_TPUT',
  'UL_VOL_GB',
  'AVG_UL_PRB_UTIL',
  'HOSR',
  'CSSR',
  'CALL_DROP_RATE',
];

export type KpiBundle = Record<string, KPIQueryResult>;

interface BundleEntry {
  bundle: KpiBundle;
  fetchedAt: number;
}

const BUNDLE_TTL_MS = 10 * 60 * 1000; // 10 minutes — longer than per-KPI cache
const DAILY_WINDOW_DAYS = 30;
const HOURLY_WINDOW_DAYS = 7;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAggregate(values: number[]) {
  if (!values.length) return { avg: 0, min: 0, max: 0, count: 0 };
  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  };
}

function processDaily(rows: KPIDataPoint[]): KpiBundle {
  const byKpi = new Map<string, Map<string, number[]>>();

  for (const row of rows) {
    const kpi = row.kpi_name;
    if (!byKpi.has(kpi)) byKpi.set(kpi, new Map());
    const dateMap = byKpi.get(kpi)!;
    const key = String(row.DATE_ID).slice(0, 10);
    if (!dateMap.has(key)) dateMap.set(key, []);
    if (row.kpi_value !== null && !isNaN(row.kpi_value)) {
      dateMap.get(key)!.push(row.kpi_value);
    }
  }

  const bundle: KpiBundle = {};
  for (const [kpi, dateMap] of byKpi) {
    const timeSeries: KPITimeSeriesPoint[] = Array.from(dateMap.entries())
      .map(([dateId, vals]) => ({
        dateId,
        value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
        anomalyFlag: false,
        anomalyScore: 0,
      }))
      .sort((a, b) => a.dateId.localeCompare(b.dateId));

    const values = timeSeries.map((t) => t.value);
    bundle[kpi] = {
      siteId: '', // filled in by caller
      kpiName: kpi,
      timeSeries,
      aggregate: buildAggregate(values),
    };
  }
  return bundle;
}

function processHourly(rows: KPIDataPoint[]): KpiBundle {
  const byKpi = new Map<string, Map<string, number[]>>();

  for (const row of rows) {
    const kpi = row.kpi_name;
    if (!byKpi.has(kpi)) byKpi.set(kpi, new Map());
    const key = `${String(row.DATE_ID).slice(0, 10)}_${row.HOUR_ID ?? 0}`;
    const m = byKpi.get(kpi)!;
    if (!m.has(key)) m.set(key, []);
    if (row.kpi_value !== null && !isNaN(row.kpi_value)) {
      m.get(key)!.push(row.kpi_value);
    }
  }

  const bundle: KpiBundle = {};
  for (const [kpi, map] of byKpi) {
    const timeSeries: KPITimeSeriesPoint[] = Array.from(map.entries())
      .map(([key, vals]) => {
        const [dateId, hourStr] = key.split('_');
        return {
          dateId,
          hourId: parseInt(hourStr, 10),
          value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
          anomalyFlag: false,
          anomalyScore: 0,
        };
      })
      .sort((a, b) => {
        if (a.dateId !== b.dateId) return a.dateId.localeCompare(b.dateId);
        return (a.hourId ?? 0) - (b.hourId ?? 0);
      });

    const values = timeSeries.map((t) => t.value);
    bundle[kpi] = {
      siteId: '',
      kpiName: kpi,
      timeSeries,
      aggregate: buildAggregate(values),
    };
  }
  return bundle;
}

// ── Adapter class ────────────────────────────────────────────────────────────

class KpiDataAdapter {
  private readonly db: NaavikDBConnector;
  /** In-memory bundle cache: key = `${granularity}:${dummySiteId}:${endDate}` */
  private readonly bundleCache = new Map<string, BundleEntry>();
  /** In-flight promises — prevents duplicate concurrent DB calls for same key */
  private readonly inFlight = new Map<string, Promise<KpiBundle>>();

  constructor() {
    this.db = new NaavikDBConnector();
  }

  /** Returns the full KPI bundle for a site+date, fetching once if needed. */
  async getBundle(
    dummySiteId: string,
    endDate: string,
    granularity: 'daily' | 'hourly' = 'daily'
  ): Promise<KpiBundle> {
    const key = `${granularity}:${dummySiteId}:${endDate}`;

    // 1. Memory cache hit
    const cached = this.bundleCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < BUNDLE_TTL_MS) {
      logger.debug(`KpiAdapter BUNDLE HIT: ${key}`);
      return cached.bundle;
    }

    // 2. Coalesce concurrent misses — return the same in-flight promise
    const existing = this.inFlight.get(key);
    if (existing) {
      logger.debug(`KpiAdapter COALESCE: ${key}`);
      return existing;
    }

    // 3. Cache miss — fire single DB call
    const promise = this._fetchBundle(dummySiteId, endDate, granularity, key);
    this.inFlight.set(key, promise);
    try {
      const bundle = await promise;
      this.bundleCache.set(key, { bundle, fetchedAt: Date.now() });
      return bundle;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Serve a single KPI from the bundle (triggers bundle fetch if not cached). */
  async getKpi(
    dummySiteId: string,
    kpiName: string,
    endDate: string,
    granularity: 'daily' | 'hourly' = 'daily'
  ): Promise<KPIQueryResult | null> {
    const bundle = await this.getBundle(dummySiteId, endDate, granularity);
    const result = bundle[kpiName];
    if (!result) return null;
    return { ...result, siteId: dummySiteId };
  }

  /** Evict cache entries older than TTL (call periodically if needed). */
  evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.bundleCache) {
      if (now - entry.fetchedAt >= BUNDLE_TTL_MS) this.bundleCache.delete(key);
    }
  }

  /** Clear one site's bundle (after manual cache-bust). */
  invalidateSite(dummySiteId: string): void {
    for (const key of this.bundleCache.keys()) {
      if (key.includes(`:${dummySiteId}:`)) this.bundleCache.delete(key);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _fetchBundle(
    dummySiteId: string,
    endDate: string,
    granularity: 'daily' | 'hourly',
    logKey: string
  ): Promise<KpiBundle> {
    const realUSID = siteIdMapper.getRealUSID(dummySiteId);
    if (!realUSID) {
      logger.warn(`KpiAdapter: no USID for dummy site ${dummySiteId}`);
      return {};
    }

    const days = granularity === 'hourly' ? HOURLY_WINDOW_DAYS : DAILY_WINDOW_DAYS;
    const end = new Date(endDate);
    if (isNaN(end.getTime())) {
      logger.warn(`KpiAdapter: invalid endDate "${endDate}", using today`);
      end.setTime(Date.now());
    }
    const start = new Date(end);
    start.setDate(end.getDate() - days);

    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    const t0 = Date.now();
    logger.info(`KpiAdapter FETCH ${logKey}  usid=${realUSID.slice(0, 16)}…  ${startStr}→${endStr}  kpis=${COMMON_KPI_NAMES.length}`);

    let rawRows: KPIDataPoint[];
    try {
      if (granularity === 'hourly') {
        rawRows = await this.db.fetchHourlyKPIs(realUSID, startStr, endStr, COMMON_KPI_NAMES);
      } else {
        rawRows = await this.db.fetchDailyKPIs(realUSID, startStr, endStr, COMMON_KPI_NAMES);
      }
    } catch (err: any) {
      logger.error(`KpiAdapter fetch failed for ${logKey}: ${err.message}`);
      return {};
    }

    const anonRows = dataAnonymizer.anonymizeKPIData(rawRows);
    const bundle = granularity === 'hourly' ? processHourly(anonRows) : processDaily(anonRows);

    logger.info(`KpiAdapter BUNDLE READY ${logKey}  rows=${rawRows.length}  kpis=${Object.keys(bundle).length}  ms=${Date.now() - t0}`);
    return bundle;
  }
}

// Singleton shared across all route handlers
export const kpiDataAdapter = new KpiDataAdapter();
