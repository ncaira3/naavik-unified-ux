/**
 * mirrorOrRemote — read-side router.
 *
 * Try the local Postgres mirror first; if it returns 0 rows (or errors),
 * transparently fall back to the remote MSSQL. This keeps non-offender USIDs
 * (which the mirror doesn't store) working unchanged.
 *
 * Usage:
 *   const rows = await mirrorOrRemote<RowShape>({
 *     local:  { sql: 'SELECT ... FROM mirror.cell_table WHERE usid = $1 AND date_id::date = $2::date', params: [usid, dateId] },
 *     remote: `SELECT ... FROM cell_table WITH (NOLOCK) WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)`,
 *   });
 *
 * Postgres column-case tip: alias columns to preserve mixed case the consuming
 * code expects, e.g. `SELECT usid AS "USID", date_id::text AS "DATE_ID"`.
 */
import { pool } from '../../../config/database.js';
import { NaavikDBConnector } from '../../naavik-db-connector.service.js';
import { logger } from '../../../utils/logger.js';

// 60 s — site-analysis tools may run complex per-site queries that take
// longer than the 8 s default used by quick targeted tools.
const remoteDb = new NaavikDBConnector(undefined, 60_000);

interface MirrorOrRemoteOpts {
  local: { sql: string; params?: unknown[] };
  remote: string;
  /**
   * If true, an empty local result is treated as a definitive "no data" answer
   * and we DO NOT fall back to remote. Use this when the caller has a reason
   * to know the USID is in the mirror (e.g. iterated over offender list).
   */
  noFallback?: boolean;
  /**
   * Staleness policy. When set, after the local query succeeds we inspect the
   * freshest row's date and compare against `requestedDate`. If the gap exceeds
   * `maxDays`, the local result is DISCARDED and we fall through to remote.
   * This stops engineers from seeing weeks-old "fresh" data when the daily
   * mirror sync has fallen behind.
   *
   *   staleness: {
   *     requestedDate: '2026-05-20',
   *     dateColumn: 'date_id',     // optional, defaults to 'date_id'
   *     maxDays: 7,                // optional, defaults to MIRROR_MAX_STALENESS_DAYS env or 7
   *   }
   */
  staleness?: {
    requestedDate: string;          // YYYY-MM-DD
    dateColumn?: string;            // row property to read; default 'date_id'
    maxDays?: number;               // default env MIRROR_MAX_STALENESS_DAYS || 7
  };
  /** Tag for logs only */
  tag?: string;
}

/** YYYY-MM-DD parse → ms epoch. Returns NaN on garbage input. */
function dateMs(value: any): number {
  if (!value) return NaN;
  const s = String(value).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return d.getTime();
}

function maxStalenessDays(explicit?: number): number {
  if (typeof explicit === 'number' && isFinite(explicit) && explicit > 0) return explicit;
  const env = Number(process.env.MIRROR_MAX_STALENESS_DAYS);
  if (isFinite(env) && env > 0) return env;
  return 7;
}

export async function mirrorOrRemote<T = Record<string, unknown>>(opts: MirrorOrRemoteOpts): Promise<T[]> {
  const { local, remote, noFallback, tag, staleness } = opts;
  const tagSuffix = tag ? ':' + tag : '';

  let localRows: T[] = [];
  try {
    const result = await pool.query(local.sql, local.params ?? []);
    localRows = result.rows as T[];
  } catch (err) {
    logger.warn(`[mirror-or-remote${tagSuffix}] local query failed, falling back to remote: ${(err as Error).message}`);
    return (await remoteDb.query(remote)) as T[];
  }

  // Staleness gate — when caller declared a requestedDate, see how stale the
  // freshest local row is. If it exceeds the tolerance, treat as a miss.
  if (staleness && localRows.length > 0) {
    const col = staleness.dateColumn ?? 'date_id';
    const limitDays = maxStalenessDays(staleness.maxDays);
    const requestedMs = dateMs(staleness.requestedDate);
    let freshestMs = -Infinity;
    for (const row of localRows) {
      const v = (row as Record<string, unknown>)[col];
      const ms = dateMs(v);
      if (isFinite(ms) && ms > freshestMs) freshestMs = ms;
    }
    if (isFinite(requestedMs) && isFinite(freshestMs)) {
      const lagDays = Math.round((requestedMs - freshestMs) / 86_400_000);
      if (lagDays > limitDays) {
        // Circuit open → serve stale local immediately rather than hanging.
        if (NaavikDBConnector.isRemoteUnreachable()) {
          logger.info(
            `[mirror-or-remote${tagSuffix}] local data is ${lagDays}d stale but circuit is open — serving stale local`,
          );
          return localRows;
        }
        logger.info(
          `[mirror-or-remote${tagSuffix}] local data is ${lagDays}d stale (limit ${limitDays}d) — falling through to remote`,
        );
        try {
          const remoteRows = (await remoteDb.query(remote)) as T[];
          if (remoteRows.length) return remoteRows;
          // Remote also empty → return the stale local rows so the caller can
          // surface the freshness warning rather than show "no data".
          logger.info(`[mirror-or-remote${tagSuffix}] remote returned 0 rows; serving stale local instead`);
          return localRows;
        } catch (err) {
          logger.warn(
            `[mirror-or-remote${tagSuffix}] remote query failed during staleness fallthrough; serving stale local: ${(err as Error).message}`,
          );
          return localRows;
        }
      }
    }
  }

  if (localRows.length > 0) return localRows;
  if (noFallback) return localRows;

  // No rows locally — likely a non-offender USID or a date outside the 30-day window.
  // Skip remote immediately when the circuit breaker is open.
  if (NaavikDBConnector.isRemoteUnreachable()) {
    logger.info(`[mirror-or-remote${tagSuffix}] circuit open — returning empty (remote skipped)`);
    return [];
  }
  return (await remoteDb.query(remote)) as T[];
}

/** Simpler variant when you only have a local source and want to fail loud on empty. */
export async function mirrorOnly<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
