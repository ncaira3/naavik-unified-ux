/**
 * Tables to mirror locally, with their per-day offender filter clauses.
 *
 * The mirror copies the EXACT remote schema (column names + types) into the
 * `mirror.<table>` Postgres schema. Only rows for "offender" USIDs (sites
 * with chain_of_thought IS NOT NULL on that day) are pulled.
 *
 * Each entry:
 *   remoteTable    — the name in the remote MSSQL DB (also the local mirror name)
 *   filterColumn   — the column to filter by USID list (usually `USID`, but
 *                    `neighbors_table_date_id` uses `SOURCE_USID`)
 *   dateColumn     — the column to filter by date (usually `DATE_ID`)
 */
export interface MirrorTableSpec {
  remoteTable: string;
  filterColumn: string;
  dateColumn: string;
  /**
   * Optional cap on USIDs per remote query. Used for high-cardinality tables
   * (e.g. hourly KPIs) where pulling all offenders in a single query exceeds
   * the remote DB's response time. Omit for normal tables (one query / day).
   */
  chunkSize?: number;
}

export const MIRROR_TABLES: MirrorTableSpec[] = [
  { remoteTable: 'site_table',                    filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'cell_table',                    filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'sector_table',                  filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  // Daily KPIs: ~2k rows per offender — fine without chunking.
  { remoteTable: 'intermediate_kpi_table',        filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  // Hourly KPIs: ~36k rows per offender (24h × cells × KPIs) — chunk hard.
  { remoteTable: 'hourly_intermediate_kpis_table', filterColumn: 'USID',       dateColumn: 'DATE_ID', chunkSize: 5 },
  { remoteTable: 'subcomponent_table',            filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'cqx_offenders_truth_table',     filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'neighbors_table_date_id',       filterColumn: 'SOURCE_USID', dateColumn: 'DATE_ID' },
  { remoteTable: 'ticket_table',                  filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'alarm_table',                   filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'eim_table',                     filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'outage_table',                  filterColumn: 'USID',        dateColumn: 'DATE_ID' },
  { remoteTable: 'configuration_parameters_table', filterColumn: 'USID',       dateColumn: 'DATE_ID' },
  { remoteTable: 'ret_table',                     filterColumn: 'USID',        dateColumn: 'DATE_ID' },
];

export const MIRROR_SCHEMA = 'mirror';
