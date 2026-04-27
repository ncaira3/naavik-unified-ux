/**
 * Site Routes
 * Network site data endpoints
 */
import { Router, Request, Response } from 'express';
import { SiteModel } from '../models/site.model.js';
import { CellModel } from '../models/cell.model.js';
import { KPIModel } from '../models/kpi.model.js';
import { CellSectorModel } from '../models/cellSector.model.js';
import { CompassModel } from '../models/compass.model.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { cacheOrFetch, CACHE_KEYS } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { pool } from '../config/database.js';
import { siteIdMapper } from '../services/site-id-mapper.service.js';
import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { SiteAnalysisModel } from '../models/siteAnalysis.model.js';

const router = Router();
const tableColumnsCache = new Map<string, Set<string>>();
const remoteDbConnector = new NaavikDBConnector();

async function getTableColumns(tableName: string): Promise<Set<string>> {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName)!;
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = $1`,
    [tableName]
  );
  const cols = new Set(result.rows.map((r) => String(r.column_name)));
  tableColumnsCache.set(tableName, cols);
  return cols;
}

function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  const lowerMap = new Map<string, string>();
  columns.forEach((c) => lowerMap.set(c.toLowerCase(), c));
  for (const candidate of candidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseIntuitions(
  intuitionsPayload: string | null | undefined,
  chainOfThought: string | null | undefined
): Array<{ name: string; applies: boolean; explanation: string; raw: string }> {
  const fromIntuitions: Array<{ name: string; applies: boolean; explanation: string; raw: string }> = [];
  const rawIntuitions = String(intuitionsPayload || '').trim();
  if (rawIntuitions) {
    try {
      const parsed = JSON.parse(rawIntuitions);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          const payload: any = value || {};
          const status = String(payload.status || payload.applies || '').toUpperCase();
          const applies = status.includes('APPLIES') && !status.includes('DOES NOT APPLY');
          const name = String(payload.rca_category || key || '').replace(/_/g, ' ').trim();
          if (!name) continue;
          fromIntuitions.push({
            name,
            applies,
            explanation: String(payload.justification || payload.explanation || payload.reason || '').trim(),
            raw: typeof value === 'string' ? value : JSON.stringify(value),
          });
        }
      }
    } catch {
      // ignore and try other fallbacks
    }
  }
  if (fromIntuitions.length > 0) return fromIntuitions;

  if (!chainOfThought) return [];
  const text = String(chainOfThought).trim();
  if (!text) return [];

  try {
    const parsed: any = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Handles chain_of_thought format like [{section:'rca', content:'...'}]
      const sectionEntries = parsed.filter((item: any) => item && typeof item === 'object' && (item.section || item.content));
      if (sectionEntries.length > 0) {
        return sectionEntries.map((item: any) => ({
          name: String(item.section || 'evidence').replace(/_/g, ' ').trim(),
          applies: /rca|kpi|outage|alarm|ticket/i.test(String(item.section || '')),
          explanation: String(item.content || '').trim(),
          raw: String(item.content || JSON.stringify(item)),
        }));
      }
      return parsed
        .map((item) => {
          const raw = typeof item === 'string' ? item : JSON.stringify(item);
          const name = typeof item === 'string'
            ? item
            : (item?.intuition || item?.name || item?.label || raw);
          const applies = Boolean(item?.applies ?? item?.applied ?? item?.isApplied);
          return {
            name: String(name),
            applies,
            explanation: String(item?.justification || item?.explanation || item?.reason || '').trim(),
            raw,
          };
        })
        .filter((x) => x.name.trim().length > 0);
    }
  } catch {
    // not JSON, continue
  }

  const lines = text
    .split(/\r?\n|;/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const guessApply = (line: string): boolean => {
    if (/doesn'?t apply|not apply|not applied|\bfalse\b|\bx\b/i.test(line)) return false;
    if (/applies|applied|\btrue\b|\byes\b|^✓/i.test(line)) return true;
    return false;
  };

  const cleanup = (line: string): string =>
    line
      .replace(/^\d+[\).\-\s]*/, '')
      .replace(/\b(applies|applied|doesn'?t apply|not applied|not apply)\b/gi, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

  return lines.map((line) => ({
    raw: line,
    applies: guessApply(line),
    explanation: '',
    name: cleanup(line) || line,
  }));
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function parseJsonText(value: any): any {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function dummifyRcaTextWithSiteMapping(text: string): string {
  // Dummification disabled — return text unchanged so real USIDs appear in the UI.
  return text || '';
}

function pickRowField(row: any, candidates: string[]): any {
  for (const key of candidates) {
    if (row[key] !== undefined) return row[key];
  }
  const lowerMap = new Map<string, any>();
  Object.keys(row || {}).forEach((k) => lowerMap.set(k.toLowerCase(), row[k]));
  for (const key of candidates) {
    const hit = lowerMap.get(key.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * GET /api/sites/layers/status
 * Get per-date map layer site sets for outage and overutilization overlays.
 * Query params:
 *   - dateId: YYYY-MM-DD (optional)
 */
router.get('/layers/status', asyncHandler(async (req: Request, res: Response) => {
  const dateId = String(req.query.dateId || '').trim();
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateId)
    ? dateId
    : new Date().toISOString().slice(0, 10);

  try {
    if (!siteIdMapper.getStats().initialized) {
      await siteIdMapper.initialize();
    }

    const data = await cacheOrFetch(
      `map:layers:status:${requestedDate}`,
      async () => {
        const resolvedDateSql = `
