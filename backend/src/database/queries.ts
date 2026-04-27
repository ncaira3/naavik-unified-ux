/**
 * SQL Query Templates for Remote Naavik Database (MSSQL / SQL Server)
 * Mirrors naavik_compass/backend/database/sql_queries.py
 *
 * All queries use MSSQL syntax (TOP, CAST AS DATETIME, DATEADD, WITH (NOLOCK), etc.)
 * because the remote endpoint is backed by SQL Server via ODBC Driver 18.
 */

export class SQLQueries {
  // ---------------------------------------------------------------------------
  // Date & USID selection
  // ---------------------------------------------------------------------------

  /** All distinct dates with chain_of_thought RCA data */
  static getDatesWithRCA(): string {
    return `
      SELECT DISTINCT CAST(DATE_ID AS DATE) AS DATE_ID
      FROM site_table
      WHERE chain_of_thought IS NOT NULL
      ORDER BY DATE_ID DESC
    `;
  }

  /** All distinct dates from subcomponent_table, newest first */
  static getAllDates(): string {
    return `
      SELECT DISTINCT(DATE_ID)
      FROM subcomponent_table
      ORDER BY DATE_ID DESC
    `;
  }

  /** All distinct USIDs for a given date (or all dates) */
  static getAllUSIDs(dateId?: string): string {
    if (dateId) {
      return `
        SELECT DISTINCT USID
        FROM subcomponent_table
        WHERE DATE_ID = '${dateId}'
        ORDER BY USID ASC
      `;
    }
    return `
      SELECT DISTINCT USID
      FROM subcomponent_table
      ORDER BY USID ASC
    `;
  }

  /**
   * All USIDs from site_table for a given date — used to bootstrap
   * SiteIdMapper without a local PostgreSQL database.
   */
  static getSiteUSIDsForDate(dateId: string): string {
    return `
      SELECT DISTINCT TOP 1000 USID
      FROM site_table
      WHERE DATE_ID = CAST('${dateId}' AS DATETIME)
      AND USID IS NOT NULL
    `;
  }

  /** Latest date available in site_table */
  static getLatestSiteDate(): string {
    return `SELECT MAX(DATE_ID) AS latest_date FROM site_table`;
  }

  // ---------------------------------------------------------------------------
  // Offenders (Super KPI delta)
  // ---------------------------------------------------------------------------

  /**
   * Top 50 offender USIDs for a date, sorted by Total_Impact_Mkt_CQX_Delta.
   * Requires chain_of_thought to be populated (RCA available).
   */
  static getOffenderUSIDs(dateId: string): string {
    return `
      SELECT TOP 50 s.USID, sc.subcomponent_value AS Total_Impact_to_SuperKPI_Delta
      FROM (
        SELECT USID
        FROM site_table
        WHERE DATE_ID = '${dateId}'
        AND chain_of_thought IS NOT NULL
      ) s
      INNER JOIN subcomponent_table sc
        ON s.USID = sc.USID
        AND sc.DATE_ID = '${dateId}'
        AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
      ORDER BY sc.subcomponent_value DESC
    `;
  }

  // ---------------------------------------------------------------------------
  // KPI data
  // ---------------------------------------------------------------------------

  /** Daily cell KPIs for one USID over a date range */
  static getDailyCellKPIsForDateRange(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): string {
    const kpiList = kpiNames.join("', '");
    return `
      SELECT USID, DATE_ID, cell_name, kpi_name, kpi_value
      FROM intermediate_kpi_table WITH (NOLOCK)
      WHERE USID = '${usid}'
      AND DATE_ID >= CAST('${startDate}' AS DATETIME)
      AND DATE_ID <= CAST('${endDate}' AS DATETIME)
      AND kpi_name IN ('${kpiList}')
    `;
  }

  /**
   * Hourly cell KPIs for one USID.
   * Uses DATEADD to include ALL hours of the end date.
   */
  static getHourlyCellKPIsForDateRange(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): string {
    const kpiList = kpiNames.join("', '");
    return `
      SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
      FROM hourly_intermediate_kpis_table WITH (NOLOCK)
      WHERE USID = '${usid}'
      AND DATE_ID >= CAST('${startDate}' AS DATETIME)
      AND DATE_ID < DATEADD(day, 1, CAST('${endDate}' AS DATETIME))
      AND kpi_name IN ('${kpiList}')
    `;
  }

  /** Hourly KPIs for multiple USIDs (site + neighbors) */
  static getHourlyCellKPIsForMultipleUSIDs(
    usids: string[],
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): string {
    const usidList = usids.join("', '");
    const kpiList = kpiNames.join("', '");
    return `
      SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
      FROM hourly_intermediate_kpis_table WITH (NOLOCK)
      WHERE USID IN ('${usidList}')
      AND DATE_ID >= CAST('${startDate}' AS DATETIME)
      AND DATE_ID < DATEADD(day, 1, CAST('${endDate}' AS DATETIME))
      AND kpi_name IN ('${kpiList}')
    `;
  }

  // ---------------------------------------------------------------------------
  // Cell / node helpers
  // ---------------------------------------------------------------------------

  /** Unique node names (prefix before first '_') for a USID on a date */
  static getNodesForUSID(usid: string, date: string): string {
    return `
      SELECT DISTINCT
        SUBSTRING(cell_name, 1, CHARINDEX('_', cell_name) - 1) AS node_name
      FROM cell_table
      WHERE USID = '${usid}'
      AND DATE_ID = CAST('${date}' AS DATETIME)
      AND CHARINDEX('_', cell_name) > 0
      ORDER BY node_name
    `;
  }

  // ---------------------------------------------------------------------------
  // Neighbors
  // ---------------------------------------------------------------------------

  /** Neighbor USIDs for a source USID on a date */
  static getNeighborUSIDs(usid: string, date: string): string {
    return `
      SELECT DISTINCT NEIGH_USID
      FROM neighbors_table_date_id WITH (NOLOCK)
      WHERE SOURCE_USID = '${usid}'
      AND DATE_ID = CAST('${date}' AS DATETIME)
    `;
  }

  /**
   * Full neighbor rows with site coordinates for map rendering.
   * Looks back 14 days from the given date.
   */
  static getNeighborRows(usid: string, date: string, sourceFace?: string): string {
    const faceFilter = sourceFace ? `AND n.SOURCE_USID_FACE = '${sourceFace}'` : '';
    return `
      SELECT
        n.SOURCE_USID,
        n.NEIGH_USID,
        n.SOURCE_USID_FACE,
        n.NEIGH_USID_FACE,
        s_source.Latitude AS Source_Lat,
        s_source.Longitude AS Source_Lon,
        s_neigh.Latitude AS Neighbor_Lat,
        s_neigh.Longitude AS Neighbor_Lon,
        n.PERC_HANDOVER,
        n.DATE_ID
      FROM neighbors_table_date_id n WITH (NOLOCK)
      INNER JOIN site_table s_source
        ON n.SOURCE_USID = s_source.USID
        AND s_source.DATE_ID = CAST('${date}' AS DATETIME)
      INNER JOIN site_table s_neigh
        ON n.NEIGH_USID = s_neigh.USID
        AND s_neigh.DATE_ID = CAST('${date}' AS DATETIME)
      WHERE n.SOURCE_USID = '${usid}'
      AND n.DATE_ID > DATEADD(day, -14, CAST('${date}' AS DATETIME))
      ${faceFilter}
    `;
  }
}
