/**
 * Offender Sites Routes - API endpoints for querying congested and problematic sites
 */
import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { siteIdMapper } from '../services/site-id-mapper.service.js';

const router = express.Router();
const naavikConnector = new NaavikDBConnector();

// ─── Column-name helpers (mirrors site.routes.ts pattern) ────────────────────

/** Pick the first matching column name from a set, case-insensitively. */
function pickCol(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (cols.has(c)) return c;
  }
  const lower = new Map<string, string>();
  cols.forEach((c) => lower.set(c.toLowerCase(), c));
  for (const c of candidates) {
    const hit = lower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Safely double-quote a PostgreSQL identifier. */
function qi(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Per-table column-name cache (populated once, reused across requests). */
const _colCache = new Map<string, Set<string>>();

async function getTableCols(tableName: string): Promise<Set<string>> {
  if (_colCache.has(tableName)) return _colCache.get(tableName)!;
  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tableName]
  );
  const cols = new Set<string>(res.rows.map((r: any) => String(r.column_name)));
  _colCache.set(tableName, cols);
  return cols;
}

// Candidate lists for the columns we care about.
const DATE_COLS   = ['DateID', 'DATE_ID', 'date_id'];
const SITE_COLS   = ['SiteID', 'SITE_ID', 'site_id'];
const CELL_COLS   = ['CellID', 'CELL_ID', 'cell_id'];
const KPIN_COLS   = ['KPIName', 'KPI_NAME', 'kpi_name', 'kpiname'];
const KPIV_COLS   = ['KPIValue', 'KPI_VALUE', 'kpi_value', 'kpivalue'];
const SCORE_COLS  = ['AnomalyScore', 'ANOMALY_SCORE', 'anomaly_score'];
const FLAG_COLS   = ['AnomalyFlag', 'ANOMALY_FLAG', 'anomaly_flag'];
const NAME_COLS   = ['SiteName', 'SITE_NAME', 'site_name'];
const LAT_COLS    = ['Latitude', 'LATITUDE', 'latitude'];
const LON_COLS    = ['Longitude', 'LONGITUDE', 'longitude'];
const CCNT_COLS   = ['CellCount', 'CELL_COUNT', 'cell_count'];

/**
 * GET /api/offenders/super-kpi
 * Get Super KPI offender site IDs (sites with chain_of_thought, sorted by source impact metric)
 * Queries data adapter API, maps USIDs to dummy SiteIDs for map display.
 * Query param: dateId (default 2025-01-10)
 */
const getSuperKpiOffendersHandler = async (req: express.Request, res: express.Response) => {
  try {
    const dateId = (req.query.dateId as string) || '2025-01-10';
    const debug = req.query.debug === 'true';
    const useLocal = req.query.useLocal === 'true'; // Force local fallback

    let offenderSiteIds: string[] = [];
    let usids: any[] = [];
    let source: 'remote' | 'local_fallback' = 'remote';

    // Try remote data adapter first (unless useLocal=true)
    if (!useLocal) {
      try {
        usids = await naavikConnector.getOffenderUSIDs(dateId);
      } catch (remoteErr: any) {
        logger.warn('Remote data adapter failed, falling back to local:', remoteErr.message);
      }
    }

    if (usids.length > 0) {
      // Map remote USIDs to our dummy SiteIDs
      await siteIdMapper.initialize();
      for (const row of usids) {
        const usid = row.USID || row.usid;
        const dummySiteId = siteIdMapper.getDummySiteId(usid);
        if (dummySiteId) {
          offenderSiteIds.push(dummySiteId);
        }
      }
    }

    // Fallback: query local offender truth table when remote returns 0
    // Join with filtered_sites so we only return offenders that appear on the map
    if (offenderSiteIds.length === 0) {
      source = 'local_fallback';
      // Try requested date first, then fall back to latest available date
      let localResult = await pool.query(
        `SELECT c."SiteID" FROM cqx_offenders_truth_table c
         INNER JOIN filtered_sites f ON c."SiteID" = f."SiteID"
         WHERE c."DateID" = $1
         ORDER BY COALESCE(c."TOTAL_IMPACT_LATEST", 0) DESC
         LIMIT 50`,
        [dateId]
      );
      if (localResult.rows.length === 0) {
        const latestRow = await pool.query(
          `SELECT "DateID" FROM cqx_offenders_truth_table ORDER BY "DateID" DESC LIMIT 1`
        );
        const fallbackDate = latestRow.rows[0]?.DateID;
        if (fallbackDate) {
          logger.info(`No offenders for ${dateId}, using latest date ${fallbackDate}`);
          localResult = await pool.query(
            `SELECT c."SiteID" FROM cqx_offenders_truth_table c
             INNER JOIN filtered_sites f ON c."SiteID" = f."SiteID"
             WHERE c."DateID" = $1
             ORDER BY COALESCE(c."TOTAL_IMPACT_LATEST", 0) DESC
             LIMIT 50`,
            [fallbackDate]
          );
          if (localResult.rows.length > 0) {
            (req as any)._effectiveDateId = fallbackDate;
          }
        }
      }
      offenderSiteIds = localResult.rows.map((r) => r.SiteID).filter(Boolean);
      usids = [];
      logger.info(`Local fallback: ${offenderSiteIds.length} Super KPI offenders`);
    }

    const effectiveDateId = (req as any)._effectiveDateId || dateId;
    const unmappedCount = usids.length - offenderSiteIds.length;
    const payload: Record<string, unknown> = {
      success: true,
      data: { siteIds: offenderSiteIds },
      count: offenderSiteIds.length,
      dateId: effectiveDateId,
      source,
      diagnostics: {
        usidsFromQuery: usids.length,
        mappedToMapSites: offenderSiteIds.length,
        unmappedCount,
        sampleMappedSiteIds: offenderSiteIds.slice(0, 5),
        sampleUsidsFromQuery: usids.slice(0, 3).map((r: any) => r.USID || r.usid),
      },
    };
    if (debug && usids.length > 0) {
      const unmappedUsids: string[] = [];
      await siteIdMapper.initialize();
      for (const row of usids) {
        const usid = row.USID || row.usid;
        if (!siteIdMapper.getDummySiteId(usid)) unmappedUsids.push(usid);
      }
      (payload.diagnostics as Record<string, unknown>).unmappedUsids = unmappedUsids;
      (payload.diagnostics as Record<string, unknown>).allUsidsFromQuery = usids.map((r: any) => r.USID || r.usid);
    }
    res.json(payload);
  } catch (error: any) {
    logger.error('Error fetching Super KPI offenders:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: error.message || 'Failed to fetch Super KPI offenders from data adapter',
      },
    });
  }
};

