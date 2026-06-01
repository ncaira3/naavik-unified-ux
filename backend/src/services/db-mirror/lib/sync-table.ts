/**
 * Sync one mirror table for one (date, offender USIDs) tuple.
 *
 * Strategy: delete-then-insert in a transaction. We don't try to figure out
 * each table's natural key — for the offender slice on a given day, deleting
 * the matching rows and re-inserting is fully idempotent and predictable.
 */
import { NaavikDBConnector } from '../../naavik-db-connector.service.js';
import { pool } from '../../../config/database.js';
import { logger } from '../../../utils/logger.js';
import type { MirrorTableSpec } from '../mirror-tables.js';
import { MIRROR_SCHEMA } from '../mirror-tables.js';
import { quoteIdent } from './schema-discovery.js';
import type { MappedColumn, SyncResult } from './types.js';

// Mirror sync needs more time than interactive agent queries — use 30 s.
const remoteDb = new NaavikDBConnector(undefined, 30_000);
const REMOTE_INSERT_BATCH = 500;

/** Concurrent remote chunks per heavy table. Keeps remote DB load reasonable. */
const REMOTE_CHUNK_CONCURRENCY = 3;

/** Build a comma-separated, single-quoted, sanitised SQL list for IN (...). */
function sqlList(values: string[]): string {
  return values.map((v) => `'${String(v).replace(/'/g, "''").slice(0, 64)}'`).join(',');
}

