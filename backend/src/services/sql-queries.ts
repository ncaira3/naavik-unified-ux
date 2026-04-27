/**
 * SQL Query Templates for Remote Naavik Database
 * Ported from naavik_compass_old/backend/database/sql_queries.py
 */

export class SQLQueries {
  private static getDialect(): 'postgres' | 'mssql' {
    // Remote query service is backed by SQL Server (ODBC Driver 18).
    // Force MSSQL syntax to avoid DATE literal parse errors.
    return 'mssql';
  }

  /**
   * Get daily cell KPIs for a date range
   * Table: intermediate_kpi_table
   */
  static getDailyCellKPIsForDateRange(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): string {
    const kpiList = kpiNames.join("', '");
    const dialect = this.getDialect();

    if (dialect === 'mssql') {
      return `
        SELECT USID, DATE_ID, cell_name, kpi_name, kpi_value
        FROM intermediate_kpi_table WITH (NOLOCK)
        WHERE USID = '${usid}'
        AND DATE_ID >= CAST('${startDate}' AS DATETIME)
        AND DATE_ID <= CAST('${endDate}' AS DATETIME)
        AND kpi_name IN ('${kpiList}')
      `;
    }

    return `
      SELECT USID, DATE_ID, cell_name, kpi_name, kpi_value
      FROM intermediate_kpi_table
      WHERE USID = '${usid}'
      AND DATE_ID >= DATE '${startDate}'
      AND DATE_ID <= DATE '${endDate}'
      AND kpi_name IN ('${kpiList}')
    `;
  }

  /**
   * Get hourly cell KPIs for a date range
   * Table: hourly_intermediate_kpis_table
   * Note: Uses DATEADD to include ALL hours of the end date
   */
  static getHourlyCellKPIsForDateRange(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): string {
    const kpiList = kpiNames.join("', '");
    const dialect = this.getDialect();

    if (dialect === 'mssql') {
      return `
        SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE USID = '${usid}'
        AND DATE_ID >= CAST('${startDate}' AS DATETIME)
        AND DATE_ID < DATEADD(day, 1, CAST('${endDate}' AS DATETIME))
        AND kpi_name IN ('${kpiList}')
      `;
    }

    return `
      SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
      FROM hourly_intermediate_kpis_table
      WHERE USID = '${usid}'
      AND DATE_ID >= DATE '${startDate}'
      AND DATE_ID < (DATE '${endDate}' + INTERVAL '1 day')
      AND kpi_name IN ('${kpiList}')
    `;
  }

  /**
   * Get hourly cell KPIs for multiple USIDs (for site + neighbors)
   */
  static getHourlyCellKPIsForMultipleUSIDs(
    usids: string[],
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): string {
    const usidList = usids.join("', '");
    const kpiList = kpiNames.join("', '");
    const dialect = this.getDialect();

    if (dialect === 'mssql') {
      return `
        SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
        FROM hourly_intermediate_kpis_table WITH (NOLOCK)
        WHERE USID IN ('${usidList}')
        AND DATE_ID >= CAST('${startDate}' AS DATETIME)
        AND DATE_ID < DATEADD(day, 1, CAST('${endDate}' AS DATETIME))
        AND kpi_name IN ('${kpiList}')
      `;
    }

    return `
      SELECT USID, DATE_ID, HOUR_ID, cell_name, kpi_name, kpi_value
      FROM hourly_intermediate_kpis_table
      WHERE USID IN ('${usidList}')
      AND DATE_ID >= DATE '${startDate}'
      AND DATE_ID < (DATE '${endDate}' + INTERVAL '1 day')
      AND kpi_name IN ('${kpiList}')
    `;
  }

  /**
   * Get all distinct dates from subcomponent_table
   */
  static getAllDates(): string {
    return `
      SELECT DISTINCT(DATE_ID) 
      FROM subcomponent_table 
      ORDER BY DATE_ID DESC
    `;
  }

  /**
   * Get USIDs that are Super KPI offenders (have chain_of_thought) for a specific date,
   * sorted by Total_Impact_to_SuperKPI_Delta (Total_Impact_Mkt_CQX_Delta in source table)
   */
  static getOffenderUSIDs(dateId: string): string {
    const dialect = this.getDialect();
    if (dialect === 'mssql') {
      return `
        SELECT TOP 50 s.USID, sc.subcomponent_value as Total_Impact_to_SuperKPI_Delta
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

    return `
      SELECT s.USID, sc.subcomponent_value as Total_Impact_to_SuperKPI_Delta
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
      LIMIT 50
    `;
  }

  /**
   * Get all distinct USIDs
   */
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
}
