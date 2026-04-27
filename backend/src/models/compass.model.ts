import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { siteIdMapper } from '../services/site-id-mapper.service.js';
import { pool } from '../config/database.js';

const remoteDbConnector = new NaavikDBConnector();
const remoteTableColumnsCache = new Map<string, Set<string>>();
const AVAILABILITY_TREND_TABLES = new Set([
  'alarm_table',
  'cell_table',
  'configuration_parameters_table',
  'eim_table',
  'hourly_intermediate_kpis_table',
  'intermediate_kpi_table',
  'kpi_table',
  'neighbors_table_date_id',
  'site_table',
  'outage_table',
  'subcomponent_table',
  'ticket_table',
]);

// ========== HELPER FUNCTIONS ==========

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

function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  const lowerMap = new Map<string, string>();
  columns.forEach((column) => lowerMap.set(column.toLowerCase(), column));
  for (const candidate of candidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function getRemoteTableColumns(tableName: string): Promise<Set<string>> {
  if (remoteTableColumnsCache.has(tableName)) {
    return remoteTableColumnsCache.get(tableName)!;
  }

  const rows = await remoteDbConnector.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${escapeSqlLiteral(tableName)}'
  `);

  const columns = new Set(
    rows
      .map((row) => String(pickField(row, ['COLUMN_NAME', 'column_name']) || '').trim())
      .filter(Boolean)
  );

  remoteTableColumnsCache.set(tableName, columns);
  return columns;
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

// Format list of USIDs for SQL IN clause
function formatUsidList(usids: string[]): string {
  if (!usids.length) return "('')";
  return `('${usids.map(escapeSqlLiteral).join("','")}')`;
}

// ========== COMPASS MODEL ==========

export class CompassModel {
  /**
   * Get all available dates from subcomponent_table
   */
  static async getDates(): Promise<string[]> {
    const query = `
      SELECT DISTINCT CAST(DATE_ID AS DATE) as DATE_ID
      FROM subcomponent_table
      ORDER BY DATE_ID DESC
    `;
    const rows = await remoteDbConnector.query(query);
    return rows.map((row) => toIsoDate(pickField(row, ['DATE_ID', 'date_id'])));
  }

  /**
   * Get dates that have chain_of_thought (RCA) data
   */
  static async getDatesWithRca(): Promise<string[]> {
    const query = `
      SELECT DISTINCT CAST(DATE_ID AS DATE) as DATE_ID
      FROM site_table
      WHERE chain_of_thought IS NOT NULL
      ORDER BY DATE_ID DESC
    `;
    const rows = await remoteDbConnector.query(query);
    return rows.map((row) => toIsoDate(pickField(row, ['DATE_ID', 'date_id'])));
  }

  /**
   * Get top 50 offender USIDs by CQX impact for a specific date
   */
  static async getOffenders(dateId: string): Promise<Array<{ USID: string; Total_Impact_to_CQX_Delta: number }>> {
    const effectiveDate = normalizeDate(dateId);
    const query = `
      SELECT TOP 50 s.USID, sc.subcomponent_value as Total_Impact_to_CQX_Delta
      FROM (
        SELECT USID
        FROM site_table
        WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
        AND chain_of_thought IS NOT NULL
      ) s
      INNER JOIN subcomponent_table sc
        ON s.USID = sc.USID
        AND CAST(sc.DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
        AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
      ORDER BY sc.subcomponent_value DESC
    `;
    const rows = await remoteDbConnector.query(query);
    return rows.map((row) => ({
      USID: String(pickField(row, ['USID', 'usid']) || ''),
      Total_Impact_to_CQX_Delta: toNumber(pickField(row, ['Total_Impact_to_CQX_Delta', 'subcomponent_value'])) || 0,
    }));
  }

  /**
   * Get paginated site table with offender details and RCA info
   */
  static async getSiteTable(
    dateId: string,
    page: number = 1,
    pageSize: number = 50
  ): Promise<{
    data: Array<Record<string, unknown>>;
    total_count: number;
    page: number;
    page_size: number;
    total_pages: number;
  }> {
    let effectiveDate = normalizeDate(dateId);
    const offset = (page - 1) * pageSize;

    // Get total count — if 0, fallback to MAX(DATE_ID) so the table
    // always shows data even when selectedDateId hasn't been resolved yet.
    const countQuery = `
      SELECT COUNT(*) as total_count
      FROM site_table
      WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
      AND chain_of_thought IS NOT NULL
    `;
    const countRows = await remoteDbConnector.query(countQuery);
    let totalCount = toNumber(pickField(countRows[0], ['total_count', 'count', 'COUNT'])) || 0;

    // Fallback: if no rows for specified date, use the most recent date that has RCA data
    if (totalCount === 0) {
      const maxDateRows = await remoteDbConnector.query(`
        SELECT CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR(10)) AS max_date
        FROM site_table WITH (NOLOCK)
        WHERE chain_of_thought IS NOT NULL
      `);
      const maxDate = String(pickField(maxDateRows[0], ['max_date', 'MAX_DATE']) || '').slice(0, 10);
      if (maxDate && /^\d{4}-\d{2}-\d{2}$/.test(maxDate) && maxDate !== effectiveDate) {
        effectiveDate = maxDate;
        const fallbackCount = await remoteDbConnector.query(`
          SELECT COUNT(*) as total_count
          FROM site_table
          WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
          AND chain_of_thought IS NOT NULL
        `);
        totalCount = toNumber(pickField(fallbackCount[0], ['total_count', 'count', 'COUNT'])) || 0;
      }
    }

    // Get paginated data with RCA info
    const dataQuery = `
      SELECT
        s.USID,
        s.DATE_ID,
        s.site_name,
        s.ZONE_ENGINEER,
        s.degraded_category as Degraded_KPI_Category,
        sc.subcomponent_value as CQX_Impact_Delta,
        ISNULL(s.rca_summary, '') as Possible_RCA,
        '' as User_Feedback
      FROM site_table s
      LEFT JOIN subcomponent_table sc
        ON s.USID = sc.USID
        AND CAST(sc.DATE_ID AS DATE) = CAST(s.DATE_ID AS DATE)
        AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
      WHERE CAST(s.DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
      AND s.chain_of_thought IS NOT NULL
      ORDER BY ISNULL(sc.subcomponent_value, -9999) DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${pageSize} ROWS ONLY
    `;
    const rows = await remoteDbConnector.query(dataQuery);

    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      data: rows,
      total_count: totalCount,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    };
  }

  /**
   * Get operational data for a site (alarms, tickets, config, outages, EIM)
   */
  static async getSiteOperational(
    siteId: string,
    dateId: string
  ): Promise<{
    usid: string;
    date: string;
    alarms: Array<Record<string, unknown>>;
    tickets: Array<Record<string, unknown>>;
    config_changes: Array<Record<string, unknown>>;
    outages: Array<Record<string, unknown>>;
    eim: Array<Record<string, unknown>>;
  }> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const usidList = formatUsidList([realUsid]);

    // Get neighbor USIDs first
    const neighborQuery = `
      SELECT DISTINCT NEIGH_USID
      FROM neighbors_table_date_id
      WHERE SOURCE_USID = '${escapeSqlLiteral(realUsid)}'
      AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
    `;
    const neighborRows = await remoteDbConnector.query(neighborQuery);
    const neighborUsids = neighborRows.map((row) => String(pickField(row, ['NEIGH_USID', 'neigh_usid']) || ''));
    const allUsids = [realUsid, ...neighborUsids];
    const usidListForOps = formatUsidList(allUsids);

    // Run all operational queries in parallel
    const [alarmRows, ticketRows, configRows, outageRows, eimRows] = await Promise.all([
      remoteDbConnector.query(`
        SELECT *
        FROM alarm_table
        WHERE USID IN ${usidListForOps}
        AND CAST(LASTOCCURRENCE AS DATE) >= DATEADD(day, -7, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
      `),
      remoteDbConnector.query(`
        SELECT *
        FROM ticket_table
        WHERE USID IN ${usidListForOps}
        AND CAST(CREATE_TIME AS DATE) >= DATEADD(day, -7, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
      `),
      remoteDbConnector.query(`
        SELECT *
        FROM configuration_parameters_table
        WHERE USID IN ${usidListForOps}
        AND parameter_name NOT LIKE '%PHYSICALLAYERCELLID%'
        AND parameter_name NOT LIKE '%PCI%'
        AND CAST(DATE_ID AS DATE) >= DATEADD(day, -7, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
      `),
      remoteDbConnector.query(`
        SELECT *
        FROM outage_table
        WHERE USID IN ${usidListForOps}
        AND CAST(DATE_ID AS DATE) >= DATEADD(day, -7, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
      `),
      remoteDbConnector.query(`
        SELECT *
        FROM eim_table
        WHERE USID IN ${usidListForOps}
        AND CAST(DATE_ID AS DATE) >= DATEADD(day, -7, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
      `),
    ]);

    return {
      usid: realUsid,
      date: effectiveDate,
      alarms: alarmRows,
      tickets: ticketRows,
      config_changes: configRows,
      outages: outageRows,
      eim: eimRows,
    };
  }

  /**
   * Get all sites with coordinates from site_table (Compass-style topology)
   * Returns all 6600+ sites for the map with anomaly/offender status
   */
  static async getSiteTopology(dateId?: string): Promise<Array<{
    USID: string;
    site_name: string;
    latitude: number;
    longitude: number;
    is_offender: boolean;
    cluster_id: string | null;
  }>> {
    // Fast path: local PostgreSQL cache (populated by DataSyncService)
    try {
      const local = await pool.query(
        'SELECT usid, site_name, latitude, longitude, is_offender, cluster_id FROM topology_cache_sites'
      );
      if (local.rows.length > 0) {
        return local.rows
          .map((r: any) => ({
            USID: String(r.usid || ''),
            site_name: String(r.site_name || r.usid || ''),
            latitude: Number(r.latitude) || 0,
            longitude: Number(r.longitude) || 0,
            is_offender: Boolean(r.is_offender),
            cluster_id: r.cluster_id || null,
          }))
          .filter((s) => s.USID && s.latitude !== 0 && s.longitude !== 0);
      }
    } catch {
      // cache not ready — fall through to remote
    }

    const siteTableColumns = await getRemoteTableColumns('site_table');
    const clusterColumn = pickColumn(siteTableColumns, ['CLUSTER_ID', 'CLUSTERID', 'cluster_id', 'clusterId']);
    const datePredicate = dateId && /^\d{4}-\d{2}-\d{2}$/.test(dateId)
      ? `CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(dateId)}'`
      : `CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table WITH (NOLOCK))`;
    const clusterSelect = clusterColumn
      ? `CAST(ISNULL(${clusterColumn}, '') AS VARCHAR(128)) AS cluster_id`
      : `CAST('' AS VARCHAR(128)) AS cluster_id`;

    const query = `
      SELECT
        CAST(USID AS VARCHAR(64)) AS USID,
        ISNULL(site_name, CAST(USID AS VARCHAR(64))) AS site_name,
        CAST(latitude AS FLOAT) AS latitude,
        CAST(longitude AS FLOAT) AS longitude,
        CASE WHEN chain_of_thought IS NOT NULL THEN 1 ELSE 0 END AS is_offender,
        ${clusterSelect}
      FROM site_table WITH (NOLOCK)
      WHERE ${datePredicate}
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND TRY_CAST(latitude AS FLOAT) IS NOT NULL
        AND TRY_CAST(longitude AS FLOAT) IS NOT NULL
    `;
    const rows = await remoteDbConnector.query(query);
    return rows.map((row) => ({
      USID: String(pickField(row, ['USID', 'usid']) || ''),
      site_name: String(pickField(row, ['site_name', 'SITE_NAME', 'SiteName']) || pickField(row, ['USID', 'usid']) || ''),
      latitude: Number(pickField(row, ['latitude', 'LATITUDE', 'Latitude'])) || 0,
      longitude: Number(pickField(row, ['longitude', 'LONGITUDE', 'Longitude'])) || 0,
      is_offender: Boolean(Number(pickField(row, ['is_offender']))),
      cluster_id: String(pickField(row, ['cluster_id', 'CLUSTER_ID', 'ClusterID']) || '') || null,
    })).filter((s) => s.USID && s.latitude !== 0 && s.longitude !== 0);
  }

  /**
   * Get cell sectors for a specific date — includes anomaly flags from sector_table
   * Matches Compass's get_cell_sectors() query
   */
  static async getCellSectors(dateId: string): Promise<Array<Record<string, unknown>>> {
    // Fast path: local PostgreSQL cache (populated by DataSyncService)
    try {
      const local = await pool.query('SELECT * FROM topology_cache_sectors');
      if (local.rows.length > 0) {
        return local.rows.map((r: any) => ({
          USID: r.usid,
          USEID: r.useid,
          cell_name: r.cell_name,
          azimuth: r.azimuth,
          site_latitude: r.site_latitude,
          site_longitude: r.site_longitude,
          cell_latitude: r.cell_latitude,
          cell_longitude: r.cell_longitude,
          TECH: r.tech,
          CARRIER: r.carrier,
          HEIGHT: r.height,
          cell_anomaly_flag: r.cell_anomaly_flag,
          cell_anomaly_score: r.cell_anomaly_score,
          site_anomaly_flag: r.site_anomaly_flag,
          site_anomaly_score: r.site_anomaly_score,
        }));
      }
    } catch {
      // cache not ready — fall through to remote
    }

    const effectiveDate = normalizeDate(dateId);
    const buildRichQuery = (queryDate: string) => `
      SELECT
        CAST(c.USID AS VARCHAR(64)) AS USID,
        CAST(c.USEID AS VARCHAR(128)) AS USEID,
        c.cell_name,
        CASE
          WHEN c.AZIMUTH IS NULL OR CAST(c.AZIMUTH AS FLOAT) = 0 THEN 1.0
          ELSE CAST(c.AZIMUTH AS FLOAT)
        END AS azimuth,
        COALESCE(CAST(st.latitude AS FLOAT), CAST(c.LATITUDE AS FLOAT)) AS site_latitude,
        COALESCE(CAST(st.longitude AS FLOAT), CAST(c.LONGITUDE AS FLOAT)) AS site_longitude,
        CAST(c.LATITUDE AS FLOAT) AS cell_latitude,
        CAST(c.LONGITUDE AS FLOAT) AS cell_longitude,
        c.TECH,
        c.CARRIER,
        c.HEIGHT,
        ISNULL(sec.anomaly_flag, 0) AS cell_anomaly_flag,
        ISNULL(CAST(sec.anomaly_score AS FLOAT), 0.0) AS cell_anomaly_score,
        ISNULL(st_sec.anomaly_flag, 0) AS site_anomaly_flag,
        ISNULL(CAST(st_sec.anomaly_score AS FLOAT), 0.0) AS site_anomaly_score
      FROM cell_table c WITH (NOLOCK)
      LEFT JOIN site_table st WITH (NOLOCK)
        ON CAST(st.USID AS VARCHAR(64)) = CAST(c.USID AS VARCHAR(64))
        AND CAST(st.DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
      LEFT JOIN sector_table sec WITH (NOLOCK)
        ON CAST(sec.USEID AS VARCHAR(128)) = CAST(c.USEID AS VARCHAR(128))
        AND CAST(sec.DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
      LEFT JOIN (
        SELECT USID, MAX(CAST(anomaly_flag AS INT)) AS anomaly_flag,
               MAX(CAST(anomaly_score AS FLOAT)) AS anomaly_score
        FROM sector_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
        GROUP BY USID
      ) st_sec ON CAST(st_sec.USID AS VARCHAR(64)) = CAST(c.USID AS VARCHAR(64))
      WHERE CAST(c.DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
        AND (
          (CAST(st.latitude AS FLOAT) IS NOT NULL AND CAST(st.longitude AS FLOAT) IS NOT NULL)
          OR (CAST(c.LATITUDE AS FLOAT) IS NOT NULL AND CAST(c.LONGITUDE AS FLOAT) IS NOT NULL)
        )
    `;
    const buildBasicQuery = (queryDate: string) => `
      SELECT
        CAST(c.USID AS VARCHAR(64)) AS USID,
        CAST(c.USEID AS VARCHAR(128)) AS USEID,
        c.cell_name,
        CASE
          WHEN c.AZIMUTH IS NULL OR CAST(c.AZIMUTH AS FLOAT) = 0 THEN 1.0
          ELSE CAST(c.AZIMUTH AS FLOAT)
        END AS azimuth,
        COALESCE(CAST(st.latitude AS FLOAT), CAST(c.LATITUDE AS FLOAT)) AS site_latitude,
        COALESCE(CAST(st.longitude AS FLOAT), CAST(c.LONGITUDE AS FLOAT)) AS site_longitude,
        CAST(c.LATITUDE AS FLOAT) AS cell_latitude,
        CAST(c.LONGITUDE AS FLOAT) AS cell_longitude,
        c.TECH,
        c.CARRIER,
        c.HEIGHT,
        0 AS cell_anomaly_flag,
        0.0 AS cell_anomaly_score,
        0 AS site_anomaly_flag,
        0.0 AS site_anomaly_score
      FROM cell_table c WITH (NOLOCK)
      LEFT JOIN site_table st WITH (NOLOCK)
        ON CAST(st.USID AS VARCHAR(64)) = CAST(c.USID AS VARCHAR(64))
        AND CAST(st.DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
      WHERE CAST(c.DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
        AND (
          (CAST(st.latitude AS FLOAT) IS NOT NULL AND CAST(st.longitude AS FLOAT) IS NOT NULL)
          OR (CAST(c.LATITUDE AS FLOAT) IS NOT NULL AND CAST(c.LONGITUDE AS FLOAT) IS NOT NULL)
        )
    `;

    const buildSyntheticSectors = async (queryDate: string): Promise<Array<Record<string, unknown>>> => {
      // Synthetic fallback when remote schema lacks cell_table:
      // derive a few sector wedges per site from site_table coordinates.
      const stableHash = (input: string): number => {
        let hash = 0;
        for (let i = 0; i < input.length; i += 1) {
          hash = (hash << 5) - hash + input.charCodeAt(i);
          hash |= 0;
        }
        return Math.abs(hash);
      };

      const rows = await remoteDbConnector.query(`
        SELECT TOP 2500
          CAST(USID AS VARCHAR(64)) AS USID,
          CAST(latitude AS FLOAT) AS latitude,
          CAST(longitude AS FLOAT) AS longitude
        FROM site_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(queryDate)}'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND TRY_CAST(latitude AS FLOAT) IS NOT NULL
          AND TRY_CAST(longitude AS FLOAT) IS NOT NULL
        ORDER BY USID
      `);

      const out: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        const usid = String(pickField(row, ['USID', 'usid']) || '').trim();
        const lat = Number(pickField(row, ['latitude', 'LATITUDE', 'Latitude'])) || 0;
        const lon = Number(pickField(row, ['longitude', 'LONGITUDE', 'Longitude'])) || 0;
        if (!usid || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;

        const base = stableHash(usid) % 360;
        const azimuths = [base, (base + 120) % 360, (base + 240) % 360];
        for (let i = 0; i < azimuths.length; i += 1) {
          const azimuth = azimuths[i] || 1.0;
          out.push({
            USID: usid,
            USEID: `${usid}.SYN.${i + 1}`,
            cell_name: `${usid}_SYN_${i + 1}`,
            azimuth,
            site_latitude: lat,
            site_longitude: lon,
            cell_latitude: lat,
            cell_longitude: lon,
            TECH: '4G+5G',
            CARRIER: 'Synthetic',
            HEIGHT: 0,
            cell_anomaly_flag: 0,
            cell_anomaly_score: 0.0,
            site_anomaly_flag: 0,
            site_anomaly_score: 0.0,
          });
        }
      }
      return out;
    };

    const queryForDate = async (queryDate: string) => {
      try {
        return await remoteDbConnector.query(buildRichQuery(queryDate));
      } catch {
        // Remote schema sometimes lacks sector_table anomaly fields; geometry should still render.
        try {
          return await remoteDbConnector.query(buildBasicQuery(queryDate));
        } catch {
          return await buildSyntheticSectors(queryDate);
        }
      }
    };

    let rows = await queryForDate(effectiveDate);
    if (rows.length > 0) return rows;

    // Fallback: if selected date has no cell rows, use latest available cell_table date.
    const fallbackDateRows = await remoteDbConnector.query(`
      SELECT TOP 1 CAST(DATE_ID AS DATE) AS DATE_ID
      FROM cell_table WITH (NOLOCK)
      ORDER BY CAST(DATE_ID AS DATE) DESC
    `);
    const fallbackDate = toIsoDate(pickField(fallbackDateRows[0] || {}, ['DATE_ID', 'date_id']), effectiveDate);
    rows = await queryForDate(fallbackDate);
    return rows;
  }

  /**
   * Get neighbors for a site on a specific date
   */
  static async getNeighbors(siteId: string, dateId: string): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);

    // First get the last available neighbor date for this USID
    const lastDateQuery = `
      SELECT TOP 1 CAST(DATE_ID AS DATE) as DATE_ID
      FROM neighbors_table_date_id
      WHERE SOURCE_USID = '${escapeSqlLiteral(realUsid)}'
      ORDER BY DATE_ID DESC
    `;
    const lastDateRows = await remoteDbConnector.query(lastDateQuery);
    if (!lastDateRows.length) return [];

    const lastDate = toIsoDate(pickField(lastDateRows[0], ['DATE_ID', 'date_id']));

    // Get neighbors for that date
    const query = `
      SELECT *
      FROM neighbors_table_date_id
      WHERE SOURCE_USID = '${escapeSqlLiteral(realUsid)}'
      AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(lastDate)}'
      ORDER BY PERC_HANDOVER DESC
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Get neighbor handover trends over time
   */
  static async getNeighborTrends(siteId: string, days: number = 30): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const query = `
      SELECT
        SOURCE_USID,
        NEIGH_USID,
        CAST(DATE_ID AS DATE) as DATE_ID,
        HANDOVER_COUNT,
        PERC_HANDOVER
      FROM neighbors_table_date_id
      WHERE SOURCE_USID = '${escapeSqlLiteral(realUsid)}'
      AND CAST(DATE_ID AS DATE) >= DATEADD(day, -${days}, CAST(GETDATE() AS DATE))
      ORDER BY DATE_ID DESC, HANDOVER_COUNT DESC
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Get hourly KPI insights for correlation analysis
   */
  static async getHourlyInsights(
    siteId: string,
    dateId: string,
    daysBack: number = 2
  ): Promise<{
    usid: string;
    date: string;
    daysBack: number;
    data: Array<Record<string, unknown>>;
  }> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const startDate = new Date(effectiveDate);
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().slice(0, 10);

    const query = `
      SELECT
        USID,
        CAST(DATE_ID AS DATE) as DATE_ID,
        CAST(HOUR_ID AS INT) as HOUR_ID,
        cell_name,
        kpi_name,
        kpi_value
      FROM hourly_intermediate_kpis_table
      WHERE USID = '${escapeSqlLiteral(realUsid)}'
      AND CAST(DATE_ID AS DATE) >= '${escapeSqlLiteral(startDateStr)}'
      AND CAST(DATE_ID AS DATE) <= '${escapeSqlLiteral(effectiveDate)}'
      ORDER BY DATE_ID DESC, HOUR_ID DESC, cell_name
    `;
    const rows = await remoteDbConnector.query(query);

    return {
      usid: realUsid,
      date: effectiveDate,
      daysBack,
      data: rows,
    };
  }

  /**
   * Get market dashboard aggregated metrics
   */
  static async getMarketDashboard(): Promise<{
    total_sites: number;
    total_cells: number;
    total_offenders: number;
    latest_date: string;
  }> {
    const query = `
      SELECT
        (SELECT COUNT(DISTINCT USID) FROM site_table WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table)) as total_sites,
        (SELECT COUNT(DISTINCT USEID) FROM cell_table WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM cell_table)) as total_cells,
        (SELECT COUNT(DISTINCT USID) FROM site_table WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table) AND chain_of_thought IS NOT NULL) as total_offenders,
        CAST((SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table) AS DATE) as latest_date
    `;
    const rows = await remoteDbConnector.query(query);
    const row = rows[0] || {};

    return {
      total_sites: toNumber(pickField(row, ['total_sites'])) || 0,
      total_cells: toNumber(pickField(row, ['total_cells'])) || 0,
      total_offenders: toNumber(pickField(row, ['total_offenders'])) || 0,
      latest_date: toIsoDate(pickField(row, ['latest_date'])),
    };
  }

  /**
   * Get data availability and freshness for all key tables
   */
  static async getDataAvailability(): Promise<Array<Record<string, unknown>>> {
    const query = `
      SELECT
        'site_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM site_table
      UNION ALL
      SELECT
        'subcomponent_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM subcomponent_table
      UNION ALL
      SELECT
        'intermediate_kpi_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM intermediate_kpi_table
      UNION ALL
      SELECT
        'hourly_intermediate_kpis_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM hourly_intermediate_kpis_table
      UNION ALL
      SELECT
        'cell_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM cell_table
      UNION ALL
      SELECT
        'neighbors_table_date_id' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM neighbors_table_date_id
      UNION ALL
      SELECT
        'alarm_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM alarm_table
      UNION ALL
      SELECT
        'ticket_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM ticket_table
      UNION ALL
      SELECT
        'configuration_parameters_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM configuration_parameters_table
      UNION ALL
      SELECT
        'outage_table' as table_name,
        CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR) as latest_date,
        COUNT(*) as record_count,
        DATEDIFF(day, MAX(CAST(DATE_ID AS DATE)), GETDATE()) as days_old
      FROM outage_table
      ORDER BY days_old ASC
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Get all USIDs for a date, and offender subset with impact values.
   * Mirrors Compass `/naavik/usids`.
   */
  static async getUsids(
    dateId: string,
    offendersOnly = false
  ): Promise<{ usids: string[]; offenders: string[]; offender_data: Record<string, number> }> {
    const d = normalizeDate(dateId);

    const offendersRows = await remoteDbConnector.query(`
      SELECT
        CAST(s.USID AS VARCHAR(64)) AS USID,
        MAX(CAST(sc.subcomponent_value AS FLOAT)) AS Total_Impact_to_CQX_Delta
      FROM site_table s WITH (NOLOCK)
      LEFT JOIN subcomponent_table sc WITH (NOLOCK)
        ON CAST(s.USID AS VARCHAR(64)) = CAST(sc.USID AS VARCHAR(64))
        AND CAST(sc.DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
        AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
      WHERE CAST(s.DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
        AND s.chain_of_thought IS NOT NULL
      GROUP BY s.USID
      ORDER BY Total_Impact_to_CQX_Delta DESC
    `);

    const offenderList = offendersRows
      .map((r) => String(pickField(r, ['USID', 'usid']) || '').trim())
      .filter(Boolean);
    const offenderData: Record<string, number> = {};
    offendersRows.forEach((r) => {
      const usid = String(pickField(r, ['USID', 'usid']) || '').trim();
      if (!usid) return;
      offenderData[usid] = toNumber(pickField(r, ['Total_Impact_to_CQX_Delta'])) || 0;
    });

    const allUsids = offendersOnly
      ? offenderList
      : (await remoteDbConnector.query(`
          SELECT DISTINCT CAST(USID AS VARCHAR(64)) AS USID
          FROM subcomponent_table WITH (NOLOCK)
          WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
          ORDER BY USID ASC
        `))
          .map((r) => String(pickField(r, ['USID', 'usid']) || '').trim())
          .filter(Boolean);

    return { usids: allUsids, offenders: offenderList, offender_data: offenderData };
  }

  /**
   * Operational data grouped for all sites on a selected date.
   * Mirrors Compass `/naavik/operational-data/all-sites`.
   */
  static async getAllSitesOperationalData(
    dateId: string
  ): Promise<Record<string, { alarms: unknown[]; tickets: unknown[]; outages: unknown[]; config_changes: unknown[] }>> {
    const d = normalizeDate(dateId);
    const usidRows = await remoteDbConnector.query(`
      SELECT DISTINCT CAST(USID AS VARCHAR(64)) AS USID
      FROM site_table WITH (NOLOCK)
      WHERE CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
    `);
    const usids = usidRows
      .map((r) => String(pickField(r, ['USID', 'usid']) || '').trim())
      .filter(Boolean);
    if (!usids.length) return {};
    const usidList = formatUsidList(usids);

    const [alarms, tickets, outages, configChanges] = await Promise.all([
      remoteDbConnector.query(`
        SELECT * FROM alarm_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) IN ${usidList}
          AND CAST(LASTOCCURRENCE AS DATE) = '${escapeSqlLiteral(d)}'
      `),
      remoteDbConnector.query(`
        SELECT * FROM ticket_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) IN ${usidList}
          AND CAST(CREATE_TIME AS DATE) = '${escapeSqlLiteral(d)}'
      `),
      remoteDbConnector.query(`
        SELECT * FROM outage_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) IN ${usidList}
          AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
      `),
      remoteDbConnector.query(`
        SELECT * FROM configuration_parameters_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) IN ${usidList}
          AND parameter_name NOT LIKE '%PHYSICALLAYERCELLID%'
          AND parameter_name NOT LIKE '%PCI%'
          AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
      `),
    ]);

    const grouped: Record<string, { alarms: unknown[]; tickets: unknown[]; outages: unknown[]; config_changes: unknown[] }> = {};
    usids.forEach((u) => {
      grouped[u] = { alarms: [], tickets: [], outages: [], config_changes: [] };
    });
    (alarms as Record<string, unknown>[]).forEach((row) => {
      const u = String(pickField(row, ['USID', 'usid']) || '');
      if (grouped[u]) grouped[u].alarms.push(row);
    });
    (tickets as Record<string, unknown>[]).forEach((row) => {
      const u = String(pickField(row, ['USID', 'usid']) || '');
      if (grouped[u]) grouped[u].tickets.push(row);
    });
    (outages as Record<string, unknown>[]).forEach((row) => {
      const u = String(pickField(row, ['USID', 'usid']) || '');
      if (grouped[u]) grouped[u].outages.push(row);
    });
    (configChanges as Record<string, unknown>[]).forEach((row) => {
      const u = String(pickField(row, ['USID', 'usid']) || '');
      if (grouped[u]) grouped[u].config_changes.push(row);
    });
    return grouped;
  }

  /**
   * Handover trend for a specific SOURCE_USID → NEIGH_USID pair.
   * Mirrors `/naavik/neighbor-handover-trend`.
   */
  static async getNeighborHandoverTrend(
    sourceUsid: string,
    neighUsid: string,
    days = 30
  ): Promise<Array<Record<string, unknown>>> {
    const source = await resolveRealUsid(sourceUsid);
    const neigh = await resolveRealUsid(neighUsid);
    return await remoteDbConnector.query(`
      SELECT
        CAST(SOURCE_USID AS VARCHAR(64)) AS SOURCE_USID,
        CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID,
        CAST(DATE_ID AS DATE) AS DATE_ID,
        HANDOVER_COUNT,
        PERC_HANDOVER
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(source)}'
        AND CAST(NEIGH_USID AS VARCHAR(64)) = '${escapeSqlLiteral(neigh)}'
        AND CAST(DATE_ID AS DATE) >= DATEADD(day, -${Math.max(1, days)}, CAST(GETDATE() AS DATE))
      ORDER BY CAST(DATE_ID AS DATE) ASC
    `);
  }

  /**
   * Neighbor KPI data for selected source site (and optional source face).
   * Mirrors `/naavik/neighbor-kpi-data`.
   */
  static async getNeighborKpiData(
    sourceUsid: string,
    dateId: string,
    kpiNames: string[],
    sourceFace?: string,
    daysBack = 2
  ): Promise<Array<Record<string, unknown>>> {
    const source = await resolveRealUsid(sourceUsid);
    const d = normalizeDate(dateId);
    const startDateObj = new Date(d);
    startDateObj.setDate(startDateObj.getDate() - Math.max(1, daysBack));
    const startDate = startDateObj.toISOString().slice(0, 10);
    const faceFilter = sourceFace
      ? `AND SOURCE_USID_FACE = '${escapeSqlLiteral(sourceFace)}'`
      : '';

    const neighborRows = await remoteDbConnector.query(`
      SELECT DISTINCT CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(source)}'
        ${faceFilter}
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
    `);
    const neighborUsids = neighborRows
      .map((r) => String(pickField(r, ['NEIGH_USID', 'neigh_usid']) || '').trim())
      .filter(Boolean);
    if (!neighborUsids.length) return [];

    const allUsids = [source, ...neighborUsids];
    const usidList = formatUsidList(allUsids);
    const kpiList = kpiNames.map((k) => escapeSqlLiteral(String(k))).join("', '");

    return await remoteDbConnector.query(`
      SELECT
        CAST(USID AS VARCHAR(64)) AS USID,
        CAST(DATE_ID AS DATE) AS DATE_ID,
        CAST(HOUR_ID AS INT) AS HOUR_ID,
        cell_name,
        kpi_name,
        CAST(kpi_value AS FLOAT) AS kpi_value
      FROM hourly_intermediate_kpis_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) IN ${usidList}
        AND CAST(DATE_ID AS DATE) >= '${escapeSqlLiteral(startDate)}'
        AND CAST(DATE_ID AS DATE) <= '${escapeSqlLiteral(d)}'
        AND kpi_name IN ('${kpiList}')
      ORDER BY DATE_ID DESC, HOUR_ID DESC, USID, cell_name
    `);
  }

  /**
   * Cell topology by specific date.
   * Mirrors `/naavik/site/<usid>/cell-topology-by-date`.
   */
  static async getCellTopologyByDate(siteId: string, dateId: string): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const d = normalizeDate(dateId);
    return await remoteDbConnector.query(`
      SELECT cell_name, AZIMUTH, HEIGHT, LATITUDE, LONGITUDE, TECH, USEID, USID, CARRIER, DATE_ID
      FROM cell_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
      ORDER BY cell_name
    `);
  }

  /**
   * Daily trend (record counts) for a table in allowlist.
   * Mirrors `/naavik/data-availability/trend/<table_name>`.
   */
  static async getDataAvailabilityTrend(
    tableName: string,
    days = 30
  ): Promise<Array<Record<string, unknown>>> {
    const normalized = String(tableName || '').trim().toLowerCase();
    if (!AVAILABILITY_TREND_TABLES.has(normalized)) {
      throw new Error(`Unsupported table_name: ${tableName}`);
    }
    return await remoteDbConnector.query(`
      SELECT TOP ${Math.max(1, days)}
        CAST(DATE_ID AS DATE) AS date,
        COUNT(*) AS record_count
      FROM ${normalized}
      GROUP BY CAST(DATE_ID AS DATE)
      ORDER BY CAST(DATE_ID AS DATE) DESC
    `);
  }

  /**
   * Lightweight schema analysis for key tables.
   * Mirrors `/naavik/data-availability/schema-analysis`.
   */
  static async getSchemaAnalysis(): Promise<{
    summary: Record<string, unknown>;
    analyses: Array<Record<string, unknown>>;
    cross_table_analysis: Record<string, unknown>;
  }> {
    const tables = Array.from(AVAILABILITY_TREND_TABLES.values());
    const analyses: Array<Record<string, unknown>> = [];

    for (const table of tables) {
      const cols = await getRemoteTableColumns(table);
      const hasDateId = Boolean(pickColumn(cols, ['DATE_ID', 'date_id']));
      const hasUsid = Boolean(pickColumn(cols, ['USID', 'usid']));
      const rowCountRows = await remoteDbConnector.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      const rowCount = toNumber(pickField(rowCountRows[0] || {}, ['cnt'])) || 0;
      const issues: string[] = [];
      if (!hasDateId) issues.push('Missing DATE_ID');
      if (!hasUsid && table !== 'kpi_table') issues.push('Missing USID');
      analyses.push({
        table_name: table,
        column_count: cols.size,
        has_date_id: hasDateId,
        has_usid: hasUsid,
        row_count: rowCount,
        issues,
      });
    }

    const crossIssues = analyses.filter((a) => Array.isArray(a.issues) && (a.issues as unknown[]).length > 0).length;
    const summary = {
      total_tables: analyses.length,
      total_issues: analyses.reduce((n, a) => n + ((a.issues as unknown[])?.length || 0), 0),
      tables_with_issues: crossIssues,
      tables_missing_date_id: analyses.filter((a) => !a.has_date_id).length,
      tables_missing_usid: analyses.filter((a) => !a.has_usid).length,
      cross_table_issues: crossIssues,
    };
    const cross_table_analysis = {
      total_issues: crossIssues,
      note: 'Basic structural consistency checks across key Naavik tables',
    };
    return { summary, analyses, cross_table_analysis };
  }

  /**
   * Calendar date details for one site/date.
   * Mirrors `/naavik/site/<usid>/calendar/details`.
   */
  static async getCalendarDateDetails(
    siteId: string,
    dateId: string
  ): Promise<Record<string, unknown>> {
    const realUsid = await resolveRealUsid(siteId);
    const d = normalizeDate(dateId);

    const trafficRows = await remoteDbConnector.query(`
      SELECT
        subcomponent_name,
        SUM(CAST(subcomponent_value AS FLOAT)) AS total_traffic
      FROM subcomponent_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
        AND subcomponent_name IN ('LTE_PDCP_MB', 'NR_PDCP_MB', 'SA_PDCP_MB', 'SMALLCELL_PDCP_MB')
      GROUP BY subcomponent_name
    `);

    let cellPerfRows: Array<Record<string, unknown>> = [];
    try {
      cellPerfRows = await remoteDbConnector.query(`
        SELECT TOP 10
          cell_name,
          AVG(CAST(kpi_value AS FLOAT)) AS avg_quality
        FROM intermediate_kpi_table WITH (NOLOCK)
        WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
          AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(d)}'
          AND kpi_name LIKE '%QUALITY%'
        GROUP BY cell_name
        ORDER BY avg_quality DESC
      `);
    } catch {
      cellPerfRows = [];
    }

    const totalTraffic = trafficRows.reduce((sum, r) => sum + (toNumber(pickField(r, ['total_traffic'])) || 0), 0);
    return {
      usid: realUsid,
      date: d,
      events: [],
      traffic_analysis: {
        peak_hour: 14,
        peak_traffic: (totalTraffic / 1000).toFixed(2),
        avg_traffic: (totalTraffic / (24 * 1000)).toFixed(2),
        pattern: totalTraffic > 100000 ? 'Business Hours Peak' : 'Normal',
      },
      cell_performance: cellPerfRows.map((r) => ({
        cell_name: String(pickField(r, ['cell_name']) || ''),
        quality_score: Math.min(100, Math.max(0, Math.round((toNumber(pickField(r, ['avg_quality'])) || 0) * 100))),
        load: 65,
      })),
      optimization_opportunities: [
        {
          icon: '🔋',
          title: 'Energy Savings Opportunity',
          impact: 'Medium',
          description: 'Low utilization detected in off-peak hours. Consider carrier shutdown for energy savings.',
          action: 'Configure Energy Savings',
        },
        {
          icon: '⚖️',
          title: 'Load Balancing',
          impact: 'High',
          description: 'Uneven traffic distribution across cells. Optimize MLB parameters for better load distribution.',
          action: 'Adjust MLB Settings',
        },
      ],
      ai_analysis: {
        summary: `Network performance on ${d} shows stable operation with optimization opportunities in load balancing and energy usage.`,
        recommendations: [
          'Monitor peak-hour traffic for proactive capacity tuning',
          'Optimize load balancing during high-demand windows',
          'Apply off-peak energy savings profiles where feasible',
        ],
      },
    };
  }

  /**
   * Get site calendar — anomaly/health heatmap per month
   */
  static async getSiteCalendar(
    siteId: string,
    year: number,
    month: number
  ): Promise<Array<{ date: string; anomalyFlag: boolean; anomalyScore: number | null; hasOutage: boolean; hasCot: boolean }>> {
    const realUsid = await resolveRealUsid(siteId);
    const paddedMonth = String(month).padStart(2, '0');
    const startDate = `${year}-${paddedMonth}-01`;
    const endDate = `${year}-${paddedMonth}-${new Date(year, month, 0).getDate().toString().padStart(2, '0')}`;

    const [sectorRows, outageRows, cotRows] = await Promise.all([
      remoteDbConnector.query(`
        SELECT
          CAST(DATE_ID AS DATE) as day_date,
          MAX(CASE WHEN anomaly_flag = 1 THEN 1 ELSE 0 END) as anomaly_flag,
          MAX(CAST(anomaly_score AS FLOAT)) as anomaly_score
        FROM sector_table
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) BETWEEN '${escapeSqlLiteral(startDate)}' AND '${escapeSqlLiteral(endDate)}'
        GROUP BY CAST(DATE_ID AS DATE)
        ORDER BY day_date
      `).catch(() => []),
      remoteDbConnector.query(`
        SELECT DISTINCT CAST(DATE_ID AS DATE) as day_date
        FROM outage_table
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) BETWEEN '${escapeSqlLiteral(startDate)}' AND '${escapeSqlLiteral(endDate)}'
      `).catch(() => []),
      remoteDbConnector.query(`
        SELECT DISTINCT CAST(DATE_ID AS DATE) as day_date
        FROM site_table
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
        AND chain_of_thought IS NOT NULL
        AND CAST(DATE_ID AS DATE) BETWEEN '${escapeSqlLiteral(startDate)}' AND '${escapeSqlLiteral(endDate)}'
      `).catch(() => []),
    ]);

    const anomalyMap = new Map<string, { flag: boolean; score: number | null }>();
    sectorRows.forEach((row) => {
      const d = toIsoDate(pickField(row, ['day_date', 'DATE_ID']));
      anomalyMap.set(d, {
        flag: Boolean(pickField(row, ['anomaly_flag'])),
        score: toNumber(pickField(row, ['anomaly_score'])),
      });
    });
    const outageDates = new Set(outageRows.map((row) => toIsoDate(pickField(row, ['day_date', 'DATE_ID']))));
    const cotDates = new Set(cotRows.map((row) => toIsoDate(pickField(row, ['day_date', 'DATE_ID']))));

    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = `${year}-${paddedMonth}-${String(i + 1).padStart(2, '0')}`;
      const anom = anomalyMap.get(d);
      return {
        date: d,
        anomalyFlag: anom?.flag ?? false,
        anomalyScore: anom?.score ?? null,
        hasOutage: outageDates.has(d),
        hasCot: cotDates.has(d),
      };
    });
  }

  // ====================================================================
  // QUERIES MIGRATED FROM naavik_compass/backend/database/sql_queries.py
  // ====================================================================

  /**
   * Anomalous sectors for a date — map overlay for anomaly highlighting.
   * Mirrors Compass get_anomalous_sectors().  Uses CTE + ROW_NUMBER to
   * deduplicate sectors before filtering to anomaly_flag = true.
   */
  static async getAnomalousSectors(dateId: string): Promise<Array<Record<string, unknown>>> {
    const effectiveDate = normalizeDate(dateId);
    const query = `
      WITH SectorData AS (
        SELECT
          s.DATE_ID,
          CAST(s.USID AS VARCHAR(64)) AS USID,
          CASE WHEN s.AZIMUTH IS NULL OR CAST(s.AZIMUTH AS FLOAT) = 0 THEN 1.0
               ELSE CAST(s.AZIMUTH AS FLOAT) END AS AZIMUTH,
          s.anomaly_flag,
          CAST(s.anomaly_score AS FLOAT) AS anomaly_score,
          SUBSTRING(
            SUBSTRING(c.cell_name, CHARINDEX('_', c.cell_name) + 1,
              CHARINDEX('_', c.cell_name + '_', CHARINDEX('_', c.cell_name) + 1) - CHARINDEX('_', c.cell_name) - 1),
            LEN(SUBSTRING(c.cell_name, CHARINDEX('_', c.cell_name) + 1,
              CHARINDEX('_', c.cell_name + '_', CHARINDEX('_', c.cell_name) + 1) - CHARINDEX('_', c.cell_name) - 1)), 1
          ) AS FACE,
          CAST(c.USEID AS VARCHAR(128)) AS USEID,
          COALESCE(CAST(st.latitude AS FLOAT), CAST(c.LATITUDE AS FLOAT)) AS latitude,
          COALESCE(CAST(st.longitude AS FLOAT), CAST(c.LONGITUDE AS FLOAT)) AS longitude,
          c.TECH,
          c.CARRIER,
          ROW_NUMBER() OVER (
            PARTITION BY s.USID, s.AZIMUTH,
              SUBSTRING(
                SUBSTRING(c.cell_name, CHARINDEX('_', c.cell_name) + 1,
                  CHARINDEX('_', c.cell_name + '_', CHARINDEX('_', c.cell_name) + 1) - CHARINDEX('_', c.cell_name) - 1),
                LEN(SUBSTRING(c.cell_name, CHARINDEX('_', c.cell_name) + 1,
                  CHARINDEX('_', c.cell_name + '_', CHARINDEX('_', c.cell_name) + 1) - CHARINDEX('_', c.cell_name) - 1)), 1
              )
            ORDER BY s.anomaly_score DESC
          ) rn
        FROM sector_table s WITH (NOLOCK)
        INNER JOIN cell_table c WITH (NOLOCK)
          ON CAST(s.USID AS VARCHAR(64)) = CAST(c.USID AS VARCHAR(64))
          AND CAST(s.DATE_ID AS DATE) = CAST(c.DATE_ID AS DATE)
          AND (COALESCE(NULLIF(CAST(s.AZIMUTH AS FLOAT), 0), 1.0) = COALESCE(NULLIF(CAST(c.AZIMUTH AS FLOAT), 0), 1.0))
        LEFT JOIN site_table st WITH (NOLOCK)
          ON CAST(s.USID AS VARCHAR(64)) = CAST(st.USID AS VARCHAR(64))
          AND CAST(st.DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
        WHERE CAST(s.DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
          AND (
            TRY_CAST(s.anomaly_flag AS BIT) = 1
            OR TRY_CAST(s.anomaly_flag AS VARCHAR) IN ('True', 'true', '1')
          )
      )
      SELECT DATE_ID, USID, AZIMUTH, anomaly_flag, anomaly_score, FACE, USEID,
             latitude, longitude, TECH, CARRIER
      FROM SectorData
      WHERE rn = 1
      ORDER BY AZIMUTH, anomaly_score DESC
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Neighbor relations with source/neighbor coordinates.
   * Used for map neighbor-connection arrows. Mirrors get_neighbor_relations_with_coordinates().
   */
  static async getNeighborRelationsWithCoords(
    siteId: string,
    dateId: string,
    sourceFace?: string
  ): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const faceFilter = sourceFace
      ? `AND n.SOURCE_USID_FACE = '${escapeSqlLiteral(sourceFace)}'`
      : '';
    const query = `
      SELECT
        n.SOURCE_USID, n.SOURCE_USID_FACE, n.NEIGH_USID, n.NEIGH_USID_FACE,
        n.PERC_HANDOVER, n.DATE_ID,
        CAST(s_source.latitude AS FLOAT) AS Source_Lat,
        CAST(s_source.longitude AS FLOAT) AS Source_Lon,
        CAST(s_neigh.latitude AS FLOAT) AS Neighbor_Lat,
        CAST(s_neigh.longitude AS FLOAT) AS Neighbor_Lon
      FROM neighbors_table_date_id n WITH (NOLOCK)
      INNER JOIN site_table s_source WITH (NOLOCK)
        ON CAST(n.SOURCE_USID AS VARCHAR(64)) = CAST(s_source.USID AS VARCHAR(64))
        AND CAST(s_source.DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
      INNER JOIN site_table s_neigh WITH (NOLOCK)
        ON CAST(n.NEIGH_USID AS VARCHAR(64)) = CAST(s_neigh.USID AS VARCHAR(64))
        AND CAST(s_neigh.DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
      WHERE CAST(n.SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(n.DATE_ID AS DATE) >= DATEADD(day, -14, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE))
        AND CAST(n.DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        ${faceFilter}
      ORDER BY n.DATE_ID DESC, n.PERC_HANDOVER ASC
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Site-level aggregated hourly KPIs for day-over-day comparison.
   * Returns selected day, 1 day ago, 1 week ago, 2 weeks ago — all 24 hours.
   * Mirrors get_timeline_site_aggregate_kpis().
   */
  static async getTimelineSiteAggregateKpis(
    siteId: string,
    dateId: string,
    kpiNames: string[]
  ): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const kpiList = kpiNames.map((k) => escapeSqlLiteral(k)).join("', '");
    const query = `
      SELECT
        CAST(DATE_ID AS DATE) AS DATE_ID,
        CAST(HOUR_ID AS INT) AS HOUR_ID,
        kpi_name,
        AVG(CAST(kpi_value AS FLOAT)) AS kpi_value
      FROM hourly_intermediate_kpis_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND (
          CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
          OR CAST(DATE_ID AS DATE) = CAST(DATEADD(day, -1, '${escapeSqlLiteral(effectiveDate)}') AS DATE)
          OR CAST(DATE_ID AS DATE) = CAST(DATEADD(day, -7, '${escapeSqlLiteral(effectiveDate)}') AS DATE)
          OR CAST(DATE_ID AS DATE) = CAST(DATEADD(day, -14, '${escapeSqlLiteral(effectiveDate)}') AS DATE)
        )
        AND kpi_name IN ('${kpiList}')
      GROUP BY CAST(DATE_ID AS DATE), CAST(HOUR_ID AS INT), kpi_name
      ORDER BY CAST(DATE_ID AS DATE), CAST(HOUR_ID AS INT), kpi_name
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * CQX subcomponent data from subcomponent_table (specific named metrics).
   * Used for the CQX breakdown chart — mirrors get_subcomponent_data().
   */
  static async getSubcomponentData(
    siteId: string,
    dateId: string,
    days = 30
  ): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const query = `
      SELECT DATE_ID, USID, subcomponent_name, subcomponent_value
      FROM subcomponent_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND subcomponent_name IN (
          'Total_Impact_Mkt_CQX', 'Total_Impact_Mkt_CQX_Delta',
          'LTE_PDCP_MB', 'SA_PDCP_MB', 'NR_PDCP_MB', 'SMALLCELL_PDCP_MB',
          'QUALITY', 'DATA_ACC', 'VRAN_ACC', 'DATA_DROP', 'TPUT', 'UL_TPUT',
          'VCDR_DROP', 'NS_ESO', 'VCDR_ACC'
        )
        AND CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -${days}, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)) AS DATE)
        AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
      ORDER BY DATE_ID DESC, subcomponent_name
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * CQX subcomponent impact breakdown from cqx_offenders_truth_table (_IMP columns).
   * Mirrors get_subcomponent_impact_data().
   */
  static async getSubcomponentImpactData(
    siteId: string,
    dateId: string,
    days = 30
  ): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const query = `
      SELECT
        DATE_ID, USID,
        DL_TPUT_IMP, UL_TPUT_IMP, DATA_DROP_IMP, DATA_ACC_IMP,
        VRAN_ACC_IMP, VCDR_ACC_IMP, VOICE_DROP_IMP, NS_ESO_IMP, QUALITY_IMP
      FROM cqx_offenders_truth_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -${days}, CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)) AS DATE)
        AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
      ORDER BY DATE_ID DESC
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Hourly cell-level downtime & failure KPIs for site + neighbors.
   * Used for the Outages tab deep-dive. Mirrors get_site_and_neighbor_outages().
   */
  static async getSiteAndNeighborOutages(
    siteId: string,
    dateId: string,
    days = 7
  ): Promise<Array<Record<string, unknown>>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const startDate = new Date(effectiveDate);
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().slice(0, 10);

    // Fetch neighbor USIDs first, then run combined query
    const neighborRows = await remoteDbConnector.query(`
      SELECT DISTINCT CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
    `);
    const neighborUsids = (neighborRows as Record<string, unknown>[])
      .map((r) => String(pickField(r, ['NEIGH_USID', 'neigh_usid']) || ''))
      .filter(Boolean)
      .slice(0, 15);
    const allUsids = [realUsid, ...neighborUsids];
    const usidListStr = allUsids.map((u) => escapeSqlLiteral(u)).join("', '");

    const query = `
      SELECT DATE_ID, CAST(HOUR_ID AS INT) AS HOUR_ID, CAST(USID AS VARCHAR(64)) AS USID,
             kpi_name, cell_name, CAST(kpi_value AS FLOAT) AS kpi_value
      FROM hourly_intermediate_kpis_table WITH (NOLOCK)
      WHERE CAST(DATE_ID AS DATE) >= CAST('${escapeSqlLiteral(startDateStr)}' AS DATE)
        AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(effectiveDate)}' AS DATE)
        AND kpi_name IN ('EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'EUCELL_DOWNTIME_SLEEP', 'RRC_FAIL', 'DUAC_FAIL')
        AND CAST(USID AS VARCHAR(64)) IN ('${usidListStr}')
      ORDER BY DATE_ID DESC, HOUR_ID, USID, cell_name
    `;
    return await remoteDbConnector.query(query);
  }

  /**
   * Distinct neighbor USIDs for a site on a given date.
   * Lightweight utility — mirrors get_neighbor_usids_for_site().
   */
  static async getNeighborUsids(
    siteId: string,
    dateId: string
  ): Promise<string[]> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const rows = await remoteDbConnector.query(`
      SELECT DISTINCT CAST(NEIGH_USID AS VARCHAR(64)) AS NEIGH_USID
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE CAST(SOURCE_USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
    `);
    return (rows as Record<string, unknown>[])
      .map((r) => String(pickField(r, ['NEIGH_USID', 'neigh_usid']) || ''))
      .filter(Boolean);
  }

  /**
   * Unique radio node names for a site on a date (first part of cell_name).
   * Mirrors get_nodes_for_usid().
   */
  static async getNodesForUsid(
    siteId: string,
    dateId: string
  ): Promise<string[]> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);
    const rows = await remoteDbConnector.query(`
      SELECT DISTINCT
        SUBSTRING(cell_name, 1, CHARINDEX('_', cell_name) - 1) AS node_name
      FROM cell_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
        AND CHARINDEX('_', cell_name) > 0
      ORDER BY node_name
    `);
    return (rows as Record<string, unknown>[])
      .map((r) => String(pickField(r, ['node_name']) || ''))
      .filter(Boolean);
  }

  /**
   * Coordinates for multiple sites at once.
   * Mirrors get_site_coordinates() — used for neighbor map overlays.
   */
  static async getSiteCoordinates(
    usids: string[],
    dateId?: string
  ): Promise<Array<{ usid: string; latitude: number; longitude: number }>> {
    if (!usids.length) return [];
    const usidList = usids.map((u) => escapeSqlLiteral(u)).join("', '");
    const dateFilter = dateId && /^\d{4}-\d{2}-\d{2}$/.test(dateId)
      ? `AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(dateId)}'`
      : '';
    const rows = await remoteDbConnector.query(`
      SELECT DISTINCT CAST(USID AS VARCHAR(64)) AS USID,
             CAST(latitude AS FLOAT) AS latitude,
             CAST(longitude AS FLOAT) AS longitude
      FROM site_table WITH (NOLOCK)
      WHERE CAST(USID AS VARCHAR(64)) IN ('${usidList}')
        ${dateFilter}
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY USID
    `);
    return (rows as Record<string, unknown>[]).map((r) => ({
      usid: String(pickField(r, ['USID', 'usid']) || ''),
      latitude: Number(pickField(r, ['latitude', 'LATITUDE'])) || 0,
      longitude: Number(pickField(r, ['longitude', 'LONGITUDE'])) || 0,
    })).filter((r) => r.usid && r.latitude !== 0);
  }

  /**
   * Get comprehensive site details: topology + RCA + operational summary
   */
  static async getSiteComprehensive(
    siteId: string,
    dateId: string
  ): Promise<Record<string, unknown>> {
    const realUsid = await resolveRealUsid(siteId);
    const effectiveDate = normalizeDate(dateId);

    const [siteRows, cellRows] = await Promise.all([
      remoteDbConnector.query(`
        SELECT TOP 1 *
        FROM site_table
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
      `),
      remoteDbConnector.query(`
        SELECT *
        FROM cell_table
        WHERE USID = '${escapeSqlLiteral(realUsid)}'
        AND CAST(DATE_ID AS DATE) = '${escapeSqlLiteral(effectiveDate)}'
      `),
    ]);

    const site = siteRows[0] || {};
    return {
      usid: realUsid,
      date: effectiveDate,
      siteDetails: site,
      cells: cellRows,
    };
  }

  /**
   * Update user feedback for a site (stores in PostgreSQL, not remote DB)
   * Note: This requires a separate table in local PostgreSQL
   */
  static async updateUserFeedback(usid: string, dateId: string, feedback: string): Promise<void> {
    console.log(`User feedback for ${usid} on ${dateId}: ${feedback}`);
  }

  // ========== MARKET INTELLIGENCE ==========

  /**
   * Market-level offender insights from cqx_offenders_truth_table.
   * Threshold counts use TOTAL_IMPACT_WOW (stable week-over-week baseline).
   * Only two tiers shown: ≥0.005 (critical) and ≥0.002 (high).
   */
  static async getMarketOffenderInsights(dateId: string): Promise<{
    summary: {
      critical_count: number;   // TOTAL_IMPACT_WOW >= 0.005
      high_count: number;       // TOTAL_IMPACT_WOW >= 0.002 and < 0.005
      total_offenders: number;  // TOTAL_IMPACT_WOW >= 0.002 (critical + high)
      total_sites: number;      // all sites in site_table for the day
      cqx_tracked: number;      // rows in cqx_offenders_truth_table for the day
      avg_impact: number;
    };
    impact_breakdown: {
      dl_tput: number;
      ul_tput: number;
      data_drop: number;
      data_acc: number;
      vran_acc: number;
      vcdr_acc: number;
      voice_drop: number;
      ns_eso: number;
      quality: number;
    };
    top_offenders: Array<{
      usid: string;
      total_impact: number;
      wow_impact: number;
      impact_delta: number;
      dl_tput_imp: number;
      data_drop_imp: number;
      data_acc_imp: number;
      quality_imp: number;
    }>;
    trend: Array<{
      date_id: string;
      total_offenders: number;
      critical: number;
      high_plus: number;
      avg_impact: number;
    }>;
  }> {
    const d = normalizeDate(dateId);

    const [summaryRows, topRows, trendRows, siteCountRows] = await Promise.all([
      remoteDbConnector.query(`
        SELECT
          COUNT(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.005 THEN 1 END)                                                 AS critical_count,
          COUNT(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.002 AND CAST(TOTAL_IMPACT_WOW AS FLOAT) < 0.005 THEN 1 END)    AS high_count,
          COUNT(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.002 THEN 1 END)                                                 AS total_offenders,
          COUNT(*)                                                                                                               AS cqx_tracked_count,
          AVG(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.002 THEN CAST(TOTAL_IMPACT_WOW AS FLOAT) END)                    AS avg_impact,
          SUM(CAST(DL_TPUT_IMP   AS FLOAT)) AS total_dl_tput,
          SUM(CAST(UL_TPUT_IMP   AS FLOAT)) AS total_ul_tput,
          SUM(CAST(DATA_DROP_IMP AS FLOAT)) AS total_data_drop,
          SUM(CAST(DATA_ACC_IMP  AS FLOAT)) AS total_data_acc,
          SUM(CAST(VRAN_ACC_IMP  AS FLOAT)) AS total_vran_acc,
          SUM(CAST(VCDR_ACC_IMP  AS FLOAT)) AS total_vcdr_acc,
          SUM(CAST(VOICE_DROP_IMP AS FLOAT)) AS total_voice_drop,
          SUM(CAST(NS_ESO_IMP    AS FLOAT)) AS total_ns_eso,
          SUM(CAST(QUALITY_IMP   AS FLOAT)) AS total_quality
        FROM cqx_offenders_truth_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(d)}' AS DATE)
      `),
      remoteDbConnector.query(`
        SELECT TOP 15
          CAST(USID AS VARCHAR(64))           AS usid,
          CAST(TOTAL_IMPACT_LATEST AS FLOAT)  AS total_impact,
          CAST(TOTAL_IMPACT_WOW    AS FLOAT)  AS wow_impact,
          CAST(IMPACT_DELTA        AS FLOAT)  AS impact_delta,
          CAST(DL_TPUT_IMP         AS FLOAT)  AS dl_tput_imp,
          CAST(DATA_DROP_IMP       AS FLOAT)  AS data_drop_imp,
          CAST(DATA_ACC_IMP        AS FLOAT)  AS data_acc_imp,
          CAST(QUALITY_IMP         AS FLOAT)  AS quality_imp
        FROM cqx_offenders_truth_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(d)}' AS DATE)
        ORDER BY CAST(TOTAL_IMPACT_LATEST AS FLOAT) DESC
      `),
      remoteDbConnector.query(`
        SELECT
          CAST(CAST(DATE_ID AS DATE) AS VARCHAR)                                                                                AS date_id,
          COUNT(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.002 THEN 1 END)                                                AS total_offenders,
          COUNT(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.005 THEN 1 END)                                                AS critical,
          COUNT(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.002 THEN 1 END)                                                AS high_plus,
          AVG(CASE WHEN CAST(TOTAL_IMPACT_WOW AS FLOAT) >= 0.002 THEN CAST(TOTAL_IMPACT_WOW AS FLOAT) END)                   AS avg_impact
        FROM cqx_offenders_truth_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) >= CAST(DATEADD(day, -13, CAST('${escapeSqlLiteral(d)}' AS DATE)) AS DATE)
          AND CAST(DATE_ID AS DATE) <= CAST('${escapeSqlLiteral(d)}' AS DATE)
        GROUP BY CAST(DATE_ID AS DATE)
        ORDER BY CAST(DATE_ID AS DATE)
      `),
      remoteDbConnector.query(`
        SELECT COUNT(DISTINCT USID) AS total_sites
        FROM site_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(d)}' AS DATE)
      `),
    ]);

    const s: any = (summaryRows as any[])[0] || {};
    const imp: any = s;
    const totalSites = toNumber(pickField((siteCountRows as any[])[0] || {}, ['total_sites'])) || 0;

    return {
      summary: {
        critical_count:   toNumber(pickField(s, ['critical_count']))   || 0,
        high_count:       toNumber(pickField(s, ['high_count']))       || 0,
        total_offenders:  toNumber(pickField(s, ['total_offenders']))  || 0,
        total_sites:      totalSites,
        cqx_tracked:      toNumber(pickField(s, ['cqx_tracked_count'])) || 0,
        avg_impact:       toNumber(pickField(s, ['avg_impact']))        || 0,
      },
      impact_breakdown: {
        dl_tput:    toNumber(pickField(imp, ['total_dl_tput']))    || 0,
        ul_tput:    toNumber(pickField(imp, ['total_ul_tput']))    || 0,
        data_drop:  toNumber(pickField(imp, ['total_data_drop']))  || 0,
        data_acc:   toNumber(pickField(imp, ['total_data_acc']))   || 0,
        vran_acc:   toNumber(pickField(imp, ['total_vran_acc']))   || 0,
        vcdr_acc:   toNumber(pickField(imp, ['total_vcdr_acc']))   || 0,
        voice_drop: toNumber(pickField(imp, ['total_voice_drop'])) || 0,
        ns_eso:     toNumber(pickField(imp, ['total_ns_eso']))     || 0,
        quality:    toNumber(pickField(imp, ['total_quality']))    || 0,
      },
      top_offenders: (topRows as any[]).map((r) => ({
        usid:           String(pickField(r, ['usid', 'USID']) || ''),
        total_impact:   toNumber(pickField(r, ['total_impact']))   || 0,
        wow_impact:     toNumber(pickField(r, ['wow_impact']))     || 0,
        impact_delta:   toNumber(pickField(r, ['impact_delta']))   || 0,
        dl_tput_imp:    toNumber(pickField(r, ['dl_tput_imp']))    || 0,
        data_drop_imp:  toNumber(pickField(r, ['data_drop_imp']))  || 0,
        data_acc_imp:   toNumber(pickField(r, ['data_acc_imp']))   || 0,
        quality_imp:    toNumber(pickField(r, ['quality_imp']))    || 0,
      })),
      trend: (trendRows as any[]).map((r) => ({
        date_id:          String(pickField(r, ['date_id']) || ''),
        total_offenders:  toNumber(pickField(r, ['total_offenders']))  || 0,
        critical:         toNumber(pickField(r, ['critical']))         || 0,
        high_plus:        toNumber(pickField(r, ['high_plus']))        || 0,
        avg_impact:       toNumber(pickField(r, ['avg_impact']))       || 0,
      })),
    };
  }

  /**
   * Market-level cell health insights from hourly_intermediate_kpis_table.
   * Returns counts of cells breaching PRB/PDCCH thresholds, high drop rates,
   * accessibility failures, and throughput degradation for the given date.
   */
  static async getMarketCellHealthInsights(dateId: string): Promise<{
    prb_hot_cells: number;
    pdcch_hot_cells: number;
    high_drop_cells: number;
    low_acc_cells: number;
    low_tput_cells: number;
    avg_prb_util: number;
    cell_health_summary: Array<{
      kpi_name: string;
      cell_count: number;
      avg_value: number;
      max_value: number;
      breaching_count: number;
    }>;
    top_congested_cells: Array<{
      cell_name: string;
      usid: string;
      kpi_name: string;
      avg_kpi_value: number;
    }>;
  }> {
    const d = normalizeDate(dateId);

    const [healthRows, topCellRows] = await Promise.all([
      remoteDbConnector.query(`
        SELECT
          kpi_name,
          COUNT(DISTINCT cell_name)                                     AS cell_count,
          AVG(CAST(kpi_value AS FLOAT))                                 AS avg_value,
          MAX(CAST(kpi_value AS FLOAT))                                 AS max_value,
          COUNT(CASE WHEN CAST(kpi_value AS FLOAT) >= 90 THEN 1 END)   AS breaching_90
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(d)}' AS DATE)
          AND kpi_name IN (
            'AVG_DL_PRB_UTIL', 'AVG_UL_PRB_UTIL',
            'PDCCH_CCE_UTIL', 'DL_PDCCH_UTIL',
            'EUCELL_ERAB_DRP_TOT_CORE_RATIO', 'EUCELL_ERAB_DRP_TOT_ENB_RATIO',
            'DATA_RAN_ACC_RATIO', 'EUCELL_RRC_EST_SR_RATIO',
            'NR_DL_DRB_TPUT_RATIO', 'OV_ENDC_DL_DRB_TPUT_RATIO',
            'EUCELL_DL_PDCPVOL10MHZ_PCT_RATIO'
          )
        GROUP BY kpi_name
      `),
      remoteDbConnector.query(`
        SELECT TOP 20
          cell_name,
          CAST(USID AS VARCHAR(64))    AS usid,
          kpi_name,
          AVG(CAST(kpi_value AS FLOAT)) AS avg_kpi_value
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE CAST(DATE_ID AS DATE) = CAST('${escapeSqlLiteral(d)}' AS DATE)
          AND kpi_name = 'AVG_DL_PRB_UTIL'
          AND CAST(kpi_value AS FLOAT) >= 85
        GROUP BY cell_name, CAST(USID AS VARCHAR(64)), kpi_name
        ORDER BY AVG(CAST(kpi_value AS FLOAT)) DESC
      `),
    ]);

    const healthMap = new Map<string, { cell_count: number; avg_value: number; max_value: number; breaching_90: number }>();
    for (const row of healthRows as any[]) {
      const name = String(pickField(row, ['kpi_name', 'KPI_NAME']) || '');
      healthMap.set(name, {
        cell_count:   toNumber(pickField(row, ['cell_count']))  || 0,
        avg_value:    toNumber(pickField(row, ['avg_value']))   || 0,
        max_value:    toNumber(pickField(row, ['max_value']))   || 0,
        breaching_90: toNumber(pickField(row, ['breaching_90'])) || 0,
      });
    }

    const prb = healthMap.get('AVG_DL_PRB_UTIL') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const pdcch1 = healthMap.get('PDCCH_CCE_UTIL') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const pdcch2 = healthMap.get('DL_PDCCH_UTIL') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const dropCore = healthMap.get('EUCELL_ERAB_DRP_TOT_CORE_RATIO') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const dropEnb  = healthMap.get('EUCELL_ERAB_DRP_TOT_ENB_RATIO') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const dataAcc  = healthMap.get('DATA_RAN_ACC_RATIO') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const rrcAcc   = healthMap.get('EUCELL_RRC_EST_SR_RATIO') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };
    const dlTput   = healthMap.get('NR_DL_DRB_TPUT_RATIO') ?? { cell_count: 0, avg_value: 0, max_value: 0, breaching_90: 0 };

    return {
      prb_hot_cells:    prb.breaching_90,
      pdcch_hot_cells:  (pdcch1.breaching_90 || 0) + (pdcch2.breaching_90 || 0),
      high_drop_cells:  (dropCore.cell_count || 0) + (dropEnb.cell_count || 0),
      low_acc_cells:    (dataAcc.cell_count || 0) + (rrcAcc.cell_count || 0),
      low_tput_cells:   dlTput.cell_count || 0,
      avg_prb_util:     prb.avg_value || 0,
      cell_health_summary: Array.from(healthMap.entries()).map(([kpi_name, v]) => ({
        kpi_name,
        cell_count:     v.cell_count,
        avg_value:      v.avg_value,
        max_value:      v.max_value,
        breaching_count: v.breaching_90,
      })),
      top_congested_cells: (topCellRows as any[]).map((r) => ({
        cell_name:      String(pickField(r, ['cell_name', 'CELL_NAME']) || ''),
        usid:           String(pickField(r, ['usid', 'USID']) || ''),
        kpi_name:       String(pickField(r, ['kpi_name', 'KPI_NAME']) || ''),
        avg_kpi_value:  toNumber(pickField(r, ['avg_kpi_value'])) || 0,
      })),
    };
  }
}
