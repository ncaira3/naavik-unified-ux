/**
 * Chunked remote -> local Postgres replication for demo datasets.
 *
 * Pulls data from the approved remote SQL API and writes into
 * local Postgres schema: remote_replica.<table>.
 *
 * Usage:
 *   cd backend
 *   npx tsx src/scripts/replicate-remote-to-local.ts
 */
import dotenv from 'dotenv';
import axios, { AxiosInstance } from 'axios';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

dotenv.config();

type TableName =
  | 'site_table'
  | 'cell_table'
  | 'intermediate_kpi_table'
  | 'hourly_intermediate_kpis_table'
  | 'cqx_offenders_truth_table'
  | 'configuration_parameters_table'
  | 'eim_table'
  | 'neighbors_table_date_id'
  | 'outage_table'
  | 'sector_table'
  | 'subcomponent_table'
  | 'ticket_table'
  | 'alarm_table';

const REMOTE_DB_URL = 'http://3.20.40.252:9876/api/query';
const START_DATE = process.env.REPL_START_DATE || '2026-01-01';
const END_DATE = process.env.REPL_END_DATE || '2026-02-01';
const TARGET_SCHEMA = process.env.REPL_TARGET_SCHEMA || 'remote_replica';

const TABLES: TableName[] = [
  'site_table',
  'cell_table',
  'intermediate_kpi_table',
  'hourly_intermediate_kpis_table',
  'cqx_offenders_truth_table',
  'configuration_parameters_table',
  'eim_table',
  'neighbors_table_date_id',
  'outage_table',
  'sector_table',
  'subcomponent_table',
  'ticket_table',
  'alarm_table',
];

const TABLE_TUNING: Record<TableName, { siteChunk: number; dateChunkDays: number }> = {
  site_table: { siteChunk: 200, dateChunkDays: 3 },
  cell_table: { siteChunk: 200, dateChunkDays: 3 },
  intermediate_kpi_table: { siteChunk: 60, dateChunkDays: 1 },
  hourly_intermediate_kpis_table: { siteChunk: 20, dateChunkDays: 1 },
  cqx_offenders_truth_table: { siteChunk: 200, dateChunkDays: 3 },
  configuration_parameters_table: { siteChunk: 0, dateChunkDays: 0 },
  eim_table: { siteChunk: 200, dateChunkDays: 3 },
  neighbors_table_date_id: { siteChunk: 120, dateChunkDays: 2 },
  outage_table: { siteChunk: 200, dateChunkDays: 3 },
  sector_table: { siteChunk: 200, dateChunkDays: 3 },
  subcomponent_table: { siteChunk: 120, dateChunkDays: 2 },
  ticket_table: { siteChunk: 200, dateChunkDays: 3 },
  alarm_table: { siteChunk: 200, dateChunkDays: 3 },
};

const SITE_COLUMN_CANDIDATES = [
  'USID',
  'site_id',
  'SITE_ID',
  'SiteID',
  'SOURCE_USID',
  'NEIGH_USID',
  'source_site_id',
  'neighbor_site_id',
  'SourceSiteID',
  'NeighborSiteID',
];

const DATE_COLUMN_CANDIDATES = ['DATE_ID', 'date_id', 'DateID'];

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isIsoDateString(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
}

function inferPgType(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (!nonNull.length) return 'TEXT';
  if (nonNull.every((v) => typeof v === 'boolean')) return 'BOOLEAN';
  if (nonNull.every((v) => typeof v === 'number' && Number.isInteger(v as number))) return 'BIGINT';
  if (nonNull.every((v) => typeof v === 'number')) return 'DOUBLE PRECISION';
  if (nonNull.every((v) => isIsoDateString(v))) return 'TIMESTAMP';
  return 'TEXT';
}

function findColumn(keys: string[], candidates: string[]): string | null {
  const lowered = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const candidate of candidates) {
    const hit = lowered.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function normalizeSiteToken(site: string): string {
  const trimmed = site.trim();
  const m = trimmed.match(/^UST0*(\d{4,8})$/i);
  if (m) return m[1];
  return trimmed;
}

class RemoteClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: REMOTE_DB_URL,
      timeout: Number(process.env.REMOTE_DB_TIMEOUT || 600000),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async query(sql: string): Promise<Record<string, unknown>[]> {
    const response = await this.client.post('', { query: sql, params: {} });
    return response.data?.result || [];
  }
}