SELECT TOP 1 CAST(DATE_ID AS DATE) AS RESOLVED_DATE
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE DATE_ID <= CAST('${escapeSqlLiteral(requestedDate)}' AS DATETIME)
ORDER BY DATE_ID DESC
`;
        const resolvedRows = await remoteDbConnector.query(resolvedDateSql);
        const resolvedDate = String(pickRowField(resolvedRows?.[0] || {}, ['RESOLVED_DATE', 'resolved_date']) || requestedDate).slice(0, 10);

        const sqlQuery = `
WITH cell_metrics AS (
  SELECT
    CAST(USID AS VARCHAR(64)) AS USID,
    DATE_ID,
    cell_name,
    MAX(CASE WHEN kpi_name IN ('PMDOWNTIMEAUTO', 'EUCELL_DOWNTIME_AUTO') THEN TRY_CAST(kpi_value AS FLOAT) END) AS pmd_auto,
    MAX(CASE WHEN kpi_name IN ('PMDOWNTIMEMANUAL', 'EUCELL_DOWNTIME_MANUAL') THEN TRY_CAST(kpi_value AS FLOAT) END) AS pmd_manual,
    MAX(CASE WHEN kpi_name IN ('AVG_DL_PRB_UTIL', 'DL_PRB_UTIL', 'DL_PRB_UTILIZATION') THEN TRY_CAST(kpi_value AS FLOAT) END) AS prb_util,
    MAX(CASE WHEN kpi_name = 'DUAC_FAIL' THEN TRY_CAST(kpi_value AS FLOAT) END) AS duac_fail
  FROM intermediate_kpi_table WITH (NOLOCK)
  WHERE DATE_ID >= CAST('${escapeSqlLiteral(resolvedDate)}' AS DATETIME)
    AND DATE_ID < DATEADD(day, 1, CAST('${escapeSqlLiteral(resolvedDate)}' AS DATETIME))
    AND kpi_name IN ('PMDOWNTIMEAUTO', 'PMDOWNTIMEMANUAL', 'EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'AVG_DL_PRB_UTIL', 'DL_PRB_UTIL', 'DL_PRB_UTILIZATION', 'DUAC_FAIL')
  GROUP BY CAST(USID AS VARCHAR(64)), DATE_ID, cell_name
),
site_map AS (
  SELECT
    CAST(USID AS VARCHAR(64)) AS USID,
    CAST(SiteID AS VARCHAR(64)) AS SITE_ID
  FROM site_table WITH (NOLOCK)
  WHERE DATE_ID >= CAST('${escapeSqlLiteral(resolvedDate)}' AS DATETIME)
    AND DATE_ID < DATEADD(day, 1, CAST('${escapeSqlLiteral(resolvedDate)}' AS DATETIME))
  GROUP BY CAST(USID AS VARCHAR(64)), CAST(SiteID AS VARCHAR(64))
),
site_rollup AS (
  SELECT
    USID,
    COUNT(*) AS total_cells,
    SUM(CASE WHEN COALESCE(pmd_auto, 0) + COALESCE(pmd_manual, 0) > 3600 THEN 1 ELSE 0 END) AS outage_cells,
    SUM(CASE WHEN COALESCE(prb_util, 0) > 70 OR COALESCE(duac_fail, 0) > 5000 THEN 1 ELSE 0 END) AS overutil_cells
  FROM cell_metrics
  GROUP BY USID
)
SELECT
  sr.USID,
  sm.SITE_ID,
  total_cells,
  outage_cells,
  overutil_cells,
  CASE WHEN outage_cells > 0 THEN 1 ELSE 0 END AS is_outage_site,
  CASE WHEN overutil_cells > 0 THEN 1 ELSE 0 END AS is_overutilized_site
FROM site_rollup sr
LEFT JOIN site_map sm ON sm.USID = sr.USID
WHERE
  outage_cells > 0 OR overutil_cells > 0
`;

        const rows = await remoteDbConnector.query(sqlQuery);
        const outageRealUsids: string[] = [];
        const overutilizedRealUsids: string[] = [];
        const outageSiteIds: string[] = [];
        const overutilizedSiteIds: string[] = [];

        for (const row of rows || []) {
          const realUsid = String(pickRowField(row, ['USID', 'usid']) || '').trim();
          const mappedSiteId = String(pickRowField(row, ['SITE_ID', 'site_id', 'SiteID']) || '').trim();
          if (!realUsid) continue;
          const isOutage = Number(pickRowField(row, ['is_outage_site', 'IS_OUTAGE_SITE'])) === 1;
          const isOverutil = Number(pickRowField(row, ['is_overutilized_site', 'IS_OVERUTILIZED_SITE'])) === 1;
          const resolvedSiteId = mappedSiteId || siteIdMapper.getDummySiteId(realUsid) || realUsid;
          if (isOutage) {
            outageRealUsids.push(realUsid);
            outageSiteIds.push(resolvedSiteId);
          }
          if (isOverutil) {
            overutilizedRealUsids.push(realUsid);
            overutilizedSiteIds.push(resolvedSiteId);
          }
        }

        return {
          requestedDateId: requestedDate,
          dateId: resolvedDate,
          outageSiteIds: Array.from(new Set(outageSiteIds)),
          overutilizedSiteIds: Array.from(new Set(overutilizedSiteIds)),
          outageRealUsids: Array.from(new Set(outageRealUsids)),
          overutilizedRealUsids: Array.from(new Set(overutilizedRealUsids)),
        };
      },
      30
    );

    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Map layer status lookup failed, returning empty sets', err);
    res.json({
      success: true,
      data: {
        requestedDateId: requestedDate,
        dateId: requestedDate,
        outageSiteIds: [],
        overutilizedSiteIds: [],
        outageRealUsids: [],
        overutilizedRealUsids: [],
      },
      timestamp: new Date().toISOString(),
    });
  }
}));

/**
 * GET /api/sites
 * Get all sites with optional date filter
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { dateId } = req.query;
  
  const sites = await cacheOrFetch(
    dateId ? CACHE_KEYS.SITES_BY_DATE(dateId as string) : CACHE_KEYS.SITES_ALL,
    () => SiteModel.getAllSites(dateId as string | undefined),
    300
  );
  
  res.json({
    success: true,
    data: sites,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/map
 * Get sites formatted for map visualization
 */
router.get('/map', asyncHandler(async (req: Request, res: Response) => {
  const { dateId } = req.query;
  
  const mapSites = await cacheOrFetch(
    `map:sites:${dateId || 'latest'}`,
    () => SiteModel.getMapSites(dateId as string | undefined),
    900 // 15 minutes - map data doesn't change frequently
  );
  
  // Set cache headers for browser caching
  res.set('Cache-Control', 'public, max-age=900'); // 15 minutes
  res.set('ETag', `map-${dateId || 'latest'}-${new Date().toISOString().slice(0, 13)}`); // Hourly ETags
  
  res.json({
    success: true,
    data: mapSites,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/anomalies
 * Get sites with anomalies
 */
router.get('/anomalies', asyncHandler(async (req: Request, res: Response) => {
  const { severity } = req.query;
  
  const anomalousSites = await SiteModel.getAnomalousSites(
    severity as 'critical' | 'warning' | undefined
  );
  
  res.json({
    success: true,
    data: anomalousSites,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/search
 * Search sites by name or ID
 */
router.get('/search', asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query;
  
  if (!q) {
    throw new AppError(400, 'MISSING_QUERY', 'Search query (q) is required');
  }
  
  const sites = await SiteModel.searchSites(
    q as string,
    limit ? parseInt(limit as string) : 10
  );
  
  res.json({
    success: true,
    data: sites,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/dates
 * Get available date range
 */
router.get('/dates', asyncHandler(async (req: Request, res: Response) => {
  const dates = await cacheOrFetch(
    'dates:available',
    () => SiteModel.getAvailableDates(),
    600
  );
  
  res.json({
    success: true,
    data: dates,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/rca
 * Returns RCA bucket and parsed intuitions from chain_of_thought for given site/date.
 * Query params:
 *   - dateId: YYYY-MM-DD (optional; defaults to latest available for site)
 */
router.get('/:siteId/rca', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined;
  const effectiveDate = dateId && /^\d{4}-\d{2}-\d{2}$/.test(dateId) ? dateId : new Date().toISOString().slice(0, 10);

  if (!siteIdMapper.getStats().initialized) {
    try {
      await siteIdMapper.initialize();
    } catch (error: any) {
      // Mapper requires local Postgres metadata; in some environments it may be unavailable.
      // Fall back to using the numeric portion of the siteId token (UST12345 -> 12345).
      logger.warn(`⚠️ SiteIdMapper init failed; falling back to numeric siteId. ${error?.message || error}`);
    }
  }

  const normalizedNumericSiteId = String(siteId).replace(/^UST/i, '');
  const mappedRealUSID = siteIdMapper.getRealUSID(siteId) || normalizedNumericSiteId;

  const sqlQuery = `
SELECT USID, DATE_ID, chain_of_thought, rca_bucket, strongest_factors, intuitions, short_summary
FROM site_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATETIME) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATETIME)
  AND chain_of_thought IS NOT NULL
  AND CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(mappedRealUSID)}'
