/**
 * Naavik Database Connector
 * Connects to the remote Naavik RAN database via HTTP API.
 * Mirrors naavik_compass/backend/database/naavik_db_connector.py
 *
 * The remote endpoint is a SQL Server (MSSQL) instance exposed via an
 * HTTP POST API at DEFAULT_REMOTE_DB_URL.  No local PostgreSQL is required.
 */
import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';
import { SQLQueries } from './queries.js';

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
  readonly baseUrl: string;

  // Sys Pool: http://3.132.55.183:9050/api/query
  // Dev Pool: http://3.20.40.252:9876/api/query
  static readonly REMOTE_DB_URL =
    process.env.REMOTE_DB_URL || 'http://3.20.40.252:9876/api/query';

  constructor() {
    this.baseUrl = NaavikDBConnector.REMOTE_DB_URL;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: parseInt(process.env.REMOTE_DB_TIMEOUT || '600000'),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------------------------------------------------------------------------
  // Core query execution
  // ---------------------------------------------------------------------------

  private static extractTable(query: string): string {
    const m = query.match(/\bFROM\s+(\w+)/i);
    return m ? m[1] : 'unknown';
  }

  /**
   * Execute an arbitrary SQL string against the approved remote endpoint.
   * Returns raw rows as plain objects.
   */
  async query(sql: string): Promise<any[]> {
    const table = NaavikDBConnector.extractTable(sql);
    const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 120);
    const start = Date.now();

    logger.info(`⬡ SQL  [${table}]  ${preview}${sql.length > 120 ? '…' : ''}`);

    try {
      const response = await this.client.post('', { query: sql, params: {} });
      const ms = Date.now() - start;
      const rows: any[] = response.data?.result || [];

      if (ms > 5000) {
        logger.warn(`  ↳ ${rows.length} rows · ${ms}ms  ⚠ slow`);
      } else {
        logger.info(`  ↳ ${rows.length} rows · ${ms}ms`);
      }

      return rows;
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

  // ---------------------------------------------------------------------------
  // KPI helpers
  // ---------------------------------------------------------------------------

  async fetchDailyKPIs(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): Promise<KPIDataPoint[]> {
    return this.query(SQLQueries.getDailyCellKPIsForDateRange(usid, startDate, endDate, kpiNames)) as Promise<KPIDataPoint[]>;
  }

  async fetchHourlyKPIs(
    usid: string,
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): Promise<KPIDataPoint[]> {
    return this.query(SQLQueries.getHourlyCellKPIsForDateRange(usid, startDate, endDate, kpiNames)) as Promise<KPIDataPoint[]>;
  }

  async fetchHourlyKPIsForMultipleUSIDs(
    usids: string[],
    startDate: string,
    endDate: string,
    kpiNames: string[]
  ): Promise<KPIDataPoint[]> {
    return this.query(SQLQueries.getHourlyCellKPIsForMultipleUSIDs(usids, startDate, endDate, kpiNames)) as Promise<KPIDataPoint[]>;
  }

  // ---------------------------------------------------------------------------
  // Site / USID helpers
  // ---------------------------------------------------------------------------

  async getAllDates(): Promise<string[]> {
    const rows = await this.query(SQLQueries.getAllDates());
    return rows.map((r: any) => r.DATE_ID);
  }

  async getAllUSIDs(dateId?: string): Promise<string[]> {
    const rows = await this.query(SQLQueries.getAllUSIDs(dateId));
    return rows.map((r: any) => r.USID);
  }

  async getOffenderUSIDs(dateId: string): Promise<{ USID: string; Total_Impact_to_SuperKPI_Delta: number }[]> {
    return this.query(SQLQueries.getOffenderUSIDs(dateId)) as any;
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT TOP 1 DATE_ID FROM subcomponent_table');
      logger.info('✅ Remote database connection successful');
      return true;
    } catch {
      logger.error('❌ Remote database connection failed');
      return false;
    }
  }
}

/** Singleton instance for use across the backend. */
export const db = new NaavikDBConnector();
