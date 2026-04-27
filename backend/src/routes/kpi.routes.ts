/**
 * KPI Routes
 * Network KPI metrics endpoints
 */
import { Router, Request, Response } from 'express';
import { KPIModel } from '../models/kpi.model.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { cacheOrFetch } from '../utils/cache.js';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = Router();

const DEFAULT_PREWARM_KPIS = [
  'PMDOWNTIMEAUTO',
  'PMDOWNTIMEMANUAL',
  'RRC_FAIL',
  'RRC_ATTEMPTS',
  'DUAC_FAIL',
  'V_ERB_FAIL',
  'DL_VOL_GB',
  'AVG_DL_PRB_UTIL',
  'DL_DRB_TPUT',
  'ERAB_DROP_CDT',
];

function uniqueKpis(kpis: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kpi of kpis) {
    const normalized = String(kpi).trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}


/**
 * GET /api/kpis
 * Get list of available KPIs
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const kpis = await cacheOrFetch(
    'kpis:available',
    () => KPIModel.getAvailableKPIs(),
    600
  );
  
  res.json({
    success: true,
    data: kpis,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/kpis/date-range
 * Get the date range of KPI data in the DB (min, max, distinct days)
 */
router.get('/date-range', asyncHandler(async (req: Request, res: Response) => {
  const range = await cacheOrFetch(
    'kpis:date-range',
    () => KPIModel.getKPIDateRange(),
    300
  );
  
  if (!range) {
    throw new AppError(404, 'NO_KPI_DATA', 'No KPI date range found in database');
  }
  
  res.json({
    success: true,
    data: range,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/kpis/search
 * Search KPIs by name
 */
router.get('/search', asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query;

  if (!q) {
    throw new AppError(400, 'MISSING_QUERY', 'Search query (q) is required');
  }

  let parsedLimit = 20;
  if (limit) {
    parsedLimit = parseInt(limit as string, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new AppError(400, 'INVALID_LIMIT', 'limit must be a number between 1 and 1000');
    }
  }

  const kpis = await KPIModel.searchKPIs(
    q as string,
    parsedLimit
  );
  
  res.json({
    success: true,
    data: kpis,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/kpis/:kpiName/stats
 * Get statistics for a specific KPI across all sites
 */
router.get('/:kpiName/stats', asyncHandler(async (req: Request, res: Response) => {
  const { kpiName } = req.params;
  
  const stats = await cacheOrFetch(
    `kpi:stats:${kpiName}`,
    () => KPIModel.getKPIStats(kpiName),
    300
  );
  
  if (!stats) {
    throw new AppError(404, 'KPI_NOT_FOUND', `KPI ${kpiName} not found`);
  }
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/kpis/:kpiName/top-sites
 * Get top sites by KPI value
 */
router.get('/:kpiName/top-sites', asyncHandler(async (req: Request, res: Response) => {
  const { kpiName } = req.params;
  const { limit, order } = req.query;

  if (!kpiName || !kpiName.trim()) {
    throw new AppError(400, 'MISSING_KPI', 'kpiName is required');
  }

  let parsedLimit = 10;
  if (limit) {
    parsedLimit = parseInt(limit as string, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      throw new AppError(400, 'INVALID_LIMIT', 'limit must be a number between 1 and 1000');
    }
  }

  const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

  const topSites = await cacheOrFetch(
    `kpi:top:${kpiName}:${sortOrder}:${parsedLimit}`,
    () => KPIModel.getTopSitesByKPI(
      kpiName,
      parsedLimit,
      sortOrder
    ),
    300
  );
  
  res.json({
    success: true,
    data: topSites,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/kpis/compare
 * Compare KPI across multiple sites
 */
router.post('/compare', asyncHandler(async (req: Request, res: Response) => {
  const { siteIds, kpiName, dateId } = req.body;
  
  if (!siteIds || !Array.isArray(siteIds) || siteIds.length === 0) {
    throw new AppError(400, 'INVALID_SITES', 'siteIds array is required');
  }
  
  if (!kpiName) {
    throw new AppError(400, 'MISSING_KPI', 'kpiName is required');
  }
  
  const comparison = await KPIModel.getKPIsBySites(siteIds, kpiName, dateId);
  
  res.json({
    success: true,
    data: {
      kpiName,
      comparison,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/kpis/prewarm
 * Preload KPI cache for demo dates/sites so trend charts load quickly.
 *
 * Body:
 * {
 *   "dates": ["2026-02-01", ...],
 *   "limitSitesPerDate": 25,
 *   "siteIds": ["SITE_A1234"],           // optional explicit site list
 *   "includeHourly": false,              // optional
 *   "kpis": ["DL_VOL_GB", ...],          // optional explicit KPI list
 *   "concurrency": 6                     // optional, 1-12
 * }
 */
router.post('/prewarm', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body || {}) as {
    dates?: string[];
    limitSitesPerDate?: number;
    siteIds?: string[];
    includeHourly?: boolean;
    kpis?: string[];
    concurrency?: number;
  };

  const dates = Array.isArray(body.dates) && body.dates.length > 0
    ? body.dates.map((d) => String(d))
    : ['2026-02-01', '2026-02-02', '2026-02-03', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31'];

  const limitSitesPerDate = Math.min(Math.max(Number(body.limitSitesPerDate || 20), 1), 100);
  const includeHourly = Boolean(body.includeHourly);
  const explicitSiteIds = Array.isArray(body.siteIds) ? body.siteIds.map((s) => String(s).trim()).filter(Boolean) : [];
  const explicitKpis = Array.isArray(body.kpis) ? uniqueKpis(body.kpis) : [];
  const concurrency = Math.min(Math.max(Number(body.concurrency || 6), 1), 12);

  const startedAt = Date.now();
  const siteByDate = new Map<string, string[]>();

  if (explicitSiteIds.length > 0) {
    for (const date of dates) {
      siteByDate.set(date, explicitSiteIds);
    }
  } else {
    const client = await pool.connect();
    try {
      for (const date of dates) {
        const result = await client.query(
          `
            SELECT "SiteID"
            FROM site_table
            WHERE CAST("DateID" AS DATE) = CAST($1 AS DATE)
            ORDER BY COALESCE("AnomalyScore", 0) DESC
            LIMIT $2
          `,
          [date, limitSitesPerDate]
        );
        const sites = result.rows.map((r) => String(r.SiteID)).filter(Boolean);
        siteByDate.set(date, sites);
      }
    } finally {
      client.release();
    }
  }

  type PrewarmTask = { date: string; siteId: string };
  const tasks: PrewarmTask[] = [];
  for (const [date, siteIds] of siteByDate.entries()) {
    for (const siteId of siteIds) {
      tasks.push({ date, siteId });
    }
  }

  let warmedDaily = 0;
  let warmedHourly = 0;
  let failed = 0;
  const failures: Array<{ siteId: string; date: string; reason: string }> = [];

  const worker = async (task: PrewarmTask) => {
    const { date, siteId } = task;
    const kpis = explicitKpis.length ? explicitKpis : DEFAULT_PREWARM_KPIS;

    for (const kpi of kpis) {
      try {
        const daily = await KPIModel.getKPITimeSeries(siteId, kpi, 30, 'daily', date);
        if (daily) warmedDaily += 1;
      } catch (error: any) {
        failed += 1;
        failures.push({ siteId, date, reason: `daily ${kpi}: ${error?.message || 'unknown error'}` });
      }

      if (includeHourly) {
        try {
          const hourly = await KPIModel.getKPITimeSeries(siteId, kpi, 2, 'hourly', date);
          if (hourly) warmedHourly += 1;
        } catch (error: any) {
          failed += 1;
          failures.push({ siteId, date, reason: `hourly ${kpi}: ${error?.message || 'unknown error'}` });
        }
      }
    }
  };

  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(tasks.length, 1)) }, async () => {
    while (cursor < tasks.length) {
      const idx = cursor;
      cursor += 1;
      await worker(tasks[idx]);
    }
  });
  await Promise.all(runners);

  const durationMs = Date.now() - startedAt;
  logger.info(`KPI prewarm completed in ${durationMs}ms. tasks=${tasks.length}, daily=${warmedDaily}, hourly=${warmedHourly}, failed=${failed}`);

  res.json({
    success: true,
    data: {
      dates,
      includeHourly,
      limitSitesPerDate,
      explicitSiteCount: explicitSiteIds.length,
      tasks: tasks.length,
      warmedDaily,
      warmedHourly,
      failed,
      durationMs,
      failures: failures.slice(0, 25),
    },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
