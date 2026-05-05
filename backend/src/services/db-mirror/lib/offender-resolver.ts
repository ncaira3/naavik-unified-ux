/**
 * Resolve the offender USIDs for a given date.
 * Definition: a USID is an "offender" on date D iff there is a row in
 * remote site_table with chain_of_thought IS NOT NULL and DATE_ID = D.
 */
import { NaavikDBConnector } from '../../naavik-db-connector.service.js';
import { logger } from '../../../utils/logger.js';

const remoteDb = new NaavikDBConnector();

/** YYYY-MM-DD in only — caller must validate. */
export async function getOffendersForDate(dateId: string): Promise<string[]> {
  const safeDate = dateId.replace(/[^0-9-]/g, '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
    throw new Error(`[mirror] invalid date "${dateId}"`);
  }
  const sql = `
    SELECT DISTINCT CAST(USID AS VARCHAR(64)) AS USID
    FROM site_table WITH (NOLOCK)
    WHERE chain_of_thought IS NOT NULL
      AND CAST(DATE_ID AS DATE) = CAST('${safeDate}' AS DATE)`;
  const rows: any[] = await remoteDb.query(sql);
  const usids = rows
    .map((r) => String(r.USID || '').replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean);
  logger.info(`[mirror] offenders for ${safeDate}: ${usids.length} USIDs`);
  return usids;
}
