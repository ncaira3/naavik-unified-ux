/**
 * Compass Routes
 * Telemetry analysis and offender tracking endpoints
 */
import { Router, Request, Response } from 'express';
import { CompassModel } from '../models/compass.model.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { cacheOrFetch } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ========== SITE TOPOLOGY ==========

/**
 * GET /compass/site-topology?date=
 * Get all sites with coordinates from site_table (all 6600+ sites for the map)
 * Cached 30 minutes — this is the primary map load endpoint
 */
router.get(
  '/site-topology',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { date } = req.query;
      const dateStr = date ? String(date) : undefined;
      const cacheKey = dateStr ? `compass:site-topology:${dateStr}` : 'compass:site-topology:latest';
      const data = await cacheOrFetch(cacheKey, () => CompassModel.getSiteTopology(dateStr), 1800);
      res.json({ success: true, data });
    } catch (err: any) {
      logger.error('Compass site-topology failed, returning empty dataset', err);
      res.json({ success: true, data: [] });
    }
  })
);

// ========== DATE & AVAILABILITY ==========

/**
 * GET /compass/dates
 * Get all available dates (cached 1 hour)
 */
router.get(
  '/dates',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await cacheOrFetch('compass:dates', () => CompassModel.getDates(), 3600);
    res.json(data);
  })
);

/**
 * GET /compass/dates-with-rca
 * Get dates that have RCA data (cached 1 hour)
 */
router.get(
  '/dates-with-rca',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await cacheOrFetch('compass:dates-with-rca', () => CompassModel.getDatesWithRca(), 3600);
    res.json(data);
  })
);

/**
 * GET /compass/data-availability
 * Get data availability and freshness (cached 1 hour)
 */
router.get(
  '/data-availability',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await cacheOrFetch('compass:data-availability', () => CompassModel.getDataAvailability(), 3600);
    res.json(data);
  })
);

/**
 * GET /compass/data-availability/trend/:table_name?days=
 * Daily record count trend for selected table (cached 30 min)
 */
router.get(
  '/data-availability/trend/:table_name',
  asyncHandler(async (req: Request, res: Response) => {
    const { table_name } = req.params;
    const { days = '30' } = req.query;
    const daysNum = Math.max(1, parseInt(String(days)) || 30);
    const trend = await cacheOrFetch(
      `compass:data-availability:trend:${table_name}:${daysNum}`,
      () => CompassModel.getDataAvailabilityTrend(table_name, daysNum),
      1800
    );
    res.json({ table_name, days: daysNum, trend });
  })
);

/**
 * GET /compass/data-availability/schema-analysis
 * Lightweight schema consistency checks (cached 1 hour)
 */
router.get(
  '/data-availability/schema-analysis',
  asyncHandler(async (_req: Request, res: Response) => {
    const data = await cacheOrFetch(
      'compass:data-availability:schema-analysis',
      () => CompassModel.getSchemaAnalysis(),
      3600
    );
    res.json(data);
  })
);

// ========== OFFENDERS & SITE TABLE ==========

/**
 * GET /compass/offenders?date=
 * Get top 50 offenders for a date (cached 5 min)
 */
router.get(
  '/offenders',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const data = await cacheOrFetch(`compass:offenders:${dateStr}`, () => CompassModel.getOffenders(dateStr), 300);
    res.json(data);
  })
);

/**
 * GET /compass/usids?date=&offenders_only=
 * Get all USIDs (or offenders only) plus offender impact map (cached 5 min)
 */
router.get(
  '/usids',
  asyncHandler(async (req: Request, res: Response) => {
    const { date, offenders_only = 'false' } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const d = String(date);
    const offendersOnly = String(offenders_only).toLowerCase() === 'true';
    const data = await cacheOrFetch(
      `compass:usids:${d}:${offendersOnly}`,
      () => CompassModel.getUsids(d, offendersOnly),
      300
    );
    res.json(data);
  })
);

/**
 * GET /compass/site-table?date=&page=&page_size=
 * Get paginated site table with offender details (cached 10 min)
 */