router.get('/super-kpi', getSuperKpiOffendersHandler);

/**
 * GET /api/offenders/sites
 * Get sites with congestion issues (high PRB utilization, RRC failures, etc.)
 */
router.get('/sites', async (req, res) => {
  try {
    const { limit = 50, severity, includeOutages = 'false' } = req.query;

    const [kCols, sCols] = await Promise.all([
      getTableCols('intermediate_kpi_table'),
      getTableCols('site_table'),
    ]);
    const kDate  = qi(pickCol(kCols, DATE_COLS)  ?? 'DateID');
    const kSite  = qi(pickCol(kCols, SITE_COLS)  ?? 'SiteID');
    const kCell  = qi(pickCol(kCols, CELL_COLS)  ?? 'CellID');
    const kName  = qi(pickCol(kCols, KPIN_COLS)  ?? 'KPIName');
    const kVal   = qi(pickCol(kCols, KPIV_COLS)  ?? 'KPIValue');
    const sDate  = qi(pickCol(sCols, DATE_COLS)  ?? 'DateID');
    const sSite  = qi(pickCol(sCols, SITE_COLS)  ?? 'SiteID');
    const sName  = qi(pickCol(sCols, NAME_COLS)  ?? 'SiteName');
    const sLat   = qi(pickCol(sCols, LAT_COLS)   ?? 'Latitude');
    const sLon   = qi(pickCol(sCols, LON_COLS)   ?? 'Longitude');
    const sScore = qi(pickCol(sCols, SCORE_COLS) ?? 'AnomalyScore');
    const sFlag  = qi(pickCol(sCols, FLAG_COLS)  ?? 'AnomalyFlag');

    let query = `
      WITH congested_sites AS (
        SELECT DISTINCT
          k.${kSite},
          s.${sName},
          s.${sLat},
          s.${sLon},
          s.${sScore},
          s.${sFlag},
          COUNT(DISTINCT k.${kCell}) as affected_cells,
          MAX(CASE WHEN k.${kName} = 'AVG_DL_PRB_UTIL' THEN k.${kVal} END) as max_prb_util,
          MAX(CASE WHEN k.${kName} = 'RRC_FAIL'        THEN k.${kVal} END) as max_rrc_fail,
          MAX(CASE WHEN k.${kName} = 'DUAC_FAIL'       THEN k.${kVal} END) as max_duac_fail,
          k.${kDate}
        FROM intermediate_kpi_table k
        INNER JOIN site_table s ON k.${kSite} = s.${sSite} AND k.${kDate} = s.${sDate}
        WHERE k.${kName} IN ('AVG_DL_PRB_UTIL', 'RRC_FAIL', 'DUAC_FAIL')
          AND k.${kVal}::text != 'NaN'
          AND (
            (k.${kName} = 'AVG_DL_PRB_UTIL' AND k.${kVal} >= 90) OR
            (k.${kName} = 'RRC_FAIL'        AND k.${kVal} > 7434) OR
            (k.${kName} = 'DUAC_FAIL'       AND k.${kVal} > 1300)
          )
          AND k.${kDate} = (SELECT MAX(${kDate}) FROM intermediate_kpi_table)
    `;

    if (severity === 'critical') {
      query += ` AND s.${sScore} >= 0.85`;
    } else if (severity === 'warning') {
      query += ` AND s.${sScore} >= 0.75 AND s.${sScore} < 0.85`;
    }
    if (includeOutages === 'false') {
      query += ` AND s.${sScore} < 0.9`;
    }

    query += `
        GROUP BY k.${kSite}, s.${sName}, s.${sLat}, s.${sLon},
                 s.${sScore}, s.${sFlag}, k.${kDate}
        ORDER BY s.${sScore} DESC, affected_cells DESC
      )
      SELECT * FROM congested_sites
      LIMIT $1
    `;

    const result = await pool.query(query, [parseInt(limit as string)]);

    const response = result.rows.map((row: any) => ({
      siteId:            row.SiteID   ?? row.SITE_ID   ?? row.site_id,
      siteName:          row.SiteName ?? row.SITE_NAME ?? row.site_name,
      latitude:          parseFloat(row.Latitude   ?? row.LATITUDE   ?? row.latitude),
      longitude:         parseFloat(row.Longitude  ?? row.LONGITUDE  ?? row.longitude),
      anomalyScore:      parseFloat(row.AnomalyScore ?? row.ANOMALY_SCORE ?? row.anomaly_score),
      anomalyFlag:       row.AnomalyFlag ?? row.ANOMALY_FLAG ?? row.anomaly_flag,
      affectedCells:     parseInt(row.affected_cells),
      maxPrbUtilization: row.max_prb_util ? parseFloat(row.max_prb_util) : null,
      maxRrcFailures:    row.max_rrc_fail ? parseFloat(row.max_rrc_fail) : null,
      maxDuacFailures:   row.max_duac_fail ? parseFloat(row.max_duac_fail) : null,
      dateId:            row.DateID ?? row.DATE_ID ?? row.date_id,
    }));
    
    logger.info(`Found ${response.length} congested offender sites`);
    
    res.json({
      success: true,
      data: response,
      count: response.length,
    });
  } catch (error) {
    logger.error('Error fetching offender sites:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch offender sites',
      },
    });
  }
});

