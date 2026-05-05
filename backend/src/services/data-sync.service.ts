/**
 * DataSyncService — pulls site topology and cell sectors from remote MSSQL
 * and stores them in local PostgreSQL for fast map loads.
 *
 * The CompassModel reads local cache first; this service keeps it warm.
 * Schedules: topology every 6h, sectors every 12h.
 */
import { pool } from '../config/database.js';
import { NaavikDBConnector } from './naavik-db-connector.service.js';
import { logger } from '../utils/logger.js';

const remoteDb = new NaavikDBConnector();

interface JobStatus {
  lastSync: Date | null;
  rowCount: number;
  running: boolean;
  lastError: string | null;
}

interface SyncStatus {
  sites: JobStatus;
  sectors: JobStatus;
}

function pickStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null) return String(row[k]);
    const lower = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lower && row[rk] != null) return String(row[rk]);
    }
  }
  return '';
}

function pickNum(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (row[k] != null) { const v = Number(row[k]); if (Number.isFinite(v)) return v; }
    const lower = k.toLowerCase();
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase() === lower && row[rk] != null) { const v = Number(row[rk]); if (Number.isFinite(v)) return v; }
    }
  }
  return null;
}

class DataSyncService {
  private status: SyncStatus = {
    sites: { lastSync: null, rowCount: 0, running: false, lastError: null },
    sectors: { lastSync: null, rowCount: 0, running: false, lastError: null },
  };
  private siteTimer: ReturnType<typeof setInterval> | null = null;
  private sectorTimer: ReturnType<typeof setInterval> | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.ensureTables();
    const [sitesPopulated, sectorsPopulated] = await Promise.all([
      this.isCachePopulated('topology_cache_sites'),
      this.isCachePopulated('topology_cache_sectors'),
    ]);
    if (!sitesPopulated) {
      logger.info('DataSync: local site cache empty — starting initial sync in background');
      void this.syncSiteTopology();
    } else {
      const s = this.status.sites;
      const r = await pool.query('SELECT COUNT(*) FROM topology_cache_sites');
      s.rowCount = parseInt(r.rows[0].count) || 0;
      logger.info(`DataSync: local site cache has ${s.rowCount} sites`);
    }
    if (!sectorsPopulated) {
      logger.info('DataSync: local sector cache empty — starting initial sync in background');
      void this.syncCellSectors();
    } else {
      const r = await pool.query('SELECT COUNT(*) FROM topology_cache_sectors');
      this.status.sectors.rowCount = parseInt(r.rows[0].count) || 0;
      logger.info(`DataSync: local sector cache has ${this.status.sectors.rowCount} sectors`);
    }
  }

  start(): void {
    // Refresh topology every 6 hours, sectors every 12 hours
    this.siteTimer = setInterval(() => void this.syncSiteTopology(), 6 * 60 * 60 * 1000);
    this.sectorTimer = setInterval(() => void this.syncCellSectors(), 12 * 60 * 60 * 1000);
    logger.info('DataSync: periodic sync scheduled (sites=6h, sectors=12h)');
  }

  stop(): void {
    if (this.siteTimer) clearInterval(this.siteTimer);
    if (this.sectorTimer) clearInterval(this.sectorTimer);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  // ── Site Topology Sync ───────────────────────────────────────────────────

  async syncSiteTopology(): Promise<{ rowCount: number }> {
    if (this.status.sites.running) {
      logger.warn('DataSync: site topology sync already in progress — skipping');
      return { rowCount: 0 };
    }
    this.status.sites.running = true;
    this.status.sites.lastError = null;
    const started = Date.now();

    try {
      logger.info('DataSync: fetching site topology from remote MSSQL…');

      // Try with CLUSTER_ID + MARKET first; fall back if columns are missing
      let rows: Record<string, unknown>[] = [];
      try {
        rows = await remoteDb.query(`
          SELECT
            CAST(USID AS VARCHAR(64)) AS USID,
            ISNULL(site_name, CAST(USID AS VARCHAR(64))) AS site_name,
            CAST(latitude AS FLOAT) AS latitude,
            CAST(longitude AS FLOAT) AS longitude,
            CASE WHEN chain_of_thought IS NOT NULL THEN 1 ELSE 0 END AS is_offender,
            CAST(ISNULL(CLUSTER_ID, '') AS VARCHAR(128)) AS cluster_id,
            CAST(ISNULL(MARKET, '') AS VARCHAR(64)) AS market,
            CAST(CAST(DATE_ID AS DATE) AS VARCHAR(10)) AS date_id
          FROM site_table WITH (NOLOCK)
          WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table WITH (NOLOCK))
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND TRY_CAST(latitude AS FLOAT) IS NOT NULL
            AND TRY_CAST(longitude AS FLOAT) IS NOT NULL
        `);
      } catch {
        rows = await remoteDb.query(`
          SELECT
            CAST(USID AS VARCHAR(64)) AS USID,
            ISNULL(site_name, CAST(USID AS VARCHAR(64))) AS site_name,
            CAST(latitude AS FLOAT) AS latitude,
            CAST(longitude AS FLOAT) AS longitude,
            CASE WHEN chain_of_thought IS NOT NULL THEN 1 ELSE 0 END AS is_offender,
            '' AS cluster_id,
            '' AS market,
            CAST(CAST(DATE_ID AS DATE) AS VARCHAR(10)) AS date_id
          FROM site_table WITH (NOLOCK)
          WHERE CAST(DATE_ID AS DATE) = (SELECT MAX(CAST(DATE_ID AS DATE)) FROM site_table WITH (NOLOCK))
            AND latitude IS NOT NULL AND longitude IS NOT NULL
        `);
      }

      if (!rows.length) {
        logger.warn('DataSync: site topology query returned 0 rows — keeping existing cache');
        this.status.sites.running = false;
        return { rowCount: 0 };
      }

      logger.info(`DataSync: received ${rows.length} sites — writing to local cache…`);
      await this.writeTopologySites(rows);

      const elapsed = Math.round((Date.now() - started) / 1000);
      this.status.sites = { lastSync: new Date(), rowCount: rows.length, running: false, lastError: null };
      logger.info(`DataSync: site topology synced — ${rows.length} sites in ${elapsed}s`);
      return { rowCount: rows.length };
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.status.sites = { ...this.status.sites, running: false, lastError: msg };
      logger.error(`DataSync: site topology sync FAILED — ${msg}`);
      // Do NOT re-throw: background void task
    }
    return { rowCount: 0 };
  }

  // ── Cell Sectors Sync ────────────────────────────────────────────────────

  async syncCellSectors(): Promise<{ rowCount: number }> {
    if (this.status.sectors.running) {
      logger.warn('DataSync: cell sectors sync already in progress — skipping');
      return { rowCount: 0 };
    }
    this.status.sectors.running = true;
    this.status.sectors.lastError = null;
    const started = Date.now();

    try {
      logger.info('DataSync: fetching cell sectors from remote MSSQL…');

      const dateRows = await remoteDb.query(`
        SELECT CAST(MAX(CAST(DATE_ID AS DATE)) AS VARCHAR(10)) AS max_date
        FROM cell_table WITH (NOLOCK)
      `);
      const latestDate = String(dateRows[0]?.max_date || '').slice(0, 10);
      if (!latestDate || !/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) {
        logger.warn('DataSync: could not determine latest cell_table date');
        this.status.sectors.running = false;
        return { rowCount: 0 };
      }

      logger.info(`DataSync: fetching sectors for date ${latestDate}…`);

      let rows: Record<string, unknown>[] = [];
      try {
        rows = await remoteDb.query(`
          SELECT
            CAST(c.USID AS VARCHAR(64)) AS USID,
            CAST(c.USEID AS VARCHAR(128)) AS USEID,
            c.cell_name,
            CASE WHEN c.AZIMUTH IS NULL OR CAST(c.AZIMUTH AS FLOAT) = 0 THEN 1.0
                 ELSE CAST(c.AZIMUTH AS FLOAT) END AS azimuth,
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
            AND CAST(st.DATE_ID AS DATE) = '${latestDate}'
          LEFT JOIN sector_table sec WITH (NOLOCK)
            ON CAST(sec.USEID AS VARCHAR(128)) = CAST(c.USEID AS VARCHAR(128))
            AND CAST(sec.DATE_ID AS DATE) = '${latestDate}'
          LEFT JOIN (
            SELECT USID,
                   MAX(CAST(anomaly_flag AS INT)) AS anomaly_flag,
                   MAX(CAST(anomaly_score AS FLOAT)) AS anomaly_score
            FROM sector_table WITH (NOLOCK)
            WHERE CAST(DATE_ID AS DATE) = '${latestDate}'
            GROUP BY USID
          ) st_sec ON CAST(st_sec.USID AS VARCHAR(64)) = CAST(c.USID AS VARCHAR(64))
          WHERE CAST(c.DATE_ID AS DATE) = '${latestDate}'
            AND (
              (CAST(st.latitude AS FLOAT) IS NOT NULL AND CAST(st.longitude AS FLOAT) IS NOT NULL)
              OR (CAST(c.LATITUDE AS FLOAT) IS NOT NULL AND CAST(c.LONGITUDE AS FLOAT) IS NOT NULL)
            )
        `);
      } catch (richErr: any) {
        logger.warn(`DataSync: rich sector query failed (${richErr?.message}), trying basic…`);
        rows = await remoteDb.query(`
          SELECT
            CAST(c.USID AS VARCHAR(64)) AS USID,
            CAST(c.USEID AS VARCHAR(128)) AS USEID,
            c.cell_name,
            CASE WHEN c.AZIMUTH IS NULL OR CAST(c.AZIMUTH AS FLOAT) = 0 THEN 1.0
                 ELSE CAST(c.AZIMUTH AS FLOAT) END AS azimuth,
            CAST(c.LATITUDE AS FLOAT) AS site_latitude,
            CAST(c.LONGITUDE AS FLOAT) AS site_longitude,
            CAST(c.LATITUDE AS FLOAT) AS cell_latitude,
            CAST(c.LONGITUDE AS FLOAT) AS cell_longitude,
            c.TECH, c.CARRIER, c.HEIGHT,
            0 AS cell_anomaly_flag, 0.0 AS cell_anomaly_score,
            0 AS site_anomaly_flag, 0.0 AS site_anomaly_score
          FROM cell_table c WITH (NOLOCK)
          WHERE CAST(c.DATE_ID AS DATE) = '${latestDate}'
            AND c.LATITUDE IS NOT NULL AND c.LONGITUDE IS NOT NULL
        `);
      }

      if (!rows.length) {
        logger.warn('DataSync: cell sectors query returned 0 rows — keeping existing cache');
        this.status.sectors.running = false;
        return { rowCount: 0 };
      }

      // Deduplicate by USEID — cell_table can have multiple rows per sector
      const seenUseid = new Set<string>();
      const dedupedRows: Record<string, unknown>[] = [];
      for (const row of rows) {
        const useid = String((row as any).USEID || (row as any).useid || '').trim();
        if (useid && !seenUseid.has(useid)) {
          seenUseid.add(useid);
          dedupedRows.push(row);
        }
      }
      logger.info(`DataSync: received ${rows.length} sectors (${dedupedRows.length} unique by USEID) — writing to local cache…`);
      await this.writeSectorCache(dedupedRows, latestDate);

      const elapsed = Math.round((Date.now() - started) / 1000);
      this.status.sectors = { lastSync: new Date(), rowCount: dedupedRows.length, running: false, lastError: null };
      logger.info(`DataSync: cell sectors synced — ${dedupedRows.length} sectors in ${elapsed}s`);
      return { rowCount: dedupedRows.length };
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.status.sectors = { ...this.status.sectors, running: false, lastError: msg };
      logger.error(`DataSync: cell sectors sync FAILED — ${msg}`);
      // Do NOT re-throw: this runs as a background void task; uncaught rejection would crash the process
    }
    return { rowCount: 0 };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private async writeTopologySites(rows: Record<string, unknown>[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE topology_cache_sites');

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const values: unknown[] = [];
        const tuples: string[] = [];
        let p = 1;
        for (const row of batch) {
          tuples.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
          values.push(
            pickStr(row, 'USID', 'usid'),
            pickStr(row, 'site_name', 'SITE_NAME'),
            pickNum(row, 'latitude', 'LATITUDE'),
            pickNum(row, 'longitude', 'LONGITUDE'),
            Boolean(Number(pickStr(row, 'is_offender'))),
            pickStr(row, 'cluster_id', 'CLUSTER_ID') || null,
            pickStr(row, 'market', 'MARKET') || null,
            pickStr(row, 'date_id', 'DATE_ID').slice(0, 10) || null,
          );
        }
        await client.query(
          `INSERT INTO topology_cache_sites (usid, site_name, latitude, longitude, is_offender, cluster_id, market, date_id)
           VALUES ${tuples.join(',')}`,
          values
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async writeSectorCache(rows: Record<string, unknown>[], dateId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE topology_cache_sectors');

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const values: unknown[] = [];
        const tuples: string[] = [];
        let p = 1;
        for (const row of batch) {
          tuples.push(
            `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
          );
          values.push(
            pickStr(row, 'USEID', 'useid'),
            pickStr(row, 'USID', 'usid'),
            pickStr(row, 'cell_name'),
            pickNum(row, 'azimuth'),
            pickNum(row, 'site_latitude'),
            pickNum(row, 'site_longitude'),
            pickNum(row, 'cell_latitude'),
            pickNum(row, 'cell_longitude'),
            pickStr(row, 'TECH', 'tech'),
            pickStr(row, 'CARRIER', 'carrier'),
            pickNum(row, 'HEIGHT', 'height'),
            Number(pickStr(row, 'cell_anomaly_flag')) || 0,
            Number(pickStr(row, 'cell_anomaly_score')) || 0,
            Number(pickStr(row, 'site_anomaly_flag')) || 0,
            Number(pickStr(row, 'site_anomaly_score')) || 0,
            dateId,
          );
        }
        await client.query(
          `INSERT INTO topology_cache_sectors
             (useid, usid, cell_name, azimuth, site_latitude, site_longitude,
              cell_latitude, cell_longitude, tech, carrier, height,
              cell_anomaly_flag, cell_anomaly_score, site_anomaly_flag, site_anomaly_score, date_id)
           VALUES ${tuples.join(',')}`,
          values
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async ensureTables(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS topology_cache_sites (
        usid          TEXT PRIMARY KEY,
        site_name     TEXT,
        latitude      DOUBLE PRECISION,
        longitude     DOUBLE PRECISION,
        is_offender   BOOLEAN DEFAULT false,
        cluster_id    TEXT,
        market        TEXT,
        date_id       TEXT,
        synced_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    // Backfill the column on pre-existing tables (safe no-op if it already exists).
    await pool.query(`ALTER TABLE topology_cache_sites ADD COLUMN IF NOT EXISTS market TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS topology_cache_sectors (
        useid               TEXT PRIMARY KEY,
        usid                TEXT,
        cell_name           TEXT,
        azimuth             DOUBLE PRECISION,
        site_latitude       DOUBLE PRECISION,
        site_longitude      DOUBLE PRECISION,
        cell_latitude       DOUBLE PRECISION,
        cell_longitude      DOUBLE PRECISION,
        tech                TEXT,
        carrier             TEXT,
        height              DOUBLE PRECISION,
        cell_anomaly_flag   INT DEFAULT 0,
        cell_anomaly_score  DOUBLE PRECISION DEFAULT 0,
        site_anomaly_flag   INT DEFAULT 0,
        site_anomaly_score  DOUBLE PRECISION DEFAULT 0,
        date_id             TEXT,
        synced_at           TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tcs_usid  ON topology_cache_sites (usid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tcsc_usid ON topology_cache_sectors (usid)`);
  }

  private async isCachePopulated(table: string): Promise<boolean> {
    try {
      const r = await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
      return r.rows.length > 0;
    } catch {
      return false;
    }
  }
}

export const dataSyncService = new DataSyncService();
