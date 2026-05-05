import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { siteIdMapper } from '../services/site-id-mapper.service.js';
import { mirrorOrRemote } from '../services/db-mirror/lib/mirror-or-remote.js';
import type {
  CellKpiResponse,
  CellKpiViewType,
  CellTopologyRow,
  MobilityTrendResponse,
  OperationalInfoPayload,
  OutageResponse,
  SiteAnalysisPayload,
  SiteTopologyPayload,
  TrafficProfileResponse,
} from '../types/index.js';

const remoteDbConnector = new NaavikDBConnector();

function escapeSqlLiteral(value: string): string {
  return String(value).replace(/'/g, "''");
}

function normalizeDate(value?: string | null): string {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined) return row[candidate];
  }
  const lowerMap = new Map<string, unknown>();
  Object.keys(row).forEach((key) => lowerMap.set(key.toLowerCase(), row[key]));
  for (const candidate of candidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return null;
}

function parseJsonText<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  const text = String(value).trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toIsoDate(value: unknown, fallback?: string): string {
  const text = String(value || '').trim();
  if (!text) return fallback || new Date().toISOString().slice(0, 10);
  return text.slice(0, 10);
}

async function resolveRealUsid(siteId: string): Promise<string> {
  if (!siteIdMapper.getStats().initialized) {
    await siteIdMapper.initialize();
  }
  return siteIdMapper.resolveRealUSIDFromAnyToken(siteId) || String(siteId).replace(/^UST/i, '');
}

function mapCellKpiRows(rows: Record<string, unknown>[]): CellKpiResponse['data'] {
  return rows.map((row) => ({
    usid: String(pickField(row, ['USID', 'usid']) || ''),
    dateId: toIsoDate(pickField(row, ['DATE_ID', 'date_id'])),
    hourId: toNumber(pickField(row, ['HOUR_ID', 'hour_id'])),
    cellName: String(pickField(row, ['cell_name', 'CELL_NAME']) || ''),
    kpiName: String(pickField(row, ['kpi_name', 'KPI_NAME']) || ''),
    kpiValue: toNumber(pickField(row, ['kpi_value', 'KPI_VALUE', 'avg_value'])),
    isNeighbor: Boolean(pickField(row, ['is_neighbor', 'IS_NEIGHBOR'])),
  }));
}