router.get(
  '/site-table',
  asyncHandler(async (req: Request, res: Response) => {
    const { date, page = '1', page_size = '50' } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const pageSize = Math.max(1, parseInt(String(page_size)) || 50);

    const data = await cacheOrFetch(
      `compass:site-table:${dateStr}:${pageNum}:${pageSize}`,
      () => CompassModel.getSiteTable(dateStr, pageNum, pageSize),
      600
    );
    res.json(data);
  })
);

// ========== CELL SECTORS ==========

/**
 * GET /compass/cell-sectors?date=
 * Get cell sectors for a date (cached 30 min)
 */
router.get(
  '/cell-sectors',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { date } = req.query;
      if (!date) {
        throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
      }
      const dateStr = String(date);
      const data = await cacheOrFetch(
        `compass:cell-sectors:${dateStr}`,
        () => CompassModel.getCellSectors(dateStr),
        1800
      );
      res.json({ success: true, data });
    } catch (err: any) {
      logger.error('Compass cell-sectors failed, returning empty dataset', err);
      res.json({ success: true, data: [] });
    }
  })
);

// ========== MARKET DASHBOARD ==========

/**
 * GET /compass/market/dashboard
 * Get market dashboard aggregated metrics (cached 15 min)
 */
router.get(
  '/market/dashboard',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await cacheOrFetch('compass:market:dashboard', () => CompassModel.getMarketDashboard(), 900);
    res.json(data);
  })
);

/**
 * GET /compass/market/offender-insights?date=
 * Market-level offender breakdown: threshold buckets, impact breakdown, top offenders, 14-day trend.
 * Cached 15 min.
 */
router.get(
  '/market/offender-insights',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const data = await cacheOrFetch(
      `compass:market:offender-insights:${dateStr}`,
      () => CompassModel.getMarketOffenderInsights(dateStr),
      900
    );
    res.json({ success: true, data });
  })
);

/**
 * GET /compass/market/cell-health?date=
 * Market-level cell health: PRB/PDCCH congestion, high drop rate, accessibility, throughput.
 * Cached 15 min.
 */
router.get(
  '/market/cell-health',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const data = await cacheOrFetch(
      `compass:market:cell-health:${dateStr}`,
      () => CompassModel.getMarketCellHealthInsights(dateStr),
      900
    );
    res.json({ success: true, data });
  })
);

// ========== SITE OPERATIONAL DATA ==========

/**
 * GET /compass/site/:usid/operational?date=
 * Get operational data for a site (alarms, tickets, etc.) (cached 5 min)
 */
router.get(
  '/site/:usid/operational',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const data = await cacheOrFetch(
      `compass:site:${usid}:operational:${dateStr}`,
      () => CompassModel.getSiteOperational(usid, dateStr),
      300
    );
    res.json(data);
  })
);

/**
 * GET /compass/operational-data/all-sites?date=
 * Get alarms/tickets/outages/config grouped for every site on selected date (cached 5 min)
 */
router.get(
  '/operational-data/all-sites',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const d = String(date);
    const operational_data = await cacheOrFetch(
      `compass:operational-data:all-sites:${d}`,
      () => CompassModel.getAllSitesOperationalData(d),
      300
    );
    res.json({ operational_data, date: d });
  })
);

// ========== NEIGHBOR DATA ==========

/**
 * GET /compass/site/:usid/neighbors?date=
 * Get neighbors for a site (cached 10 min)
 */
router.get(
  '/site/:usid/neighbors',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const data = await cacheOrFetch(
      `compass:site:${usid}:neighbors:${dateStr}`,
      () => CompassModel.getNeighbors(usid, dateStr),
      600
    );
    res.json(data);
  })
);

/**
 * GET /compass/site/:usid/neighbor-trends?days=
 * Get neighbor handover trends (cached 10 min)
 */
