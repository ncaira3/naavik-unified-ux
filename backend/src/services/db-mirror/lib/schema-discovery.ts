/**
 * Schema discovery: read the remote MSSQL column list for a table and produce
 * a Postgres CREATE TABLE DDL with mapped types. Idempotent — safe to call on
 * every backend start (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS).
 */
import { NaavikDBConnector } from '../../naavik-db-connector.service.js';
import { pool } from '../../../config/database.js';
import { logger } from '../../../utils/logger.js';
import { MIRROR_SCHEMA } from '../mirror-tables.js';
import type { MappedColumn, RemoteColumn } from './types.js';

const remoteDb = new NaavikDBConnector();

/** Strip non-alnum/underscore and lowercase. Two columns that collapse to the same
 *  name get a numeric suffix so we never lose data. */
function normalizeColumnName(name: string, taken: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!base) base = 'col';
  // PG max identifier length is 63
  if (base.length > 63) base = base.slice(0, 63);
  let candidate = base;
  let i = 2;
  while (taken.has(candidate)) {
    candidate = `${base.slice(0, 60)}_${i}`;
    i += 1;
  }
  taken.add(candidate);
  return candidate;
}

/** MSSQL data_type → Postgres type. Conservative — favors flexibility over precision. */
export function mssqlToPgType(col: RemoteColumn): string {
  const t = col.DATA_TYPE.toLowerCase();
  switch (t) {
    case 'varchar':
    case 'nvarchar':
    case 'char':
    case 'nchar':
    case 'text':
    case 'ntext':
    case 'xml':
    case 'sql_variant':
      return 'TEXT';
    case 'tinyint':
      return 'SMALLINT';
    case 'smallint':
    case 'int':
    case 'bigint':
      return 'BIGINT';
    case 'float':
    case 'real':
      return 'DOUBLE PRECISION';
    case 'decimal':
    case 'numeric':
    case 'money':
    case 'smallmoney': {
      const p = col.NUMERIC_PRECISION ?? 38;
      const s = col.NUMERIC_SCALE ?? 0;
      return `NUMERIC(${p},${s})`;
    }
    case 'date':
      return 'DATE';
    case 'datetime':
    case 'datetime2':
    case 'smalldatetime':
    case 'datetimeoffset':
      return 'TIMESTAMP';
    case 'time':
      return 'TIME';
    case 'bit':
      return 'BOOLEAN';
    case 'uniqueidentifier':
      return 'TEXT';
    case 'binary':
    case 'varbinary':
    case 'image':
    case 'rowversion':
    case 'timestamp':
      return 'BYTEA';
    default:
      logger.warn(`[mirror] unknown MSSQL type "${col.DATA_TYPE}" on column ${col.COLUMN_NAME} — defaulting to TEXT`);
      return 'TEXT';
  }
}

/** Returns the column list from the remote table in declaration order. */
export async function discoverRemoteColumns(remoteTable: string): Promise<MappedColumn[]> {
  const sql = `
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
           NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${remoteTable.replace(/[^A-Za-z0-9_]/g, '')}'
    ORDER BY ORDINAL_POSITION`;
  const rows: any[] = await remoteDb.query(sql);
  if (!rows.length) {
    throw new Error(`[mirror] remote table "${remoteTable}" has no columns (does it exist?)`);
  }

  const taken = new Set<string>();
  return rows.map((r) => {
    const col = r as RemoteColumn;
    return {
      remoteName: col.COLUMN_NAME,
      localName: normalizeColumnName(col.COLUMN_NAME, taken),
      pgType: mssqlToPgType(col),
      nullable: col.IS_NULLABLE === 'YES',
    };
  });
}

/** Ensure the mirror schema exists. Cheap, idempotent. */
export async function ensureMirrorSchema(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${MIRROR_SCHEMA}`);
}

/**
 * Create the table if it doesn't exist; if it does, ALTER it to add any
 * columns the remote has gained since last run. Never drops columns.
 *
 * Returns the final column list to use for INSERT statements.
 */
export async function ensureLocalTable(
  remoteTable: string,
  columns: MappedColumn[],
): Promise<MappedColumn[]> {
  if (!columns.length) throw new Error(`[mirror] no columns for ${remoteTable}`);
  const tableId = `${MIRROR_SCHEMA}.${quoteIdent(remoteTable)}`;

  // CREATE TABLE IF NOT EXISTS
  const colDefs = columns
    .map((c) => `${quoteIdent(c.localName)} ${c.pgType}`)
    .join(', ');
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${tableId} (${colDefs}, _mirror_synced_at TIMESTAMP DEFAULT NOW())`,
  );

  // Add an index on the date column (most queries scan by date).
  // We try common names — if none exist, no index is created.
  for (const candidate of ['date_id', 'usid', 'source_usid']) {
    if (columns.some((c) => c.localName === candidate)) {
      const idxName = `idx_${remoteTable.toLowerCase()}_${candidate}`.slice(0, 60);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${quoteIdent(idxName)} ON ${tableId} (${quoteIdent(candidate)})`,
      );
    }
  }

  // ALTER TABLE ADD COLUMN IF NOT EXISTS for any new remote columns.
  for (const col of columns) {
    await pool.query(
      `ALTER TABLE ${tableId} ADD COLUMN IF NOT EXISTS ${quoteIdent(col.localName)} ${col.pgType}`,
    );
  }

  return columns;
}

/** Postgres identifier quoting — escapes embedded double-quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
