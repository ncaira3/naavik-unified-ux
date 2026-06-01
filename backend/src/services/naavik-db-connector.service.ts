/**
 * Naavik Database Connector
 * Port of Python NaavikDBConnector to TypeScript
 * Connects to remote Naavik database via HTTP API
 *
 * Circuit-breaker: after CIRCUIT_OPEN_THRESHOLD consecutive failures the
 * connector stops attempting remote calls for CIRCUIT_OPEN_MS and throws
 * immediately, preventing tool pile-up when the remote is unreachable.
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

// ─── Circuit breaker constants ───────────────────────────────────────────────
// Each NaavikDBConnector instance manages its own circuit breaker so that a
// slow-query timeout on the 8-second connector doesn't block the 30-second
// connector (and vice-versa).
// Only genuine connection errors (ECONNREFUSED, EHOSTUNREACH, etc.) open the
// circuit — timeouts are query-specific and do NOT count.
const CIRCUIT_OPEN_THRESHOLD = 5;    // connection errors before opening
const CIRCUIT_OPEN_MS        = 30_000; // stay open for 30 s

// Shared "global unreachable" flag — set only when a connector has a true
// connection failure (not a timeout). Used by mirrorOrRemote to decide whether
// to skip the remote call entirely.
let _globalCbFailures  = 0;
let _globalCbOpenUntil = 0;

function globalCbRecord(connectionError: boolean): void {
  if (!connectionError) { _globalCbFailures = 0; _globalCbOpenUntil = 0; return; }
  _globalCbFailures++;
  _globalCbOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  if (_globalCbFailures >= CIRCUIT_OPEN_THRESHOLD) {
    logger.warn(`[remote-db] global circuit OPEN after ${_globalCbFailures} connection errors`);
  }
}

function globalCbIsOpen(): boolean {
  if (_globalCbFailures < CIRCUIT_OPEN_THRESHOLD) return false;
  if (Date.now() > _globalCbOpenUntil) {
    logger.info('[remote-db] global circuit cool-down expired — probing remote');
    _globalCbFailures = CIRCUIT_OPEN_THRESHOLD - 1;
    return false;
  }
  return true;
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class NaavikDBConnector {
  private client: AxiosInstance;
  private baseUrl: string;
  // private static readonly DEFAULT_REMOTE_DB_URL = 'http://3.132.55.183:9050/api/query';
  private static readonly DEFAULT_REMOTE_DB_URL = 'http://3.20.40.252:9876/api/query';

  // Per-instance circuit breaker (timeouts do NOT count — only connection errors).
  private cbFailures  = 0;
  private cbOpenUntil = 0;

  constructor(baseUrl?: string, timeoutOverrideMs?: number) {
    const envUrl = process.env.REMOTE_DB_URL;
    const requestedUrl = baseUrl || envUrl || NaavikDBConnector.DEFAULT_REMOTE_DB_URL;
    if (requestedUrl !== NaavikDBConnector.DEFAULT_REMOTE_DB_URL) {
      logger.warn(
        `Ignoring non-approved remote DB endpoint "${requestedUrl}". Using "${NaavikDBConnector.DEFAULT_REMOTE_DB_URL}" instead.`
      );
    }
    this.baseUrl = NaavikDBConnector.DEFAULT_REMOTE_DB_URL;

    // Interactive agent queries: 8 s (fast fail, circuit breaker kicks in).
    // Background mirror sync: 30 s (bulk data, needs more time).
    // Callers can pass an explicit override; otherwise read REMOTE_DB_TIMEOUT env.
    const timeoutMs = timeoutOverrideMs ?? parseInt(process.env.REMOTE_DB_TIMEOUT || '8000');

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });

    logger.info(`🔌 NaavikDBConnector  endpoint=${this.baseUrl}  timeout=${timeoutMs}ms`);
    logger.info('🧠 SQL query dialect: mssql (forced)');
  }

  /**
   * Returns true when this instance's circuit breaker is open.
   * Opened only by connection-level errors (not timeouts).
   */
  isUnreachable(): boolean {
    if (this.cbFailures < CIRCUIT_OPEN_THRESHOLD) return false;
    if (Date.now() > this.cbOpenUntil) {
      logger.info('[remote-db] instance circuit cool-down expired — probing');
      this.cbFailures = CIRCUIT_OPEN_THRESHOLD - 1;
      return false;
    }
    return true;
  }

  /**
   * Returns true when the global circuit is open due to repeated connection
   * errors across any connector. Use in mirrorOrRemote to skip remote when
   * the server is truly unreachable.
   */
  static isRemoteUnreachable(): boolean {
    return globalCbIsOpen();
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
    if (this.isUnreachable()) {
      throw new Error('Remote DB unreachable (circuit open — retry in a moment)');
    }

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

      // Success — reset both per-instance and global CBs.
      this.cbFailures  = 0;
      this.cbOpenUntil = 0;
      globalCbRecord(false);
      return result;
    } catch (error: any) {
      const ms = Date.now() - start;
      const status = error?.response?.status ? ` HTTP ${error.response.status}` : '';
      const detail = error?.response?.data
        ? `  ${JSON.stringify(error.response.data).slice(0, 200)}`
        : '';
      logger.error(`  ↳ FAILED · ${ms}ms${status} — ${error.message}${detail}`);

      // Only count genuine connection errors toward the circuit breaker.
      // Timeouts are query-specific (the server is alive, just slow) and
      // should NOT open the circuit — the next query might be fast.
      const isTimeout =
        error.code === 'ECONNABORTED' ||
        /timeout/i.test(error.message ?? '') ||
        error.message?.includes('ETIMEDOUT');
      const isConnectionError =
        !isTimeout && (
          error.code === 'ECONNREFUSED' ||
          error.code === 'EHOSTUNREACH' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ECONNRESET' ||
          (error?.response?.status >= 500)
        );

      if (isConnectionError) {
        this.cbFailures++;
        this.cbOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
        if (this.cbFailures >= CIRCUIT_OPEN_THRESHOLD) {
          logger.warn(`[remote-db] instance circuit OPEN after ${this.cbFailures} connection errors`);
        }
        globalCbRecord(true);
      } else if (isTimeout) {
        logger.warn(`[remote-db] query timed out after ${ms}ms — server reachable, not counting toward circuit breaker`);
      }

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
   * Get Super KPI offender USIDs for a specific date
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