router.get(
  '/site/:usid/neighbor-trends',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { days = '30' } = req.query;
    const daysNum = Math.max(1, parseInt(String(days)) || 30);

    const data = await cacheOrFetch(
      `compass:site:${usid}:neighbor-trends:${daysNum}`,
      () => CompassModel.getNeighborTrends(usid, daysNum),
      600
    );
    res.json(data);
  })
);

/**
 * GET /compass/neighbor-handover-trend?source_usid=&neigh_usid=&days=
 * Trend for one specific source->neighbor relation (cached 10 min)
 */
router.get(
  '/neighbor-handover-trend',
  asyncHandler(async (req: Request, res: Response) => {
    const { source_usid, neigh_usid, days = '30' } = req.query;
    if (!source_usid || !neigh_usid) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameters: source_usid, neigh_usid');
    }
    const sourceUsid = String(source_usid);
    const neighUsid = String(neigh_usid);
    const daysNum = Math.max(1, parseInt(String(days)) || 30);
    const trend = await cacheOrFetch(
      `compass:neighbor-handover-trend:${sourceUsid}:${neighUsid}:${daysNum}`,
      () => CompassModel.getNeighborHandoverTrend(sourceUsid, neighUsid, daysNum),
      600
    );
    res.json({ trend });
  })
);

/**
 * POST /compass/neighbor-kpi-data
 * Body: { source_usid, date, kpi_names, source_face?, days_back? }
 * Hourly KPI rows for source + neighbors (cached 5 min)
 */
router.post(
  '/neighbor-kpi-data',
  asyncHandler(async (req: Request, res: Response) => {
    const { source_usid, date, kpi_names, source_face, days_back = 2 } = req.body as {
      source_usid?: unknown;
      date?: unknown;
      kpi_names?: unknown;
      source_face?: unknown;
      days_back?: unknown;
    };
    if (!source_usid || !date || !Array.isArray(kpi_names) || kpi_names.length === 0) {
      throw new AppError(400, 'MISSING_FIELDS', 'Missing required fields: source_usid, date, kpi_names[]');
    }
    const sourceUsid = String(source_usid);
    const d = String(date);
    const names = (kpi_names as unknown[]).map(String).filter(Boolean);
    const face = source_face ? String(source_face) : undefined;
    const daysBack = Math.max(1, parseInt(String(days_back)) || 2);
    const neighbor_kpi_data = await cacheOrFetch(
      `compass:neighbor-kpi-data:${sourceUsid}:${d}:${face || 'all'}:${daysBack}:${names.join('|')}`,
      () => CompassModel.getNeighborKpiData(sourceUsid, d, names, face, daysBack),
      300
    );
    res.json({
      neighbor_kpi_data,
      source_usid: sourceUsid,
      date: d,
      source_face: face,
    });
  })
);

// ========== HOURLY INSIGHTS ==========

/**
 * GET /compass/site/:usid/hourly-insights?date=&days_back=
 * Get hourly KPI insights for correlation analysis (cached 10 min)
 */
router.get(
  '/site/:usid/hourly-insights',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date, days_back = '2' } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const daysBack = Math.max(1, parseInt(String(days_back)) || 2);

    const data = await cacheOrFetch(
      `compass:site:${usid}:hourly-insights:${dateStr}:${daysBack}`,
      () => CompassModel.getHourlyInsights(usid, dateStr, daysBack),
      600
    );
    res.json(data);
  })
);

// ========== SITE CALENDAR ==========

/**
 * GET /compass/site/:usid/calendar?year=&month=
 * Get site calendar anomaly heatmap for a given month (cached 30 min)
 */
router.get(
  '/site/:usid/calendar',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { year, month } = req.query;
    if (!year || !month) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameters: year, month');
    }
    const yearNum = parseInt(String(year));
    const monthNum = parseInt(String(month));
    if (!yearNum || !monthNum || monthNum < 1 || monthNum > 12) {
      throw new AppError(400, 'INVALID_PARAM', 'Invalid year or month');
    }

    const data = await cacheOrFetch(
      `compass:site:${usid}:calendar:${yearNum}:${monthNum}`,
      () => CompassModel.getSiteCalendar(usid, yearNum, monthNum),
      1800
    );
    res.json({ success: true, data });
  })
);