async function getFilteredSites(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const candidates = [
      `SELECT DISTINCT COALESCE("SiteID", site_id::text)::text AS sid FROM filtered_sites`,
      `SELECT DISTINCT "SiteID"::text AS sid FROM filtered_sites`,
      `SELECT DISTINCT site_id::text AS sid FROM filtered_sites`,
    ];

    for (const sql of candidates) {
      try {
        const res = await client.query(sql);
        const sids = res.rows
          .map((r) => String((r as { sid: string }).sid || '').trim())
          .filter((x) => x.length > 0);
        if (sids.length) {
          return Array.from(new Set(sids)).map(normalizeSiteToken);
        }
      } catch {
        // keep trying next candidate
      }
    }
    throw new Error('Unable to read filtered site list from filtered_sites table');
  } finally {
    client.release();
  }
}

function buildDateWindows(startYmd: string, endYmd: string, stepDays: number): Array<{ start: string; end: string }> {
  if (stepDays <= 0) return [{ start: startYmd, end: endYmd }];
  const out: Array<{ start: string; end: string }> = [];
  let cursor = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  while (cursor <= end) {
    const windowStart = cursor;
    const next = addDays(cursor, stepDays - 1);
    const windowEnd = next <= end ? next : end;
    out.push({ start: formatYmd(windowStart), end: formatYmd(windowEnd) });
    cursor = addDays(windowEnd, 1);
  }
  return out;
}