export class SiteAnalysisModel {
  static async getComprehensiveAnalysis(siteId: string, dateId?: string): Promise<SiteAnalysisPayload | null> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);

    // Mirror-first: ~50ms locally vs 10–30s on remote (the remote query has
    // CAST(DATE_ID AS DATE) which forces a full scan + SELECT * pulls every
    // multi-KB text column). Mirror returns the same row shape with lowercase
    // column names — pickField() already handles both cases.
    const rows = await mirrorOrRemote({
      local: {
        sql: `SELECT * FROM mirror.site_table
              WHERE usid = $1 AND date_id::date <= $2::date
              ORDER BY date_id DESC LIMIT 1`,
        params: [realUsid, effectiveDate],
      },
      remote: `
        SELECT TOP 1 *
        FROM site_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND DATE_ID <= '${escapeSqlLiteral(effectiveDate)}'
        ORDER BY DATE_ID DESC`,
      tag: 'getComprehensiveAnalysis',
    });
    if (!rows.length) return null;
    const row = rows[0] as Record<string, unknown>;

    const strongestFactors = parseJsonText<unknown[]>(pickField(row, ['strongest_factors', 'STRONGEST_FACTORS']), []);
    const rawIntuitions = parseJsonText<Record<string, unknown>>(pickField(row, ['intuitions', 'INTUITIONS']), {});
    const chainOfThought = parseJsonText<unknown[]>(pickField(row, ['chain_of_thought', 'CHAIN_OF_THOUGHT']), []);

    // Normalise intuitions: convert status strings → boolean `applies` so the
    // evidence panel can display APPLIES / DOESN'T APPLY instead of UNKNOWN.
    const intuitions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawIntuitions)) {
      const payload: Record<string, unknown> = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      const statusStr = String(payload['status'] ?? payload['applies'] ?? payload['result'] ?? '').toUpperCase();
      let applies: boolean | null = null;
      if (statusStr) {
        const doesNotApply = statusStr.includes('DOES NOT APPLY') || statusStr.includes("DOESN'T APPLY") || statusStr === 'FALSE' || statusStr === 'NO';
        const doesApply    = statusStr.includes('APPLIES') || statusStr === 'TRUE' || statusStr === 'YES';
        if (doesNotApply)      applies = false;
        else if (doesApply)    applies = true;
      } else if (typeof payload['applies'] === 'boolean') {
        applies = payload['applies'];
      } else if (typeof payload['result'] === 'boolean') {
        applies = payload['result'];
      }
      intuitions[key] = { ...payload, applies };
    }
    const shortSummary = parseJsonText<Record<string, unknown>>(pickField(row, ['short_summary', 'SHORT_SUMMARY']), {});
    const confidencePayload = parseJsonText<Record<string, unknown>>(pickField(row, ['confidence_score', 'CONFIDENCE_SCORE']), {});
    const confidenceScore = toNumber((confidencePayload as { score?: unknown }).score ?? pickField(row, ['confidence_score_int', 'CONFIDENCE_SCORE_INT', 'confidence_score']));

    return {
      usid: String(pickField(row, ['USID', 'usid']) || realUsid),
      dateId: toIsoDate(pickField(row, ['DATE_ID', 'date_id']), effectiveDate),
      topology: {
        siteName: String(pickField(row, ['site_name', 'SITE_NAME', 'SiteName']) || siteId),
        latitude: toNumber(pickField(row, ['LATITUDE', 'latitude'])),
        longitude: toNumber(pickField(row, ['LONGITUDE', 'longitude'])),
        district: String(pickField(row, ['DISTRICT', 'district']) || ''),
        zoneId: String(pickField(row, ['ZONE_ID', 'zone_id']) || ''),
        zoneEngineer: String(pickField(row, ['ZONE_ENGINEER', 'zone_engineer', 'ENGINEER']) || ''),
        engineerUid: String(pickField(row, ['ENGINEER_UID', 'engineer_uid']) || ''),
        managerUid: String(pickField(row, ['MANAGER_UID', 'manager_uid']) || ''),
        market: String(pickField(row, ['MARKET', 'market']) || ''),
        siteType: String(pickField(row, ['SITE_TYPE', 'site_type']) || ''),
        structureType: String(pickField(row, ['STRUCTURE_TOWER_TYPE', 'structure_tower_type']) || ''),
        cellCount: toNumber(pickField(row, ['cell_num', 'CELL_NUM', 'CellCount'])),
        county: String(pickField(row, ['COUNTY', 'county']) || ''),
        city: String(pickField(row, ['CITY', 'city']) || ''),
        state: String(pickField(row, ['STATE', 'state']) || ''),
        streetAddress: String(pickField(row, ['STREET_ADDRESS', 'street_address']) || ''),
        zip: String(pickField(row, ['ZIP', 'zip']) || ''),
        clusterId: String(pickField(row, ['CLUSTERID', 'cluster_id']) || ''),
        clusterName: String(pickField(row, ['CLUSTERNAME', 'cluster_name']) || ''),
      },
      strongestFactors: Array.isArray(strongestFactors) ? strongestFactors : [],
      rca: {
        bucket: String(pickField(row, ['rca_bucket', 'RCA_BUCKET']) || ''),
        shortSummary,
        longSummary: String(pickField(row, ['long_summary', 'LONG_SUMMARY']) || ''),
        rcaSummary: String(pickField(row, ['rca_summary', 'RCA_SUMMARY']) || ''),
        chainOfThought,
        confidenceScore,
        confidenceScoreInt: toNumber(pickField(row, ['confidence_score_int', 'CONFIDENCE_SCORE_INT'])),
        solutionRecommendation: String(pickField(row, ['solution_recommendation', 'SOLUTION_RECOMMENDATION']) || ''),
        solutionSummary: String(pickField(row, ['solution_summary', 'SOLUTION_SUMMARY']) || ''),
        degradedCategory: String(pickField(row, ['degraded_category', 'DEGRADED_CATEGORY']) || ''),
        rcaTraversal: pickField(row, ['rca_traversal', 'RCA_TRAVERSAL']),
      },
      intuitions,
      summaries: {
        kpi: String(pickField(row, ['kpi_summary', 'KPI_SUMMARY']) || ''),
        ticket: String(pickField(row, ['ticket_summary', 'TICKET_SUMMARY']) || ''),
        alarm: String(pickField(row, ['alarm_summary', 'ALARM_SUMMARY']) || ''),
        neighbor: String(pickField(row, ['neighbor_summary', 'NEIGHBOR_SUMMARY']) || ''),
        parameter: String(pickField(row, ['parameter_summary', 'PARAMETER_SUMMARY']) || ''),
        outage: String(pickField(row, ['outage_summary', 'OUTAGE_SUMMARY']) || ''),
      },
      outage: {
        flag: Boolean(pickField(row, ['outage', 'OUTAGE'])),
        timestamp: String(pickField(row, ['outage_timestamp', 'OUTAGE_TIMESTAMP']) || ''),
      },
      metadata: {
        runTimeSeconds: toNumber(pickField(row, ['run_time_seconds', 'RUN_TIME_SECONDS'])),
        tokenAndCostUsage: pickField(row, ['token_and_cost_usage', 'TOKEN_AND_COST_USAGE']) || null,
        updateTime: String(pickField(row, ['update_time', 'UPDATE_TIME']) || ''),
        anomalyFlag: Boolean(pickField(row, ['anomaly_flag', 'ANOMALY_FLAG'])),
        anomalyScore: toNumber(pickField(row, ['anomaly_score', 'ANOMALY_SCORE'])),
      },
    };
  }

  static async getCellTopology(siteId: string, dateId?: string): Promise<SiteTopologyPayload> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const rows = await mirrorOrRemote({
      local: {
        sql: `SELECT cell_name, azimuth AS "AZIMUTH", height AS "HEIGHT",
                     latitude AS "LATITUDE", longitude AS "LONGITUDE",
                     tech AS "TECH", useid AS "USEID", usid AS "USID",
                     carrier AS "CARRIER", date_id AS "DATE_ID"
              FROM mirror.cell_table
              WHERE usid = $1 AND date_id::date = $2::date
              ORDER BY cell_name`,
        params: [realUsid, effectiveDate],
      },
      remote: `
        SELECT cell_name, AZIMUTH, HEIGHT, LATITUDE, LONGITUDE, TECH, USEID, USID, CARRIER, DATE_ID
        FROM cell_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND DATE_ID >= '${escapeSqlLiteral(effectiveDate)}'
          AND DATE_ID < DATEADD(day, 1, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATETIME))
        ORDER BY cell_name`,
      tag: 'getCellTopology',
    });
    const mapped: CellTopologyRow[] = rows.map((row: Record<string, unknown>) => ({
      cellName: String(pickField(row, ['cell_name', 'CELL_NAME']) || ''),
      azimuth: toNumber(pickField(row, ['AZIMUTH', 'azimuth'])),
      height: toNumber(pickField(row, ['HEIGHT', 'height'])),
      latitude: toNumber(pickField(row, ['LATITUDE', 'latitude'])),
      longitude: toNumber(pickField(row, ['LONGITUDE', 'longitude'])),
      technology: String(pickField(row, ['TECH', 'technology']) || ''),
      useId: String(pickField(row, ['USEID', 'useid']) || ''),
      usid: String(pickField(row, ['USID', 'usid']) || realUsid),
      carrier: String(pickField(row, ['CARRIER', 'carrier']) || ''),
      dateId: toIsoDate(pickField(row, ['DATE_ID', 'date_id']), effectiveDate),
    }));

    return {
      usid: realUsid,
      dateId: effectiveDate,
      cellTopology: mapped,
    };
  }

  static async getAvailableKpis(siteId: string, viewType: CellKpiViewType = 'daily'): Promise<string[]> {
    const realUsid = await resolveRealUsid(siteId);
    const tableName = viewType === 'hourly' || viewType === 'timeline' ? 'hourly_intermediate_kpis_table' : 'intermediate_kpi_table';
    const query = `
      SELECT DISTINCT TOP 200 kpi_name
      FROM ${tableName} WITH (NOLOCK)
      WHERE USID = '${escapeSqlLiteral(realUsid)}'
      ORDER BY kpi_name
    `;
    const rows = await remoteDbConnector.query(query);
    return rows.map((row: Record<string, unknown>) => String(pickField(row, ['kpi_name', 'KPI_NAME']) || '')).filter(Boolean);
  }

  static async getCellKpis(siteId: string, params: {
    kpiNames: string[];
    viewType: CellKpiViewType;
    startDate?: string;
    endDate?: string;
    dateId?: string;
  }): Promise<CellKpiResponse> {
    const realUsid = await resolveRealUsid(siteId);
    const kpiNames = params.kpiNames.map((kpi) => kpi.trim()).filter(Boolean);
    const viewType = params.viewType;
    const effectiveDate = normalizeDate(params.dateId || params.endDate);
    const endDate = normalizeDate(params.endDate || effectiveDate);
    const startDate = normalizeDate(params.startDate || (() => {
      const start = new Date(endDate);
      start.setDate(start.getDate() - (viewType === 'hourly' ? 2 : 30));
      return start.toISOString().slice(0, 10);
    })());
    const kpiList = kpiNames.map((kpi) => `'${escapeSqlLiteral(kpi)}'`).join(', ');

    let rows: Record<string, unknown>[] = [];

    if (viewType === 'timeline') {
      // Use a date range to let the index narrow rows first, then restrict to the 4 specific dates
      const query = `
        SELECT
          CONVERT(DATE, DATE_ID) as DATE_ID,
          HOUR_ID,
          kpi_name,
          AVG(TRY_CAST(kpi_value AS FLOAT)) as avg_value
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
          AND DATE_ID >= DATEADD(day, -14, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
          AND DATE_ID <  DATEADD(day,   1, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
          AND CONVERT(DATE, DATE_ID) IN (
            CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE),
            CAST(DATEADD(day,  -1, '${escapeSqlLiteral(effectiveDate)}') AS DATE),
            CAST(DATEADD(day,  -7, '${escapeSqlLiteral(effectiveDate)}') AS DATE),
            CAST(DATEADD(day, -14, '${escapeSqlLiteral(effectiveDate)}') AS DATE)
          )
          AND kpi_name IN (${kpiList})
        GROUP BY CONVERT(DATE, DATE_ID), HOUR_ID, kpi_name
        ORDER BY CONVERT(DATE, DATE_ID), HOUR_ID, kpi_name
      `;
      rows = await remoteDbConnector.query(query) as Record<string, unknown>[];
      return {
        usid: realUsid,
        startDate,
        endDate,
        dateId: effectiveDate,
        viewType,
        kpiNames,
        data: rows.map((row) => ({
          usid: realUsid,
          dateId: toIsoDate(pickField(row, ['DATE_ID', 'date_id'])),
          hourId: toNumber(pickField(row, ['HOUR_ID', 'hour_id'])),
          cellName: 'SITE_AGGREGATE',
          kpiName: String(pickField(row, ['kpi_name', 'KPI_NAME']) || ''),
          kpiValue: toNumber(pickField(row, ['avg_value', 'AVG_VALUE', 'kpi_value'])),
          isNeighbor: false,
        })),
      };
    }

    if (viewType === 'hourly') {
      const downtimeKpis = new Set(['EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'EUCELL_DOWNTIME_SLEEP', 'PMDOWNTIMEMANUAL', 'PMDOWNTIMEAUTO']);
      const includeNeighbors = kpiNames.some((kpi) => downtimeKpis.has(kpi));
      let usidList = [`'${escapeSqlLiteral(realUsid)}'`];

      if (includeNeighbors) {
        const neighborQuery = `
          SELECT DISTINCT NEIGH_USID
          FROM neighbors_table_date_id WITH (NOLOCK)
          WHERE SOURCE_USID = '${escapeSqlLiteral(realUsid)}'
            AND DATE_ID >= CAST('${escapeSqlLiteral(endDate)}' AS DATE)
            AND DATE_ID <  DATEADD(day, 1, CAST('${escapeSqlLiteral(endDate)}' AS DATE))
        `;
        const neighborRows = await remoteDbConnector.query(neighborQuery) as Record<string, unknown>[];
        const neighbors = neighborRows
          .map((row) => String(pickField(row, ['NEIGH_USID', 'neigh_usid']) || '').trim())
          .filter((value) => value && value !== realUsid)
          .slice(0, 15);
        usidList = usidList.concat(neighbors.map((neighbor) => `'${escapeSqlLiteral(neighbor)}'`));
      }

      const query = `
        SELECT TOP 20000 USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE USID IN (${usidList.join(', ')})
          AND DATE_ID >= CAST('${escapeSqlLiteral(startDate)}' AS DATETIME)
          AND DATE_ID <  DATEADD(day, 1, CAST('${escapeSqlLiteral(endDate)}' AS DATETIME))
          AND kpi_name IN (${kpiList})
        ORDER BY DATE_ID, HOUR_ID, cell_name, kpi_name
      `;
      rows = await remoteDbConnector.query(query) as Record<string, unknown>[];
      rows = rows.map((row) => ({ ...row, is_neighbor: String(pickField(row, ['USID', 'usid']) || '') !== realUsid }));
    } else {
      const query = `
        SELECT TOP 10000 USID, DATE_ID, cell_name, kpi_name, kpi_value
        FROM intermediate_kpi_table WITH (NOLOCK)
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
          AND DATE_ID >= CAST('${escapeSqlLiteral(startDate)}' AS DATETIME)
          AND DATE_ID <= CAST('${escapeSqlLiteral(endDate)}' AS DATETIME)
          AND kpi_name IN (${kpiList})
        ORDER BY DATE_ID, cell_name, kpi_name
      `;
      rows = await remoteDbConnector.query(query) as Record<string, unknown>[];
    }

    return {
      usid: realUsid,
      startDate,
      endDate,
      dateId: effectiveDate,
      viewType,
      kpiNames,
      data: mapCellKpiRows(rows),
    };
  }

  static async getMobilityTrends(siteId: string, dateId?: string, days = 30): Promise<MobilityTrendResponse> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const query = `
      SELECT SOURCE_USID, SOURCE_USID_FACE, NEIGH_USID, NEIGH_USID_FACE, HANDOVER_COUNT, HO_RANK,
             TOTAL_HANDOVER, CUMMULATIVE_SUM, PERC_HANDOVER, SOURCE_NEIGH_DISTANCE_METERS, DATE_ID
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND DATE_ID >= DATEADD(day, -${Math.max(days, 1)}, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATETIME))
        AND DATE_ID < DATEADD(day, 1, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATETIME))
      ORDER BY DATE_ID DESC, SOURCE_USID_FACE, HO_RANK
    `;
    const rows = await remoteDbConnector.query(query) as Record<string, unknown>[];
    return {
      usid: realUsid,
      dateId: effectiveDate,
      days,
      data: rows.map((row) => ({
        sourceUsid: String(pickField(row, ['SOURCE_USID']) || realUsid),
        sourceFace: String(pickField(row, ['SOURCE_USID_FACE']) || ''),
        neighborUsid: String(pickField(row, ['NEIGH_USID']) || ''),
        neighborFace: String(pickField(row, ['NEIGH_USID_FACE']) || ''),
        handoverCount: toNumber(pickField(row, ['HANDOVER_COUNT'])) || 0,
        rank: toNumber(pickField(row, ['HO_RANK'])),
        totalHandover: toNumber(pickField(row, ['TOTAL_HANDOVER'])),
        cumulativeSum: toNumber(pickField(row, ['CUMMULATIVE_SUM'])),
        handoverPercent: toNumber(pickField(row, ['PERC_HANDOVER'])),
        distanceMeters: toNumber(pickField(row, ['SOURCE_NEIGH_DISTANCE_METERS'])),
        dateId: toIsoDate(pickField(row, ['DATE_ID']), effectiveDate),
      })),
    };
  }

  static async getTrafficProfile(siteId: string, dateId?: string): Promise<TrafficProfileResponse> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);

    const [bandTraffic, sectorTraffic, neighborTraffic, handoverImpact] = await Promise.all([
      remoteDbConnector.query(`
        WITH TrafficWithBand AS (
          SELECT
            k.USID, k.DATE_ID, k.cell_name, k.kpi_value,
            CASE
              WHEN CHARINDEX('.', c.USEID) > 0 THEN SUBSTRING(
                c.USEID,
                CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) + 1,
                CASE
                  WHEN CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) + 1) > 0
                  THEN CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) + 1) - CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) - 1
                  ELSE LEN(c.USEID) - CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1)
                END
              )
              WHEN CHARINDEX('_', c.USEID) > 0 THEN SUBSTRING(
                c.USEID,
                CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) + 1,
                CASE
                  WHEN CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) + 1) > 0
                  THEN CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) + 1) - CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) - 1
                  ELSE LEN(c.USEID)
                END
              )
              ELSE NULL
            END AS BAND
          FROM intermediate_kpi_table k WITH (NOLOCK)
          INNER JOIN cell_table c WITH (NOLOCK)
            ON k.USID = c.USID AND k.cell_name = c.cell_name
            AND CAST(k.DATE_ID AS DATE) = CAST(c.DATE_ID AS DATE)
            AND CAST(c.DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
          WHERE CAST(k.USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
            AND CAST(k.DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
            AND k.kpi_name = 'DL_VOL_GB'
            AND c.USEID IS NOT NULL
        )
        SELECT USID, DATE_ID, BAND, SUM(CAST(kpi_value AS FLOAT)) AS total_traffic_gb, COUNT(DISTINCT cell_name) AS cell_count
        FROM TrafficWithBand
        WHERE BAND IS NOT NULL AND BAND != ''
        GROUP BY USID, DATE_ID, BAND
        ORDER BY total_traffic_gb DESC
      `),
      remoteDbConnector.query(`
        SELECT USID, DATE_ID,
          RIGHT(SUBSTRING(cell_name, CHARINDEX('_', cell_name) + 1,
            CHARINDEX('_', cell_name + '_', CHARINDEX('_', cell_name) + 1) - CHARINDEX('_', cell_name) - 1), 1) AS FACE,
          SUM(CAST(kpi_value AS FLOAT)) AS total_traffic_gb,
          COUNT(DISTINCT cell_name) AS cell_count
        FROM intermediate_kpi_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
          AND kpi_name = 'DL_VOL_GB'
        GROUP BY USID, DATE_ID,
          RIGHT(SUBSTRING(cell_name, CHARINDEX('_', cell_name) + 1,
            CHARINDEX('_', cell_name + '_', CHARINDEX('_', cell_name) + 1) - CHARINDEX('_', cell_name) - 1), 1)
        ORDER BY total_traffic_gb DESC
      `),
      remoteDbConnector.query(`
        WITH DistinctNeighbors AS (
          SELECT DISTINCT NEIGH_USID AS USID
          FROM neighbors_table_date_id WITH (NOLOCK)
          WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
            AND CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        ), NeighborTrafficWithBand AS (
          SELECT
            n.USID, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE) AS DATE_ID, k.cell_name, k.kpi_value,
            CASE
              WHEN CHARINDEX('.', c.USEID) > 0 THEN SUBSTRING(
                c.USEID,
                CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) + 1,
                CASE
                  WHEN CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) + 1) > 0
                  THEN CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) + 1) - CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1) - 1
                  ELSE LEN(c.USEID) - CHARINDEX('.', c.USEID, CHARINDEX('.', c.USEID) + 1)
                END
              )
              WHEN CHARINDEX('_', c.USEID) > 0 THEN SUBSTRING(
                c.USEID,
                CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) + 1,
                CASE
                  WHEN CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) + 1) > 0
                  THEN CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) + 1) - CHARINDEX('_', c.USEID, CHARINDEX('_', c.USEID) + 1) - 1
                  ELSE LEN(c.USEID)
                END
              )
              ELSE NULL
            END AS BAND
          FROM DistinctNeighbors n
          INNER JOIN intermediate_kpi_table k WITH (NOLOCK)
            ON n.USID = k.USID AND CAST(k.DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
          INNER JOIN cell_table c WITH (NOLOCK)
            ON k.USID = c.USID AND k.cell_name = c.cell_name
            AND CAST(k.DATE_ID AS DATE) = CAST(c.DATE_ID AS DATE)
            AND CAST(c.DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
          WHERE k.kpi_name = 'DL_VOL_GB' AND c.USEID IS NOT NULL
        )
        SELECT USID, DATE_ID, BAND, SUM(CAST(kpi_value AS FLOAT)) AS total_traffic_gb, COUNT(DISTINCT cell_name) AS cell_count
        FROM NeighborTrafficWithBand
        WHERE BAND IS NOT NULL AND BAND != ''
        GROUP BY USID, DATE_ID, BAND
        ORDER BY USID, total_traffic_gb DESC
      `),
      remoteDbConnector.query(`
        SELECT SOURCE_USID, SOURCE_USID_FACE, NEIGH_USID, NEIGH_USID_FACE, HANDOVER_COUNT,
               PERC_HANDOVER, HO_RANK, TOTAL_HANDOVER, SOURCE_NEIGH_DISTANCE_METERS
        FROM neighbors_table_date_id WITH (NOLOCK)
        WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        ORDER BY HO_RANK, PERC_HANDOVER DESC
      `),
    ]);

    const normalizeTrafficRows = (rows: unknown[]) => (rows as Record<string, unknown>[]).map((row) => ({
      usid: String(pickField(row, ['USID', 'usid']) || ''),
      dateId: toIsoDate(pickField(row, ['DATE_ID', 'date_id']), effectiveDate),
      dimension: String(pickField(row, ['BAND', 'FACE']) || ''),
      totalTrafficGb: toNumber(pickField(row, ['total_traffic_gb', 'TOTAL_TRAFFIC_GB'])) || 0,
      cellCount: toNumber(pickField(row, ['cell_count', 'CELL_COUNT'])) || 0,
    }));

    return {
      usid: realUsid,
      dateId: effectiveDate,
      bandTraffic: normalizeTrafficRows(bandTraffic),
      sectorTraffic: normalizeTrafficRows(sectorTraffic),
      neighborTraffic: normalizeTrafficRows(neighborTraffic),
      handoverImpact: (handoverImpact as Record<string, unknown>[]).map((row) => ({
        sourceUsid: String(pickField(row, ['SOURCE_USID']) || realUsid),
        sourceFace: String(pickField(row, ['SOURCE_USID_FACE']) || ''),
        neighborUsid: String(pickField(row, ['NEIGH_USID']) || ''),
        neighborFace: String(pickField(row, ['NEIGH_USID_FACE']) || ''),
        handoverCount: toNumber(pickField(row, ['HANDOVER_COUNT'])) || 0,
        handoverPercent: toNumber(pickField(row, ['PERC_HANDOVER'])),
        rank: toNumber(pickField(row, ['HO_RANK'])),
        totalHandover: toNumber(pickField(row, ['TOTAL_HANDOVER'])),
        distanceMeters: toNumber(pickField(row, ['SOURCE_NEIGH_DISTANCE_METERS'])),
      })),
    };
  }

  static async getOutages(siteId: string, dateId?: string, days = 7): Promise<OutageResponse> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const neighborQuery = `
      SELECT DISTINCT NEIGH_USID
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
    `;
    const neighborRows = await remoteDbConnector.query(neighborQuery) as Record<string, unknown>[];
    const neighbors = neighborRows
      .map((row) => String(pickField(row, ['NEIGH_USID', 'neigh_usid']) || '').trim())
      .filter((value) => value && value !== realUsid)
      .slice(0, 15);
    const allUsids = [realUsid, ...neighbors].map((value) => `'${escapeSqlLiteral(value)}'`).join(', ');
    const startDate = new Date(effectiveDate);
    startDate.setDate(startDate.getDate() - Math.max(days, 1));

    const query = `
      SELECT DATE_ID, HOUR_ID, USID, kpi_name, cell_name, kpi_value
      FROM hourly_intermediate_kpis_table WITH (NOLOCK)
      WHERE CAST(DATE_ID AS DATE) >= CAST('${escapeSqlLiteral(startDate.toISOString().slice(0, 10))}' AS DATE)
        AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        AND kpi_name IN ('EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'EUCELL_DOWNTIME_SLEEP', 'RRC_FAIL', 'DUAC_FAIL')
        AND CAST(USID AS VARCHAR(64)) IN (${allUsids})
    `;
    const rows = await remoteDbConnector.query(query) as Record<string, unknown>[];
    const siteOutages: Record<string, CellKpiResponse['data']> = {};
    const neighborOutages: OutageResponse['neighborOutages'] = {};

    rows.forEach((row) => {
      const usid = String(pickField(row, ['USID', 'usid']) || '');
      const kpiName = String(pickField(row, ['kpi_name', 'KPI_NAME']) || '');
      const item = {
        usid,
        dateId: toIsoDate(pickField(row, ['DATE_ID', 'date_id']), effectiveDate),
        hourId: toNumber(pickField(row, ['HOUR_ID', 'hour_id'])),
        cellName: String(pickField(row, ['cell_name', 'CELL_NAME']) || ''),
        kpiName,
        kpiValue: toNumber(pickField(row, ['kpi_value', 'KPI_VALUE'])),
        isNeighbor: usid !== realUsid,
      };
      if (usid === realUsid) {
        siteOutages[kpiName] = siteOutages[kpiName] || [];
        siteOutages[kpiName].push(item);
        return;
      }
      const current = neighborOutages[usid] || {
        totalDowntimeAuto: 0,
        totalDowntimeManual: 0,
        totalDowntimeSleep: 0,
        totalRrcFail: 0,
        totalDuacFail: 0,
        cellsAffected: 0,
        data: [],
      };
      const value = item.kpiValue || 0;
      if (kpiName === 'EUCELL_DOWNTIME_AUTO') current.totalDowntimeAuto += value;
      if (kpiName === 'EUCELL_DOWNTIME_MANUAL') current.totalDowntimeManual += value;
      if (kpiName === 'EUCELL_DOWNTIME_SLEEP') current.totalDowntimeSleep += value;
      if (kpiName === 'RRC_FAIL') current.totalRrcFail += value;
      if (kpiName === 'DUAC_FAIL') current.totalDuacFail += value;
      current.data.push(item);
      current.cellsAffected = new Set(current.data.map((entry) => entry.cellName)).size;
      neighborOutages[usid] = current;
    });

    neighbors.forEach((neighbor) => {
      if (!neighborOutages[neighbor]) {
        neighborOutages[neighbor] = {
          totalDowntimeAuto: 0,
          totalDowntimeManual: 0,
          totalDowntimeSleep: 0,
          totalRrcFail: 0,
          totalDuacFail: 0,
          cellsAffected: 0,
          data: [],
        };
      }
    });

    return {
      usid: realUsid,
      dateId: effectiveDate,
      days,
      siteOutages,
      neighborOutages,
      allNeighborUsids: neighbors,
      totalRecords: rows.length,
    };
  }

  static async getCqxData(siteId: string, dateId?: string, days = 30, dataType: 'impact' | 'value' = 'impact'): Promise<{ usid: string; dateId: string; dataType: 'impact' | 'value'; subcomponentData: Record<string, unknown>[] }> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const query = dataType === 'value'
      ? `
        SELECT DATE_ID, USID, subcomponent_name, subcomponent_value
        FROM subcomponent_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND subcomponent_name IN (
            'Total_Impact_Mkt_CQX', 'Total_Impact_Mkt_CQX_Delta', 'LTE_PDCP_MB', 'SA_PDCP_MB', 'NR_PDCP_MB',
            'SMALLCELL_PDCP_MB', 'QUALITY', 'DATA_ACC', 'VRAN_ACC', 'DATA_DROP', 'TPUT', 'UL_TPUT', 'VCDR_DROP', 'NS_ESO', 'VCDR_ACC'
          )
          AND CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -${Math.max(days, 1)}, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)) AS DATE)
          AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        ORDER BY DATE_ID
      `
      : `
        SELECT DATE_ID, USID, DL_TPUT_IMP, UL_TPUT_IMP, DATA_DROP_IMP, DATA_ACC_IMP, VRAN_ACC_IMP, VCDR_ACC_IMP, VOICE_DROP_IMP, NS_ESO_IMP, QUALITY_IMP
        FROM cqx_offenders_truth_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -${Math.max(days, 1)}, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)) AS DATE)
          AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        ORDER BY DATE_ID
      `;

    const rows = await remoteDbConnector.query(query) as Record<string, unknown>[];
    return { usid: realUsid, dateId: effectiveDate, dataType, subcomponentData: rows };
  }

  static async getOperationalInfo(siteId: string, dateId?: string, limit = 50): Promise<OperationalInfoPayload> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const [cellTopology, outages] = await Promise.all([
      this.getCellTopology(siteId, effectiveDate),
      this.getOutages(siteId, effectiveDate, 1),
    ]);

    return {
      usid: realUsid,
      dateId: effectiveDate,
      siteRows: cellTopology.cellTopology.slice(0, limit),
      neighborRows: outages.allNeighborUsids.map((neighborUsid) => ({
        neighborUsid,
        ...outages.neighborOutages[neighborUsid],
      })),
    };
  }
}