/**
 * GET /compass/site/:usid/calendar/details?date=
 * Detailed day view for calendar drilldown (cached 30 min)
 */
router.get(
  '/site/:usid/calendar/details',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const d = String(date);
    const data = await cacheOrFetch(
      `compass:site:${usid}:calendar-details:${d}`,
      () => CompassModel.getCalendarDateDetails(usid, d),
      1800
    );
    res.json(data);
  })
);

// ========== COMPREHENSIVE SITE DETAILS ==========

/**
 * GET /compass/site/:usid/comprehensive?date=
 * Get comprehensive site data: topology + RCA + cell list (cached 10 min)
 */
router.get(
  '/site/:usid/comprehensive',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    }
    const dateStr = String(date);
    const data = await cacheOrFetch(
      `compass:site:${usid}:comprehensive:${dateStr}`,
      () => CompassModel.getSiteComprehensive(usid, dateStr),
      600
    );
    res.json({ success: true, data });
  })
);

// ========== ANOMALOUS SECTORS ==========

/**
 * GET /compass/anomalous-sectors?date=
 * All anomalous sectors for a date — used for map overlay (cached 10 min)
 */
router.get(
  '/anomalous-sectors',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const data = await cacheOrFetch(
      `compass:anomalous-sectors:${d}`,
      () => CompassModel.getAnomalousSectors(d),
      600
    );
    res.json({ success: true, data });
  })
);

// ========== NEIGHBOR RELATIONS WITH COORDINATES ==========

/**
 * GET /compass/site/:usid/neighbor-relations?date=&face=
 * Neighbor connections with lat/lon — for map arrows (cached 10 min)
 */
router.get(
  '/site/:usid/neighbor-relations',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date, face } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const f = face ? String(face) : undefined;
    const data = await cacheOrFetch(
      `compass:site:${usid}:neighbor-relations:${d}:${f || 'all'}`,
      () => CompassModel.getNeighborRelationsWithCoords(usid, d, f),
      600
    );
    res.json({ success: true, data });
  })
);

// ========== TIMELINE SITE AGGREGATE KPIs ==========

/**
 * GET /compass/site/:usid/timeline-kpis?date=&kpiNames=A,B,C
 * Site-level hourly KPIs for 4 reference days — day-over-day comparison (cached 5 min)
 */
router.get(
  '/site/:usid/timeline-kpis',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date, kpiNames } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    if (!kpiNames) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: kpiNames');
    const d = String(date);
    const names = String(kpiNames).split(',').map((k) => k.trim()).filter(Boolean);
    const data = await cacheOrFetch(
      `compass:site:${usid}:timeline-kpis:${d}:${names.join('|')}`,
      () => CompassModel.getTimelineSiteAggregateKpis(usid, d, names),
      300
    );
    res.json({ success: true, data });
  })
);

// ========== SUBCOMPONENT DATA ==========

/**
 * GET /compass/site/:usid/subcomponent?date=&days=
 * CQX subcomponent metrics from subcomponent_table (cached 5 min)
 */
router.get(
  '/site/:usid/subcomponent',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date, days = '30' } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const n = Math.max(1, parseInt(String(days)) || 30);
    const data = await cacheOrFetch(
      `compass:site:${usid}:subcomponent:${d}:${n}`,
      () => CompassModel.getSubcomponentData(usid, d, n),
      300
    );
    res.json({ success: true, data });
  })
);

/**
 * GET /compass/site/:usid/subcomponent-impact?date=&days=
 * CQX per-subcomponent impact breakdown from cqx_offenders_truth_table (cached 5 min)
 */
router.get(
  '/site/:usid/subcomponent-impact',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date, days = '30' } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const n = Math.max(1, parseInt(String(days)) || 30);
    const data = await cacheOrFetch(
      `compass:site:${usid}:subcomponent-impact:${d}:${n}`,
      () => CompassModel.getSubcomponentImpactData(usid, d, n),
      300
    );
    res.json({ success: true, data });
  })
);

