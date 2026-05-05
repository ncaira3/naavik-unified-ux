/**
 * Naavik Database Connector
 * Port of Python NaavikDBConnector to TypeScript
 * Connects to remote Naavik database via HTTP API
 */
import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';
import { SQLQueries } from './sql-queries.js';
import { pool } from '../config/database.js';

export interface KPIDataPoint {
  USID: string;
  DATE_ID: string;
  HOUR_ID?: number;
  cell_name: string;
  kpi_name: string;
  kpi_value: number | null;
}

export class NaavikDBConnector {
  private client: AxiosInstance;
  private baseUrl: string;
  // private static readonly DEFAULT_REMOTE_DB_URL = 'http://3.132.55.183:9050/api/query';
  private static readonly DEFAULT_REMOTE_DB_URL = 'http://3.20.40.252:9876/api/query';

  constructor(baseUrl?: string) {
    const envUrl = process.env.REMOTE_DB_URL;
    const requestedUrl = baseUrl || envUrl || NaavikDBConnector.DEFAULT_REMOTE_DB_URL;
    if (requestedUrl !== NaavikDBConnector.DEFAULT_REMOTE_DB_URL) {
      logger.warn(
        `Ignoring non-approved remote DB endpoint "${requestedUrl}". Using "${NaavikDBConnector.DEFAULT_REMOTE_DB_URL}" instead.`
      );
    }
    this.baseUrl = NaavikDBConnector.DEFAULT_REMOTE_DB_URL;
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: parseInt(process.env.REMOTE_DB_TIMEOUT || '600000'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info(`🔌 NaavikDBConnector using remote query endpoint: ${this.baseUrl}`);
    logger.info('🧠 SQL query dialect: mssql (forced)');
  }

  /**
   * Extract the primary table name from a SQL string for compact log labels
   */
  private static extractTable(query: string): string {
    const m = query.match(/\bFROM\s+(\w+)/i);
    return m ? m[1] : 'unknown';
  }

  /**
   * Execute raw SQL query via API and return results
   */
  private async executeQuery(query: string): Promise<any[]> {
    const table = NaavikDBConnector.extractTable(query);
    const preview = query.replace(/\s+/g, ' ').trim().slice(0, 120);
    const start = Date.now();

    logger.info(`⬡ SQL  [${table}]  ${preview}${query.length > 120 ? '…' : ''}`);

    try {
      const response = await this.client.post('', { query, params: {} });
      const ms = Date.now() - start;
      const result = response.data?.result || [];

      if (ms > 5000) {
        logger.warn(`  ↳ ${result.length} rows · ${ms}ms  ⚠ slow`);
      } else {
        logger.info(`  ↳ ${result.length} rows · ${ms}ms`);
      }

      return result;
    } catch (error: any) {
      const ms = Date.now() - start;
      const status = error?.response?.status ? ` HTTP ${error.response.status}` : '';
      const detail = error?.response?.data
        ? `  ${JSON.stringify(error.response.data).slice(0, 200)}`
        : '';
      logger.error(`  ↳ FAILED · ${ms}ms${status} — ${error.message}${detail}`);
      throw new Error(`Remote DB query failed: ${error.message}`);
    }
  }

  /**
   * Execute an arbitrary SQL query against the approved remote endpoint.
   */
  async query(query: string): Promise<any[]> {
    return this.executeQuery(query);
  }

  /**
   * Fetch daily KPI data for a USID — mirror-first, remote fallback.
   * The local mirror only contains offender USIDs; for non-offenders we
   * silently fall back to the remote query (no caller-side change needed).
   */
  async fetchDailyKPIs(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): Promise<KPIDataPoint[]> {
    try {
      const localResult = await pool.query(
        `SELECT usid AS "USID",
                to_char(date_id, 'YYYY-MM-DD"T"HH24:MI:SS') AS "DATE_ID",
                cell_name, kpi_name, kpi_value
         FROM mirror.intermediate_kpi_table
         WHERE usid = $1
           AND date_id >= $2::date
           AND date_id <= ($3::date + INTERVAL '1 day')
           AND kpi_name = ANY($4::text[])`,
        [usid, startDate, endDate, kpiNames],
      );
      if (localResult.rows.length > 0) {
        return localResult.rows as KPIDataPoint[];
      }
    } catch (err) {
      logger.warn(`[mirror] fetchDailyKPIs local query failed, falling back to remote: ${(err as Error).message}`);
    }
    const query = SQLQueries.getDailyCellKPIsForDateRange(usid, startDate, endDate, kpiNames);
    const result = await this.executeQuery(query);
    return result as KPIDataPoint[];
  }

  /**
   * Fetch hourly KPI data for a USID — mirror-first, remote fallback.
   */
  async fetchHourlyKPIs(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): Promise<KPIDataPoint[]> {
    try {
      const localResult = await pool.query(
        `SELECT usid AS "USID",
                to_char(date_id, 'YYYY-MM-DD"T"HH24:MI:SS') AS "DATE_ID",
                hour_id AS "HOUR_ID",
                cell_name, kpi_name, kpi_value
         FROM mirror.hourly_intermediate_kpis_table
         WHERE usid = $1
           AND date_id >= $2::date
           AND date_id < ($3::date + INTERVAL '1 day')
           AND kpi_name = ANY($4::text[])`,
        [usid, startDate, endDate, kpiNames],
      );
      if (localResult.rows.length > 0) {
        return localResult.rows as KPIDataPoint[];
      }
    } catch (err) {
      logger.warn(`[mirror] fetchHourlyKPIs local query failed, falling back to remote: ${(err as Error).message}`);
    }
    const query = SQLQueries.getHourlyCellKPIsForDateRange(usid, startDate, endDate, kpiNames);
    const result = await this.executeQuery(query);
    return result as KPIDataPoint[];
  }

  /**
   * Fetch hourly KPI data for multiple USIDs (site + neighbors)
   */
  async fetchHourlyKPIsForMultipleUSIDs(
    usids: string[],
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): Promise<KPIDataPoint[]> {
    const query = SQLQueries.getHourlyCellKPIsForMultipleUSIDs(usids, startDate, endDate, kpiNames);
    const result = await this.executeQuery(query);
    return result as KPIDataPoint[];
  }

  /**
   * Get Super KPI offender USIDs for a specific date (sites with chain_of_thought, sorted by impact)
   */
  async getOffenderUSIDs(dateId: string): Promise<{ USID: string; Total_Impact_to_SuperKPI_Delta: number }[]> {
    const query = SQLQueries.getOffenderUSIDs(dateId);
    const result = await this.executeQuery(query);
    return result as { USID: string; Total_Impact_to_SuperKPI_Delta: number }[];
  }

  /**
   * Get all available dates from the remote database
   */
  async getAllDates(): Promise<string[]> {
    const query = SQLQueries.getAllDates();
    const result = await this.executeQuery(query);
    return result.map((row: any) => row.DATE_ID);
  }

  /**
   * Test connection to remote database
   */
  async testConnection(): Promise<boolean> {
    try {
      const query = 'SELECT TOP 1 DATE_ID FROM subcomponent_table';
      await this.executeQuery(query);
      logger.info('✅ Remote database connection successful');
      return true;
    } catch (error) {
      logger.error('❌ Remote database connection failed:', error);
      return false;
    }
  }
}