ORDER BY DATE_ID DESC
`;

  const result = await remoteDbConnector.query(sqlQuery);
  if (!Array.isArray(result) || result.length === 0) {
    throw new AppError(404, 'RCA_NOT_FOUND', `No RCA data found for site ${siteId} on ${effectiveDate}`);
  }

  const row = result[0];
  const usid = String(pickRowField(row, ['USID', 'usid', 'SiteID', 'site_id']) || mappedRealUSID);
  const chainOfThought = String(pickRowField(row, ['chain_of_thought', 'CHAIN_OF_THOUGHT']) || '');
  const intuitionsRaw = pickRowField(row, ['intuitions', 'INTUITIONS']);
  const rcaBucketRaw = pickRowField(row, ['rca_bucket', 'RCA_bucket', 'RCA_BUCKET']);
  const shortSummaryRaw = pickRowField(row, ['short_summary', 'SHORT_SUMMARY']);
  const confidenceRaw = pickRowField(row, ['confidence_score', 'confidence_score_int', 'CONFIDENCE_SCORE']);
  const strongestFactors = pickRowField(row, ['strongest_factors', 'STRONGEST_FACTORS']);

  const rcaBucketJson = parseJsonText(rcaBucketRaw);
  const shortSummaryJson = parseJsonText(shortSummaryRaw);
  const parsedIntuitions = parseIntuitions(intuitionsRaw ?? null, chainOfThought).map((item) => ({
    ...item,
    explanation: dummifyRcaTextWithSiteMapping(item.explanation || ''),
    raw: dummifyRcaTextWithSiteMapping(item.raw || ''),
  }));
  const confidenceJson = parseJsonText(confidenceRaw);
  const confidenceScore = Number(
    typeof confidenceJson?.score === 'string' || typeof confidenceJson?.score === 'number'
      ? confidenceJson.score
      : confidenceRaw
  );

  const rcaBucketText = dummifyRcaTextWithSiteMapping(
    rcaBucketJson?.text || String(rcaBucketRaw || '')
  );
  const shortSummaryText = dummifyRcaTextWithSiteMapping(
    shortSummaryJson?.text || String(shortSummaryRaw || '')
  );

  res.json({
    success: true,
    data: {
      siteId: usid,
      dateId: pickRowField(row, ['DATE_ID', 'date_id']) || effectiveDate,
      rcaBucket: rcaBucketText || null,
      chainOfThought: chainOfThought || null,
      strongestFactors: strongestFactors || null,
      shortSummary: shortSummaryText || null,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : null,
      intuitions: parsedIntuitions,
    },
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/analysis/comprehensive', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined;

  const data = await cacheOrFetch(
    `sites:${siteId}:analysis:comprehensive:${dateId || 'latest'}`,
    () => SiteAnalysisModel.getComprehensiveAnalysis(siteId, dateId),
    180
  );

  if (!data) {
    throw new AppError(404, 'SITE_ANALYSIS_NOT_FOUND', `No comprehensive analysis found for site ${siteId}`);
  }

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/cell-topology', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined;

  const data = await cacheOrFetch(
    `sites:${siteId}:cell-topology:${dateId || 'latest'}`,
    () => SiteAnalysisModel.getCellTopology(siteId, dateId),
    300
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/cell-kpis', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const rawKpiNames = String(req.query.kpiNames || req.query.kpi_names || '').trim();
  if (!rawKpiNames) {
    throw new AppError(400, 'KPI_NAMES_REQUIRED', 'kpiNames is required');
  }

  const viewType = String(req.query.viewType || req.query.view_type || 'daily') as 'daily' | 'hourly' | 'timeline' | 'overlay';
  const kpiNames = rawKpiNames.split(',').map((value) => value.trim()).filter(Boolean);

  const data = await cacheOrFetch(
    `sites:${siteId}:cell-kpis:${viewType}:${kpiNames.join('|')}:${req.query.startDate || req.query.start_date || ''}:${req.query.endDate || req.query.end_date || ''}:${req.query.dateId || req.query.date || ''}`,
    () => SiteAnalysisModel.getCellKpis(siteId, {
      kpiNames,
      viewType,
      startDate: req.query.startDate as string | undefined || req.query.start_date as string | undefined,
      endDate: req.query.endDate as string | undefined || req.query.end_date as string | undefined,
      dateId: req.query.dateId as string | undefined || req.query.date as string | undefined,
    }),
    180
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/available-kpis', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const viewType = String(req.query.viewType || req.query.view_type || 'daily') as 'daily' | 'hourly' | 'timeline' | 'overlay';
  const data = await cacheOrFetch(
    `sites:${siteId}:available-kpis:${viewType}`,
    () => SiteAnalysisModel.getAvailableKpis(siteId, viewType),
    600
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/mobility-trends', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined || req.query.date as string | undefined;
  const days = Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1);
  const data = await cacheOrFetch(
    `sites:${siteId}:mobility:${dateId || 'latest'}:${days}`,
    () => SiteAnalysisModel.getMobilityTrends(siteId, dateId, days),
    180
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/traffic-profile', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined || req.query.date as string | undefined;
  const data = await cacheOrFetch(
    `sites:${siteId}:traffic-profile:${dateId || 'latest'}`,
    () => SiteAnalysisModel.getTrafficProfile(siteId, dateId),
    180
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/outages', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined || req.query.date as string | undefined;
  const days = Math.max(parseInt(String(req.query.days || '7'), 10) || 7, 1);
  const data = await cacheOrFetch(
    `sites:${siteId}:outages:${dateId || 'latest'}:${days}`,
    () => SiteAnalysisModel.getOutages(siteId, dateId, days),
    180
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/cqx', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined || req.query.date as string | undefined;
  const days = Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1);
  const dataType = String(req.query.dataType || req.query.data_type || 'impact') === 'value' ? 'value' : 'impact';
  const data = await cacheOrFetch(
    `sites:${siteId}:cqx:${dateId || 'latest'}:${days}:${dataType}`,
    () => SiteAnalysisModel.getCqxData(siteId, dateId, days, dataType),
    180
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/:siteId/operational-info', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined;
  const limit = Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1);
  const data = await cacheOrFetch(
    `sites:${siteId}:operational-info:${dateId || 'latest'}:${limit}`,
    () => SiteAnalysisModel.getOperationalInfo(siteId, dateId, limit),
    180
  );

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId
 * Get detailed information about a specific site
 */
router.get('/:siteId', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { dateId } = req.query;
  
  const site = await cacheOrFetch(
    CACHE_KEYS.SITE_DETAILS(siteId) + (dateId ? `:${dateId}` : ''),
    () => SiteModel.getSiteById(siteId, dateId as string | undefined),
    300
  );
  
  if (!site) {
    throw new AppError(404, 'SITE_NOT_FOUND', `Site ${siteId} not found`);
  }
  
  res.json({
    success: true,
    data: site,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/cells
 * Get all cells for a site
 */
router.get('/:siteId/cells', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { dateId } = req.query;
  
  const cells = await cacheOrFetch(
    `cells:site:${siteId}:${dateId || 'latest'}`,
    () => CellModel.getCellsBySite(siteId, dateId as string | undefined),
    600 // 10 minutes
  );
  
  // Set cache headers
  res.set('Cache-Control', 'public, max-age=600'); // 10 minutes
  
  res.json({
    success: true,
    data: cells,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/info
 * Get site operational info (tickets + alarms) for optional date.
 * Query params:
 *   - dateId: YYYY-MM-DD (optional)
 *   - limit: row limit per table (default 50, max 200)
 */
router.get('/:siteId/info', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const dateId = req.query.dateId as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const normalizedNumericSiteId = String(siteId).replace(/^UST/i, '');

  const [ticketCols, alarmCols] = await Promise.all([
    getTableColumns('ticket_table'),
    getTableColumns('alarm_table'),
  ]);

  const ticketSiteCol = pickColumn(ticketCols, ['SiteID', 'site_id', 'USID', 'usid']);
  const ticketDateCol = pickColumn(ticketCols, ['DATE_ID', 'DateID', 'date_id']);
  const alarmSiteCol = pickColumn(alarmCols, ['SiteID', 'site_id', 'USID', 'usid']);
  const alarmDateCol = pickColumn(alarmCols, ['DATE_ID', 'DateID', 'date_id']);

  const tickets: any[] = [];
  const alarms: any[] = [];

  if (ticketSiteCol) {
    const baseTicketSelect = `
      SELECT
        ${pickColumn(ticketCols, ['TICKET_NUMBER', 'TicketNumber', 'ticket_number']) ? `${quoteIdent(pickColumn(ticketCols, ['TICKET_NUMBER', 'TicketNumber', 'ticket_number']) as string)}` : 'NULL'} as ticket_number,
        ${pickColumn(ticketCols, ['TICKET_STATUS', 'ticket_status']) ? `${quoteIdent(pickColumn(ticketCols, ['TICKET_STATUS', 'ticket_status']) as string)}` : 'NULL'} as ticket_status,
        ${pickColumn(ticketCols, ['SHORT_DESCRIPTION', 'short_description']) ? `${quoteIdent(pickColumn(ticketCols, ['SHORT_DESCRIPTION', 'short_description']) as string)}` : 'NULL'} as short_description,
        ${pickColumn(ticketCols, ['PROBLEM_CATEGORY', 'problem_category']) ? `${quoteIdent(pickColumn(ticketCols, ['PROBLEM_CATEGORY', 'problem_category']) as string)}` : 'NULL'} as problem_category,
        ${pickColumn(ticketCols, ['ASSIGNED_TO', 'assigned_to']) ? `${quoteIdent(pickColumn(ticketCols, ['ASSIGNED_TO', 'assigned_to']) as string)}` : 'NULL'} as assigned_to,
        ${pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) ? `${quoteIdent(pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) as string)}` : 'NULL'} as create_time,
        ${ticketDateCol ? `${quoteIdent(ticketDateCol)}` : 'NULL'} as date_id
      FROM ticket_table
      WHERE (${quoteIdent(ticketSiteCol)}::text = $1::text OR ${quoteIdent(ticketSiteCol)}::text = $2::text)
    `;

    const siteParams = [siteId, normalizedNumericSiteId];
    let ticketResult;
    if (dateId && ticketDateCol) {
      ticketResult = await pool.query(
        `${baseTicketSelect} AND ${quoteIdent(ticketDateCol)} = $3::date ORDER BY COALESCE(${pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) ? `${quoteIdent(pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) as string)}` : 'NOW()'}, NOW()) DESC LIMIT $4`,
        [...siteParams, dateId, limit]
      );
      if (!ticketResult.rows.length) {
        ticketResult = await pool.query(
          `${baseTicketSelect} AND ${quoteIdent(ticketDateCol)} <= $3::date ORDER BY ${quoteIdent(ticketDateCol)} DESC, COALESCE(${pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) ? `${quoteIdent(pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) as string)}` : 'NOW()'}, NOW()) DESC LIMIT $4`,
          [...siteParams, dateId, limit]
        );
      }
    } else {
      ticketResult = await pool.query(
        `${baseTicketSelect} ORDER BY COALESCE(${pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) ? `${quoteIdent(pickColumn(ticketCols, ['CREATE_TIME', 'create_time']) as string)}` : 'NOW()'}, NOW()) DESC LIMIT $3`,
        [...siteParams, limit]
      );
    }
    tickets.push(...ticketResult.rows);
  }

  if (alarmSiteCol) {
    const baseAlarmSelect = `
      SELECT
        ${pickColumn(alarmCols, ['IDENTIFIER', 'identifier']) ? `${quoteIdent(pickColumn(alarmCols, ['IDENTIFIER', 'identifier']) as string)}` : 'NULL'} as identifier,
        ${pickColumn(alarmCols, ['SUMMARY', 'summary']) ? `${quoteIdent(pickColumn(alarmCols, ['SUMMARY', 'summary']) as string)}` : 'NULL'} as summary,
        ${pickColumn(alarmCols, ['MSGSEVERITY_NAME', 'msgseverity_name']) ? `${quoteIdent(pickColumn(alarmCols, ['MSGSEVERITY_NAME', 'msgseverity_name']) as string)}` : 'NULL'} as severity,
        ${pickColumn(alarmCols, ['CLASS_NAME', 'class_name']) ? `${quoteIdent(pickColumn(alarmCols, ['CLASS_NAME', 'class_name']) as string)}` : 'NULL'} as class_name,
        ${pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) ? `${quoteIdent(pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) as string)}` : 'NULL'} as last_occurrence,
        ${alarmDateCol ? `${quoteIdent(alarmDateCol)}` : 'NULL'} as date_id
      FROM alarm_table
      WHERE (${quoteIdent(alarmSiteCol)}::text = $1::text OR ${quoteIdent(alarmSiteCol)}::text = $2::text)
    `;

    const siteParams = [siteId, normalizedNumericSiteId];
    let alarmResult;
    if (dateId && alarmDateCol) {
      alarmResult = await pool.query(
        `${baseAlarmSelect} AND ${quoteIdent(alarmDateCol)} = $3::date ORDER BY COALESCE(${pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) ? `${quoteIdent(pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) as string)}` : 'NOW()'}, NOW()) DESC LIMIT $4`,
        [...siteParams, dateId, limit]
      );
      if (!alarmResult.rows.length) {
        alarmResult = await pool.query(
          `${baseAlarmSelect} AND ${quoteIdent(alarmDateCol)} <= $3::date ORDER BY ${quoteIdent(alarmDateCol)} DESC, COALESCE(${pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) ? `${quoteIdent(pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) as string)}` : 'NOW()'}, NOW()) DESC LIMIT $4`,
          [...siteParams, dateId, limit]
        );
      }
    } else {
      alarmResult = await pool.query(
        `${baseAlarmSelect} ORDER BY COALESCE(${pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) ? `${quoteIdent(pickColumn(alarmCols, ['LASTOCCURRENCE', 'lastoccurrence']) as string)}` : 'NOW()'}, NOW()) DESC LIMIT $3`,
        [...siteParams, limit]
      );
    }
    alarms.push(...alarmResult.rows);
  }

  res.json({
    success: true,
    data: {
      siteId,
      dateId: dateId || null,
      tickets,
      alarms,
      counts: { tickets: tickets.length, alarms: alarms.length },
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/kpis
 * Get latest KPI values for a site
 */
router.get('/:siteId/kpis', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  
  const kpis = await cacheOrFetch(
    `kpis:site:${siteId}:latest`,
    () => KPIModel.getLatestKPIs(siteId),
    180
  );
  
  res.json({
    success: true,
    data: kpis,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/kpis/batch
 * Fetch ALL common KPIs for a site in a single DB round-trip.
 * Returns Record<kpiName, KPIQueryResult>.
 * Query params:
 *   - endDate: YYYY-MM-DD (defaults to today)
 *   - granularity: 'daily' | 'hourly' (default 'daily')
 *   - kpis: comma-separated list to filter the response (optional)
 */
router.get('/:siteId/kpis/batch', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const endDate = req.query.endDate as string | undefined;
  const granularity = (req.query.granularity === 'hourly' ? 'hourly' : 'daily') as 'daily' | 'hourly';
  const kpisFilter = req.query.kpis ? String(req.query.kpis).split(',').map(s => s.trim()).filter(Boolean) : null;

  const bundle = await KPIModel.getKPIBatch(siteId, endDate, granularity);

  const result = kpisFilter
    ? Object.fromEntries(Object.entries(bundle).filter(([k]) => kpisFilter.includes(k)))
    : bundle;

  res.json({
    success: true,
    data: result,
    kpiCount: Object.keys(result).length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/kpis/:kpiName
 * Get time series for a specific KPI at a site
 * Query params:
 *   - days: number of days (default 7, 0 for all)
 *   - granularity: 'daily' | 'hourly' (default 'daily')
 *   - endDate: YYYY-MM-DD (optional; when provided, backend uses 30-day window ending on this date)
 */
router.get('/:siteId/kpis/:kpiName', asyncHandler(async (req: Request, res: Response) => {
  const { siteId, kpiName } = req.params;
  const daysParam = req.query.days;
  const granularity = (req.query.granularity as string) || 'daily';
  const endDate = req.query.endDate as string | undefined;
  
  // Validate granularity
  if (granularity !== 'daily' && granularity !== 'hourly') {
    throw new AppError(400, 'INVALID_GRANULARITY', 'Granularity must be "daily" or "hourly"');
  }
  
  // Support days=0 for "entire range"; default 7 only when param is missing
  const days =
    daysParam !== undefined && daysParam !== ''
      ? parseInt(daysParam as string, 10)
      : 7;
  const cacheKey = `${CACHE_KEYS.KPI_TIMESERIES(siteId, kpiName)}:${days}:${granularity}:${endDate || 'none'}`;

  // Bypass cache for "all data" (days=0 or large window) so new data shows immediately
  const useCache = days > 0 && days <= 90;
  const kpiData = useCache
    ? await cacheOrFetch(
        cacheKey,
        () => KPIModel.getKPITimeSeries(siteId, kpiName, days, granularity as 'daily' | 'hourly', endDate),
        180
      )
    : await KPIModel.getKPITimeSeries(siteId, kpiName, days, granularity as 'daily' | 'hourly', endDate);
  
  if (!kpiData) {
    throw new AppError(404, 'KPI_NOT_FOUND', `KPI ${kpiName} not found for site ${siteId}`);
  }
  
  res.json({
    success: true,
    data: kpiData,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/sectors/all
 * Get all cell sectors with site coordinates for map visualization
 */
router.get('/sectors/all', asyncHandler(async (req: Request, res: Response) => {
  const { dateId, limit } = req.query;

  const dateStr = typeof dateId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateId) ? dateId : new Date().toISOString().slice(0, 10);
  const hardLimit = limit ? Math.min(Math.max(parseInt(String(limit), 10) || 1, 1), 25000) : undefined;

  const sectors = await cacheOrFetch(
    `sectors:all:remote:${dateStr}:${hardLimit || 'unlimited'}`,
    async () => {
      const rows = await CompassModel.getCellSectors(dateStr);
      const mapped = rows.map((row: any) => ({
        CellID: String(row.USEID ?? row.useid ?? ''),
        CellName: String(row.cell_name ?? row.CELL_NAME ?? row.USEID ?? ''),
        SiteID: String(row.USID ?? row.usid ?? ''),
        SiteName: String(row.USID ?? row.usid ?? ''),
        Technology: String(row.TECH ?? row.tech ?? ''),
        Carrier: String(row.CARRIER ?? row.carrier ?? ''),
        Azimuth: Number(row.azimuth ?? row.AZIMUTH ?? 1.0) || 1.0,
        Height: Number(row.HEIGHT ?? row.height ?? 0) || 0,
        SiteLatitude: Number(row.site_latitude ?? row.latitude ?? row.LATITUDE ?? 0) || 0,
        SiteLongitude: Number(row.site_longitude ?? row.longitude ?? row.LONGITUDE ?? 0) || 0,
        CellLatitude: Number(row.cell_latitude ?? row.latitude ?? row.LATITUDE ?? 0) || 0,
        CellLongitude: Number(row.cell_longitude ?? row.longitude ?? row.LONGITUDE ?? 0) || 0,
        CellAnomalyFlag: Boolean(Number(row.cell_anomaly_flag ?? 0)),
        CellAnomalyScore: Number(row.cell_anomaly_score ?? 0) || 0,
        SiteAnomalyFlag: Boolean(Number(row.site_anomaly_flag ?? 0)),
        SiteAnomalyScore: Number(row.site_anomaly_score ?? 0) || 0,
        CellCount: Number(row.CellCount ?? row.cell_count ?? 0) || 0,
        DateID: String(row.DATE_ID ?? row.date_id ?? dateStr),
      }));
      return hardLimit ? mapped.slice(0, hardLimit) : mapped;
    },
    900 // 15 minutes
  );
  
  // Set cache headers
  res.set('Cache-Control', 'public, max-age=900');
  
  res.json({
    success: true,
    data: sectors,
    count: sectors.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/sites/:siteId/sectors
 * Get sectors for a specific site
 */
router.get('/:siteId/sectors', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { dateId } = req.query;

  const dateStr = typeof dateId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateId) ? dateId : new Date().toISOString().slice(0, 10);
  const normalizedTokens = new Set<string>();
  const raw = String(siteId || '').trim();
  if (raw) {
    normalizedTokens.add(raw);
    normalizedTokens.add(raw.toUpperCase());
    normalizedTokens.add(raw.replace(/^UST/i, ''));
    normalizedTokens.add(raw.toUpperCase().replace(/^UST/i, ''));
  }

  const sectors = await cacheOrFetch(
    `sectors:site:remote:${siteId}:${dateStr}`,
    async () => {
      const rows = await CompassModel.getCellSectors(dateStr);
      return rows
        .filter((row: any) => {
          const usid = String(row.USID ?? row.usid ?? '').trim();
          if (!usid) return false;
          return normalizedTokens.has(usid) || normalizedTokens.has(usid.toUpperCase());
        })
        .map((row: any) => ({
          CellID: String(row.USEID ?? row.useid ?? ''),
          CellName: String(row.cell_name ?? row.CELL_NAME ?? row.USEID ?? ''),
          SiteID: String(row.USID ?? row.usid ?? ''),
          SiteName: String(row.USID ?? row.usid ?? ''),
          Technology: String(row.TECH ?? row.tech ?? ''),
          Carrier: String(row.CARRIER ?? row.carrier ?? ''),
          Azimuth: Number(row.azimuth ?? row.AZIMUTH ?? 1.0) || 1.0,
          Height: Number(row.HEIGHT ?? row.height ?? 0) || 0,
          SiteLatitude: Number(row.site_latitude ?? row.latitude ?? row.LATITUDE ?? 0) || 0,
          SiteLongitude: Number(row.site_longitude ?? row.longitude ?? row.LONGITUDE ?? 0) || 0,
          CellLatitude: Number(row.cell_latitude ?? row.latitude ?? row.LATITUDE ?? 0) || 0,
          CellLongitude: Number(row.cell_longitude ?? row.longitude ?? row.LONGITUDE ?? 0) || 0,
          CellAnomalyFlag: Boolean(Number(row.cell_anomaly_flag ?? 0)),
          CellAnomalyScore: Number(row.cell_anomaly_score ?? 0) || 0,
          SiteAnomalyFlag: Boolean(Number(row.site_anomaly_flag ?? 0)),
          SiteAnomalyScore: Number(row.site_anomaly_score ?? 0) || 0,
          CellCount: Number(row.CellCount ?? row.cell_count ?? 0) || 0,
          DateID: String(row.DATE_ID ?? row.date_id ?? dateStr),
        }));
    },
    600 // 10 minutes
  );
  
  res.json({
    success: true,
    data: sectors,
    count: sectors.length,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