// ========== SITE + NEIGHBOR OUTAGES ==========

/**
 * GET /compass/site/:usid/site-neighbor-outages?date=&days=
 * Hourly downtime & failure KPIs for site + its neighbors (cached 5 min)
 */
router.get(
  '/site/:usid/site-neighbor-outages',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date, days = '7' } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const n = Math.max(1, parseInt(String(days)) || 7);
    const data = await cacheOrFetch(
      `compass:site:${usid}:site-neighbor-outages:${d}:${n}`,
      () => CompassModel.getSiteAndNeighborOutages(usid, d, n),
      300
    );
    res.json({ success: true, data });
  })
);

// ========== NEIGHBOR USIDs ==========

/**
 * GET /compass/site/:usid/neighbor-usids?date=
 * Distinct neighbor USID list for a site (cached 10 min)
 */
router.get(
  '/site/:usid/neighbor-usids',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const data = await cacheOrFetch(
      `compass:site:${usid}:neighbor-usids:${d}`,
      () => CompassModel.getNeighborUsids(usid, d),
      600
    );
    res.json({ success: true, data });
  })
);

// ========== NODES FOR USID ==========

/**
 * GET /compass/site/:usid/nodes?date=
 * Unique radio node names for a site (cached 10 min)
 */
router.get(
  '/site/:usid/nodes',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const data = await cacheOrFetch(
      `compass:site:${usid}:nodes:${d}`,
      () => CompassModel.getNodesForUsid(usid, d),
      600
    );
    res.json({ success: true, data });
  })
);

/**
 * GET /compass/site/:usid/cell-topology-by-date?date=
 * Date-scoped cell topology rows (cached 30 min)
 */
router.get(
  '/site/:usid/cell-topology-by-date',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid } = req.params;
    const { date } = req.query;
    if (!date) throw new AppError(400, 'MISSING_PARAM', 'Missing required query parameter: date');
    const d = String(date);
    const cell_topology = await cacheOrFetch(
      `compass:site:${usid}:cell-topology-by-date:${d}`,
      () => CompassModel.getCellTopologyByDate(usid, d),
      1800
    );
    res.json({ usid, date: d, cell_topology });
  })
);

// ========== SITE COORDINATES (MULTI) ==========

/**
 * POST /compass/site-coordinates
 * Body: { usids: string[], date?: string }
 * Coordinates for an arbitrary list of USIDs — for neighbor map overlays (cached 15 min)
 */
router.post(
  '/site-coordinates',
  asyncHandler(async (req: Request, res: Response) => {
    const { usids, date } = req.body as { usids?: unknown; date?: unknown };
    if (!Array.isArray(usids) || usids.length === 0) {
      throw new AppError(400, 'MISSING_PARAM', 'Missing required body field: usids (array)');
    }
    const usidList = (usids as unknown[]).map(String).filter(Boolean).slice(0, 200);
    const d = date ? String(date) : undefined;
    const cacheKey = `compass:site-coords:${d || 'latest'}:${usidList.slice(0, 5).join('_')}:${usidList.length}`;
    const data = await cacheOrFetch(cacheKey, () => CompassModel.getSiteCoordinates(usidList, d), 900);
    res.json({ success: true, data });
  })
);

// ========== USER FEEDBACK ==========

/**
 * POST /compass/user-feedback
 * Update user feedback for a site (no cache)
 */
router.post(
  '/user-feedback',
  asyncHandler(async (req: Request, res: Response) => {
    const { usid, date, feedback } = req.body;

    if (!usid || !date || feedback === undefined) {
      throw new AppError(400, 'MISSING_FIELDS', 'Missing required fields: usid, date, feedback');
    }

    await CompassModel.updateUserFeedback(String(usid), String(date), String(feedback));
    res.json({ success: true, message: 'User feedback saved' });
  })
);

export default router;
