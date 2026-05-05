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

const remoteDb = new NaavikDBConnector();

interface MirrorOrRemoteOpts {
  local: { sql: string; params?: unknown[] };
  remote: string;
  /**
   * If true, an empty local result is treated as a definitive "no data" answer
   * and we DO NOT fall back to remote. Use this when the caller has a reason
   * to know the USID is in the mirror (e.g. iterated over offender list).
   */
  noFallback?: boolean;
  /** Tag for logs only */
  tag?: string;
}

export async function mirrorOrRemote<T = Record<string, unknown>>(opts: MirrorOrRemoteOpts): Promise<T[]> {
  const { local, remote, noFallback, tag } = opts;
  let localRows: T[] = [];
  try {
    const result = await pool.query(local.sql, local.params ?? []);
    localRows = result.rows as T[];
  } catch (err) {
    logger.warn(`[mirror-or-remote${tag ? ':' + tag : ''}] local query failed, falling back to remote: ${(err as Error).message}`);
    return (await remoteDb.query(remote)) as T[];
  }

  if (localRows.length > 0) return localRows;
  if (noFallback) return localRows;

  // No rows locally — likely a non-offender USID or a date outside the 30-day window.
  return (await remoteDb.query(remote)) as T[];
}

/** Simpler variant when you only have a local source and want to fail loud on empty. */
export async function mirrorOnly<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
