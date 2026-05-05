/** Shape returned from MSSQL INFORMATION_SCHEMA.COLUMNS for one column. */
export interface RemoteColumn {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
  IS_NULLABLE: 'YES' | 'NO';
}

/** Internal column representation after type mapping + name normalization. */
export interface MappedColumn {
  remoteName: string;        // e.g. "USID" or "DATE_ID"
  localName: string;         // e.g. "usid" or "date_id" — lowercase, alnum + underscore
  pgType: string;            // e.g. "TEXT", "BIGINT", "DOUBLE PRECISION", "TIMESTAMP"
  nullable: boolean;
}

export interface SyncResult {
  tableName: string;
  dateId: string;
  rowsInserted: number;
  rowsDeleted: number;
  durationMs: number;
  error?: string;
}