/** Chunk an array into pieces of size `n`. */
function chunk<T>(arr: T[], n: number): T[][] {
  if (n <= 0 || arr.length <= n) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Convert a remote row to the array of values aligned with `columns`. */
function toRowValues(row: Record<string, unknown>, columns: MappedColumn[]): unknown[] {
  return columns.map((c) => {
    const v = row[c.remoteName];
    if (v === undefined || v === null) return null;
    // Postgres rejects 'NaN' for numeric columns
    if (typeof v === 'number' && Number.isNaN(v)) return null;
    return v;
  });
}

export async function syncTableForDate(
  spec: MirrorTableSpec,
  dateId: string,
  offenderUsids: string[],
  columns: MappedColumn[],
): Promise<SyncResult> {
  const started = Date.now();
  const tableId = `${MIRROR_SCHEMA}.${quoteIdent(spec.remoteTable)}`;
  const filterCol = spec.filterColumn.replace(/[^A-Za-z0-9_]/g, '');
  const dateCol = spec.dateColumn.replace(/[^A-Za-z0-9_]/g, '');
  const safeDate = dateId.replace(/[^0-9-]/g, '').slice(0, 10);

  if (!offenderUsids.length) {
    return { tableName: spec.remoteTable, dateId: safeDate, rowsInserted: 0, rowsDeleted: 0, durationMs: Date.now() - started };
  }

  // Compute the next-day boundary so we can use a SARGable range predicate.
  // CAST(DATE_ID AS DATE) = '...' would force a full table scan on the remote;
  // a range comparison against the raw DATETIME column preserves any index.
  const nextDate = (() => {
    const d = new Date(safeDate);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  // 1. Pull rows from remote — split USIDs into chunks for high-cardinality tables.
  const chunkSize = spec.chunkSize && spec.chunkSize > 0 ? spec.chunkSize : offenderUsids.length;
  const usidChunks = chunk(offenderUsids, chunkSize);
  let remoteRows: Record<string, unknown>[] = [];
  const chunkErrors: string[] = [];

  try {
    // Run chunks in parallel batches of REMOTE_CHUNK_CONCURRENCY.
    for (let i = 0; i < usidChunks.length; i += REMOTE_CHUNK_CONCURRENCY) {
      const batch = usidChunks.slice(i, i + REMOTE_CHUNK_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (group) => {
          // SARGable: DATE_ID >= 'D' AND DATE_ID < 'D+1' lets MSSQL use any
          // index on DATE_ID instead of scanning the whole table.
          const sql = `
            SELECT * FROM ${spec.remoteTable} WITH (NOLOCK)
            WHERE ${filterCol} IN (${sqlList(group)})
              AND ${dateCol} >= '${safeDate}'
              AND ${dateCol} < '${nextDate}'`;
          try {
            return (await remoteDb.query(sql)) as Record<string, unknown>[];
          } catch (err) {
            chunkErrors.push((err as Error).message);
            return [] as Record<string, unknown>[];
          }
        }),
      );
      // Avoid `.push(...r)` — the spread blows the V8 argument-count limit
      // (~120k args) when r is a large hourly-KPI chunk.
      for (const r of batchResults) {
        for (const row of r) remoteRows.push(row);
      }
    }
  } catch (err) {
    return {
      tableName: spec.remoteTable,
      dateId: safeDate,
      rowsInserted: 0,
      rowsDeleted: 0,
      durationMs: Date.now() - started,
      error: `remote fetch failed: ${(err as Error).message}`,
    };
  }

  // If every chunk failed, surface that as an error and skip the local write.
  if (chunkErrors.length === usidChunks.length) {
    return {
      tableName: spec.remoteTable,
      dateId: safeDate,
      rowsInserted: 0,
      rowsDeleted: 0,
      durationMs: Date.now() - started,
      error: `all ${usidChunks.length} chunks failed: ${chunkErrors[0]}`,
    };
  }

  // 2. Local transaction: delete existing slice + bulk insert fresh
  const localFilterCol = filterCol.toLowerCase();
  const localDateCol = dateCol.toLowerCase();
  const client = await pool.connect();
  let rowsDeleted = 0;
  let rowsInserted = 0;
  try {
    await client.query('BEGIN');

    const delResult = await client.query(
      `DELETE FROM ${tableId}
       WHERE ${quoteIdent(localFilterCol)} = ANY($1::text[])
         AND CAST(${quoteIdent(localDateCol)} AS DATE) = CAST($2 AS DATE)`,
      [offenderUsids, safeDate],
    );
    rowsDeleted = delResult.rowCount ?? 0;

    if (remoteRows.length) {
      const colNames = columns.map((c) => quoteIdent(c.localName)).join(', ');
      for (let i = 0; i < remoteRows.length; i += REMOTE_INSERT_BATCH) {
        const batch = remoteRows.slice(i, i + REMOTE_INSERT_BATCH);
        const values: unknown[] = [];
        const tuples: string[] = [];
        let p = 1;
        for (const row of batch) {
          const tupleParams: string[] = [];
          for (const _col of columns) {
            tupleParams.push(`$${p++}`);
          }
          tuples.push(`(${tupleParams.join(',')})`);
          values.push(...toRowValues(row, columns));
        }
        const ins = await client.query(
          `INSERT INTO ${tableId} (${colNames}) VALUES ${tuples.join(',')}`,
          values,
        );
        rowsInserted += ins.rowCount ?? 0;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return {
      tableName: spec.remoteTable,
      dateId: safeDate,
      rowsInserted: 0,
      rowsDeleted,
      durationMs: Date.now() - started,
      error: `local write failed: ${(err as Error).message}`,
    };
  } finally {
    client.release();
  }

  const result: SyncResult = {
    tableName: spec.remoteTable,
    dateId: safeDate,
    rowsInserted,
    rowsDeleted,
    durationMs: Date.now() - started,
    // If SOME chunks failed, the row counts above reflect only the successful ones.
    // Surface the partial failure so it shows up in run_log without aborting the day.
    ...(chunkErrors.length
      ? { error: `${chunkErrors.length}/${usidChunks.length} chunks failed: ${chunkErrors[0]}` }
      : {}),
  };
  logger.debug(
    `[mirror] ${spec.remoteTable} ${safeDate}: -${rowsDeleted} +${rowsInserted} in ${result.durationMs}ms`,
  );
  return result;
}

/** Retention sweep — delete rows older than `keepDays` from one table. */
export async function pruneRetention(
  spec: MirrorTableSpec,
  keepDays: number,
): Promise<number> {
  const tableId = `${MIRROR_SCHEMA}.${quoteIdent(spec.remoteTable)}`;
  const localDateCol = spec.dateColumn.replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
  const result = await pool.query(
    `DELETE FROM ${tableId}
     WHERE CAST(${quoteIdent(localDateCol)} AS DATE) < (CURRENT_DATE - $1::int * INTERVAL '1 day')`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