function buildWhereClause(
  table: TableName,
  keys: string[],
  siteChunk: string[] | null,
  dateWindow: { start: string; end: string } | null
): string {
  const clauses: string[] = [];
  const dateCol = findColumn(keys, DATE_COLUMN_CANDIDATES);

  if (dateWindow && dateCol) {
    clauses.push(
      `${quoteIdent(dateCol)} >= CAST('${dateWindow.start}' AS DATETIME)`,
      `${quoteIdent(dateCol)} <= CAST('${dateWindow.end}' AS DATETIME)`
    );
  }

  if (siteChunk && siteChunk.length) {
    const inList = siteChunk.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
    if (table === 'neighbors_table_date_id') {
      const source = findColumn(keys, ['SOURCE_USID', 'source_site_id', 'SourceSiteID']);
      const neigh = findColumn(keys, ['NEIGH_USID', 'neighbor_site_id', 'NeighborSiteID']);
      if (source && neigh) {
        clauses.push(`(${quoteIdent(source)} IN (${inList}) OR ${quoteIdent(neigh)} IN (${inList}))`);
      } else if (source) {
        clauses.push(`${quoteIdent(source)} IN (${inList})`);
      } else if (neigh) {
        clauses.push(`${quoteIdent(neigh)} IN (${inList})`);
      }
    } else {
      const siteCol = findColumn(keys, SITE_COLUMN_CANDIDATES);
      if (siteCol) clauses.push(`${quoteIdent(siteCol)} IN (${inList})`);
    }
  }

  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

async function ensureSchema(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(TARGET_SCHEMA)}`);
}

async function ensureTable(
  table: TableName,
  sampleRows: Record<string, unknown>[]
): Promise<{ columns: string[] }> {
  if (!sampleRows.length) {
    return { columns: [] };
  }
  const cols = Array.from(
    sampleRows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>())
  );

  const colDefs = cols
    .map((c) => {
      const type = inferPgType(sampleRows.map((r) => r[c]));
      return `${quoteIdent(c)} ${type}`;
    })
    .join(', ');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(table)} (
      ${colDefs},
      "_loaded_at" TIMESTAMP DEFAULT NOW()
    )
  `);

  // Add new columns if schema evolved.
  const existing = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    `,
    [TARGET_SCHEMA, table]
  );
  const existingSet = new Set(existing.rows.map((r) => String(r.column_name)));
  for (const c of cols) {
    if (!existingSet.has(c)) {
      const type = inferPgType(sampleRows.map((r) => r[c]));
      await pool.query(
        `ALTER TABLE ${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(table)} ADD COLUMN ${quoteIdent(c)} ${type}`
      );
    }
  }
  return { columns: cols };
}

async function truncateTargetTable(table: TableName): Promise<void> {
  await pool.query(`TRUNCATE TABLE ${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(table)}`);
}

async function insertRows(table: TableName, rows: Record<string, unknown>[], columns: string[]): Promise<number> {
  if (!rows.length || !columns.length) return 0;
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const tuples: string[] = [];
    let p = 1;
    for (const row of batch) {
      const tupleParams: string[] = [];
      for (const col of columns) {
        tupleParams.push(`$${p++}`);
        values.push(row[col] ?? null);
      }
      tuples.push(`(${tupleParams.join(', ')})`);
    }
    const sql = `
      INSERT INTO ${quoteIdent(TARGET_SCHEMA)}.${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')})
      VALUES ${tuples.join(', ')}
    `;
    await pool.query(sql, values);
    inserted += batch.length;
  }
  return inserted;
}

async function replicateTable(remote: RemoteClient, table: TableName, normalizedSites: string[]): Promise<void> {
  const tune = TABLE_TUNING[table];
  const probe = await remote.query(`SELECT TOP 1 * FROM ${table} WITH (NOLOCK)`);
  if (!probe.length) {
    logger.warn(`[${table}] remote table returned no rows; skipping`);
    return;
  }
  const keys = Object.keys(probe[0]);
  const usesDate = Boolean(findColumn(keys, DATE_COLUMN_CANDIDATES)) && tune.dateChunkDays > 0;
  const siteCol = findColumn(keys, SITE_COLUMN_CANDIDATES);
  const usesSite = Boolean(siteCol || table === 'neighbors_table_date_id') && tune.siteChunk > 0;

  const siteChunks = usesSite ? chunk(normalizedSites, tune.siteChunk) : [null];
  const dateChunks = usesDate ? buildDateWindows(START_DATE, END_DATE, tune.dateChunkDays) : [null];
  const totalChunks = siteChunks.length * dateChunks.length;
  const started = Date.now();
  let processedChunks = 0;
  let totalRows = 0;
  let columns: string[] = [];
  const logEmptyDetails = String(process.env.REPL_LOG_EMPTY_CHUNK_DETAILS || '').toLowerCase() === 'true';

  logger.info(
    `[${table}] starting: ${totalChunks} chunks (siteChunks=${siteChunks.length}, dateChunks=${dateChunks.length})`
  );

  for (const dChunk of dateChunks) {
    for (const sChunk of siteChunks) {
      const where = buildWhereClause(table, keys, sChunk as string[] | null, dChunk);
      const sql = `SELECT * FROM ${table} WITH (NOLOCK) ${where}`;
      let rows: Record<string, unknown>[] = [];
      const siteSample =
        sChunk && (sChunk as string[]).length
          ? `${(sChunk as string[])[0]}..${(sChunk as string[])[(sChunk as string[]).length - 1]} (${(sChunk as string[]).length} sites)`
          : 'n/a';
      const dateSample = dChunk ? `${dChunk.start}..${dChunk.end}` : 'n/a';
      try {
        rows = await remote.query(sql);
      } catch (error) {
        logger.error(`[${table}] chunk failed, skipping`, error);
      }

      if (!columns.length && rows.length) {
        const tableMeta = await ensureTable(table, rows.slice(0, 200));
        columns = tableMeta.columns;
        await truncateTargetTable(table);
      } else if (!columns.length) {
        const tableMeta = await ensureTable(table, probe);
        columns = tableMeta.columns;
        await truncateTargetTable(table);
      }

      if (rows.length) {
        await insertRows(table, rows, columns);
        totalRows += rows.length;
      }

      processedChunks += 1;
      const elapsedSec = (Date.now() - started) / 1000;
      const rate = processedChunks > 0 ? elapsedSec / processedChunks : 0;
      const etaSec = Math.max(0, Math.round((totalChunks - processedChunks) * rate));
      if (rows.length === 0 && logEmptyDetails) {
        logger.info(
          `[${table}] ${processedChunks}/${totalChunks} chunks | rows=0 | total=${totalRows} | date=${dateSample} | sites=${siteSample} | ETA=${etaSec}s`
        );
      } else {
        logger.info(
          `[${table}] ${processedChunks}/${totalChunks} chunks | rows=${rows.length} | total=${totalRows} | ETA=${etaSec}s`
        );
      }
    }
  }

  logger.info(`[${table}] completed: ${totalRows} rows replicated`);
}

async function main(): Promise<void> {
  const started = Date.now();
  logger.info('='.repeat(90));
  logger.info('REMOTE -> LOCAL REPLICATION STARTED');
  logger.info(`Remote API: ${REMOTE_DB_URL}`);
  logger.info(`Target schema: ${TARGET_SCHEMA}`);
  logger.info(`Date window: ${START_DATE} to ${END_DATE}`);
  logger.info(`Tables: ${TABLES.join(', ')}`);
  logger.info('='.repeat(90));

  await ensureSchema();

  const sites = await getFilteredSites();
  logger.info(`Using ${sites.length} filtered sites from local DB`);

  const remote = new RemoteClient();

  for (const table of TABLES) {
    try {
      await replicateTable(remote, table, sites);
    } catch (error) {
      logger.error(`[${table}] replication failed`, error);
    }
  }

  const totalSec = Math.round((Date.now() - started) / 1000);
  logger.info('='.repeat(90));
  logger.info(`REPLICATION FINISHED in ${totalSec}s`);
  logger.info(`Data loaded into ${TARGET_SCHEMA}.*`);
  logger.info('='.repeat(90));
  await pool.end();
}

main().catch(async (error) => {
  logger.error('Replication script failed', error);
  await pool.end();
  process.exit(1);
});