/**
 * GET /api/offenders/outages
 * Get sites with complete outages (24h downtime)
 */
router.get('/outages', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const [kCols, sCols] = await Promise.all([
      getTableCols('intermediate_kpi_table'),
      getTableCols('site_table'),
    ]);
    const kDate  = qi(pickCol(kCols, DATE_COLS)  ?? 'DateID');
    const kSite  = qi(pickCol(kCols, SITE_COLS)  ?? 'SiteID');
    const kCell  = qi(pickCol(kCols, CELL_COLS)  ?? 'CellID');
    const kName  = qi(pickCol(kCols, KPIN_COLS)  ?? 'KPIName');
    const kVal   = qi(pickCol(kCols, KPIV_COLS)  ?? 'KPIValue');
    const sDate  = qi(pickCol(sCols, DATE_COLS)  ?? 'DateID');
    const sSite  = qi(pickCol(sCols, SITE_COLS)  ?? 'SiteID');
    const sName  = qi(pickCol(sCols, NAME_COLS)  ?? 'SiteName');
    const sLat   = qi(pickCol(sCols, LAT_COLS)   ?? 'Latitude');
    const sLon   = qi(pickCol(sCols, LON_COLS)   ?? 'Longitude');
    const sScore = qi(pickCol(sCols, SCORE_COLS) ?? 'AnomalyScore');
    const sCnt   = qi(pickCol(sCols, CCNT_COLS)  ?? 'CellCount');

    const query = `
      SELECT DISTINCT
        s.${sSite},
        s.${sName},
        s.${sLat},
        s.${sLon},
        s.${sScore},
        s.${sCnt},
        COUNT(DISTINCT k.${kCell}) as cells_with_downtime,
        MAX(k.${kVal}) as max_downtime,
        s.${sDate}
      FROM site_table s
      INNER JOIN intermediate_kpi_table k ON s.${sSite} = k.${kSite} AND s.${sDate} = k.${kDate}
      WHERE s.${sScore} >= 0.9
        AND k.${kName} IN ('EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'EUCELL_DOWNTIME_SLEEP')
        AND k.${kVal}::text != 'NaN'
        AND k.${kVal} >= 86400
        AND s.${sDate} = (SELECT MAX(${sDate}) FROM site_table)
      GROUP BY s.${sSite}, s.${sName}, s.${sLat}, s.${sLon},
               s.${sScore}, s.${sCnt}, s.${sDate}
      ORDER BY s.${sScore} DESC, cells_with_downtime DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [parseInt(limit as string)]);

    const response = result.rows.map((row: any) => ({
      siteId:             row.SiteID   ?? row.SITE_ID   ?? row.site_id,
      siteName:           row.SiteName ?? row.SITE_NAME ?? row.site_name,
      latitude:           parseFloat(row.Latitude   ?? row.LATITUDE   ?? row.latitude),
      longitude:          parseFloat(row.Longitude  ?? row.LONGITUDE  ?? row.longitude),
      anomalyScore:       parseFloat(row.AnomalyScore ?? row.ANOMALY_SCORE ?? row.anomaly_score),
      cellCount:          parseInt(row.CellCount ?? row.CELL_COUNT ?? row.cell_count),
      cellsWithDowntime:  parseInt(row.cells_with_downtime),
      maxDowntimeSeconds: parseFloat(row.max_downtime),
      dateId:             row.DateID ?? row.DATE_ID ?? row.date_id,
    }));
    
    logger.info(`Found ${response.length} outage sites`);
    
    res.json({
      success: true,
      data: response,
      count: response.length,
    });
  } catch (error) {
    logger.error('Error fetching outage sites:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch outage sites',
      },
    });
  }
});

/**
 * GET /api/offenders/summary
 * Get summary statistics of network problems
 */
router.get('/summary', async (req, res) => {
  try {
    const [kCols, sCols] = await Promise.all([
      getTableCols('intermediate_kpi_table'),
      getTableCols('site_table'),
    ]);
    const sDate  = qi(pickCol(sCols, DATE_COLS)  ?? 'DateID');
    const sSite  = qi(pickCol(sCols, SITE_COLS)  ?? 'SiteID');
    const sScore = qi(pickCol(sCols, SCORE_COLS) ?? 'AnomalyScore');
    const kDate  = qi(pickCol(kCols, DATE_COLS)  ?? 'DateID');
    const kSite  = qi(pickCol(kCols, SITE_COLS)  ?? 'SiteID');
    const kName  = qi(pickCol(kCols, KPIN_COLS)  ?? 'KPIName');
    const kVal   = qi(pickCol(kCols, KPIV_COLS)  ?? 'KPIValue');

    const query = `
      WITH latest_date AS (
        SELECT ${sDate} as date_id
        FROM site_table
        GROUP BY ${sDate}
        HAVING COUNT(*) > 100
        ORDER BY ${sDate} DESC
        LIMIT 1
      ),
      outage_sites AS (
        SELECT COUNT(DISTINCT ${sSite}) as count
        FROM site_table
        WHERE ${sScore} >= 0.9
          AND ${sDate} = (SELECT date_id FROM latest_date)
      ),
      congested_sites AS (
        SELECT COUNT(DISTINCT k.${kSite}) as count
        FROM intermediate_kpi_table k
        WHERE k.${kName} IN ('AVG_DL_PRB_UTIL', 'RRC_FAIL', 'DUAC_FAIL')
          AND k.${kVal}::text != 'NaN'
          AND (
            (k.${kName} = 'AVG_DL_PRB_UTIL' AND k.${kVal} >= 90) OR
            (k.${kName} = 'RRC_FAIL'        AND k.${kVal} > 7434) OR
            (k.${kName} = 'DUAC_FAIL'       AND k.${kVal} > 1300)
          )
          AND k.${kDate} = (SELECT date_id FROM latest_date)
      ),
      total_sites AS (
        SELECT COUNT(DISTINCT ${sSite}) as count
        FROM site_table
        WHERE ${sDate} = (SELECT date_id FROM latest_date)
      )
      SELECT
        (SELECT count FROM outage_sites)   as outage_count,
        (SELECT count FROM congested_sites) as congested_count,
        (SELECT count FROM total_sites)     as total_count,
        (SELECT date_id FROM latest_date)   as date_id
    `;

    const result = await pool.query(query);
    const row = result.rows[0];
    
    res.json({
      success: true,
      data: {
        outageSites: parseInt(row.outage_count || 0),
        congestedSites: parseInt(row.congested_count || 0),
        totalSites: parseInt(row.total_count || 0),
        healthySites: parseInt(row.total_count || 0) - parseInt(row.outage_count || 0) - parseInt(row.congested_count || 0),
        dateId: row.date_id,
      },
    });
  } catch (error) {
    logger.error('Error fetching network summary:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch network summary',
      },
    });
  }
});

export default router;
