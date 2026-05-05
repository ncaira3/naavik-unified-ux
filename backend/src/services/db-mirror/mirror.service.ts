/**
 * DbMirrorService — keeps a local Postgres copy of the remote MSSQL,
 * scoped to "offender" USIDs (chain_of_thought IS NOT NULL) per day.
 *
 * Lifecycle:
 *   start()
 *     └─ ensure mirror schema + ensure each table's DDL (schema discovery)
 *     └─ if any mirror table is empty → kick off 30-day backfill in background
 *     └─ schedule daily sync at configured UTC hour
 *     └─ schedule retention sweep right after each daily sync
 *
 * Idempotent — safe to restart the process at any time.
 */
import { pool } from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { MIRROR_TABLES, MIRROR_SCHEMA, type MirrorTableSpec } from './mirror-tables.js';
import { discoverRemoteColumns, ensureLocalTable, ensureMirrorSchema, quoteIdent } from './lib/schema-discovery.js';
import { getOffendersForDate } from './lib/offender-resolver.js';
import { syncTableForDate, pruneRetention } from './lib/sync-table.js';
import { ensureLegacyShims } from './lib/legacy-shims.js';
import type { MappedColumn, SyncResult } from './lib/types.js';

/** Concurrency cap for table syncs within a single date — keeps remote DB happy. */
const TABLE_PARALLELISM = 4;

/** Backfill window on first run. */
const DEFAULT_BACKFILL_DAYS = 30;
const DEFAULT_RETENTION_DAYS = 30;

/** Daily sync hour (UTC). 03:00 UTC = 19:00 PST previous day. */
const DAILY_HOUR_UTC = Number(process.env.MIRROR_DAILY_HOUR_UTC ?? '3');

interface RunLogEntry {
  runAt: string;
  scope: 'backfill' | 'daily' | 'retention';
  dateId: string | null;
  tableName: string;
  rowsInserted: number;
  rowsDeleted: number;
  durationMs: number;
  error: string | null;
}

interface ServiceStatus {
  initialized: boolean;
  backfilling: boolean;
  lastDailyAt: string | null;
  lastError: string | null;
  recentRuns: RunLogEntry[];
}

class DbMirrorService {
  private status: ServiceStatus = {
    initialized: false,
    backfilling: false,
    lastDailyAt: null,
    lastError: null,
    recentRuns: [],
  };

  /** Cached column lists per table — populated by ensureSchemas(). */
  private columnsByTable: Record<string, MappedColumn[]> = {};

  private dailyTimer: NodeJS.Timeout | null = null;

  // ── Public API ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      await this.ensureSchemas();
      await this.ensureRunLogTable();
      // Build PascalCase VIEWs in `public` so legacy callers stop logging
      // "relation does not exist" errors against filtered_sites etc.
      await ensureLegacyShims();
      this.status.initialized = true;

      // Auto-backfill if any of the larger tables are empty.
      const empty = await this.isAnyMirrorTableEmpty();
      if (empty) {
        logger.info('[mirror] mirror tables empty — kicking off 30-day backfill in background');
        // fire-and-forget; the rest of the server starts without waiting
        void this.backfill(DEFAULT_BACKFILL_DAYS).catch((err) =>
          logger.error('[mirror] backfill failed', err),
        );
      } else {
        logger.info('[mirror] mirror already populated — skipping startup backfill');
      }

      this.scheduleDaily();
    } catch (err) {
      this.status.lastError = (err as Error).message;
      logger.error('[mirror] startup failed', err);
    }
  }

  getStatus(): ServiceStatus {
    return { ...this.status, recentRuns: this.status.recentRuns.slice(-50) };
  }

  /**
   * Backfill the last `days` days. Each day runs sequentially; tables within
   * a day run in parallel batches of TABLE_PARALLELISM.
   */
  async backfill(days = DEFAULT_BACKFILL_DAYS): Promise<void> {
    if (this.status.backfilling) {
      logger.warn('[mirror] backfill already running — ignoring duplicate trigger');
      return;
    }
    this.status.backfilling = true;
    const started = Date.now();
    try {
      const dates = this.lastNDates(days);
      logger.info(`[mirror] backfill: ${dates.length} days [${dates[0]} .. ${dates[dates.length - 1]}]`);

      for (const dateId of dates) {
        await this.runForDate(dateId, 'backfill');
      }
      logger.info(`[mirror] backfill complete in ${Math.round((Date.now() - started) / 1000)}s`);
      // Sweep retention once after backfill.
      await this.runRetention(DEFAULT_RETENTION_DAYS);
    } catch (err) {
      this.status.lastError = (err as Error).message;
      logger.error('[mirror] backfill aborted', err);
    } finally {
      this.status.backfilling = false;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async ensureSchemas(): Promise<void> {
    await ensureMirrorSchema();
    for (const spec of MIRROR_TABLES) {
      try {
        const cols = await discoverRemoteColumns(spec.remoteTable);
        await ensureLocalTable(spec.remoteTable, cols);
        this.columnsByTable[spec.remoteTable] = cols;
        logger.info(`[mirror] schema ready: ${spec.remoteTable} (${cols.length} cols)`);
      } catch (err) {
        logger.error(`[mirror] schema discovery failed for ${spec.remoteTable}`, err);
        // Continue to next table — partial mirror is better than none.
      }
    }
  }

  private async ensureRunLogTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIRROR_SCHEMA}.run_log (
        id           BIGSERIAL PRIMARY KEY,
        run_at       TIMESTAMP DEFAULT NOW(),
        scope        TEXT NOT NULL,
        date_id      TEXT,
        table_name   TEXT NOT NULL,
        rows_inserted INTEGER DEFAULT 0,
        rows_deleted INTEGER DEFAULT 0,
        duration_ms  INTEGER DEFAULT 0,
        error        TEXT
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_run_log_run_at ON ${MIRROR_SCHEMA}.run_log (run_at DESC)`);
  }

  /** Are any of the high-cardinality mirror tables empty? Triggers backfill if so. */
  private async isAnyMirrorTableEmpty(): Promise<boolean> {
    for (const t of ['site_table', 'intermediate_kpi_table']) {
      try {
        const r = await pool.query(
          `SELECT 1 FROM ${MIRROR_SCHEMA}.${quoteIdent(t)} LIMIT 1`,
        );
        if (r.rowCount === 0) return true;
      } catch {
        // Table doesn't exist (schema discovery may have failed) — treat as empty.
        return true;
      }
    }
    return false;
  }

  /** Pull one calendar day for all mirror tables. */
  private async runForDate(dateId: string, scope: 'backfill' | 'daily'): Promise<void> {
    let offenders: string[] = [];
    try {
      offenders = await getOffendersForDate(dateId);
    } catch (err) {
      logger.error(`[mirror] offender resolution failed for ${dateId}`, err);
      return;
    }
    if (!offenders.length) {
      logger.info(`[mirror] ${dateId}: no offenders — skipping`);
      return;
    }

    // Run table syncs in parallel batches to keep remote DB load reasonable.
    const todo = MIRROR_TABLES.filter((t) => this.columnsByTable[t.remoteTable]);
    const results: SyncResult[] = [];
    for (let i = 0; i < todo.length; i += TABLE_PARALLELISM) {
      const batch = todo.slice(i, i + TABLE_PARALLELISM);
      const batchResults = await Promise.all(
        batch.map((spec) =>
          syncTableForDate(spec, dateId, offenders, this.columnsByTable[spec.remoteTable]),
        ),
      );
      results.push(...batchResults);
    }

    // Persist run-log entries for each table
    for (const r of results) {
      await this.recordRun(scope, r);
    }

    const totalRows = results.reduce((s, r) => s + r.rowsInserted, 0);
    const failed = results.filter((r) => r.error).length;
    logger.info(
      `[mirror] ${dateId}: ${results.length} tables, ${totalRows} rows inserted${failed ? `, ${failed} table(s) failed` : ''}`,
    );
  }

  private async runRetention(keepDays: number): Promise<void> {
    let totalDeleted = 0;
    for (const spec of MIRROR_TABLES) {
      if (!this.columnsByTable[spec.remoteTable]) continue;
      try {
        const deleted = await pruneRetention(spec, keepDays);
        totalDeleted += deleted;
        await this.recordRun('retention', {
          tableName: spec.remoteTable,
          dateId: '',
          rowsInserted: 0,
          rowsDeleted: deleted,
          durationMs: 0,
        });
      } catch (err) {
        logger.warn(`[mirror] retention prune failed for ${spec.remoteTable}`, err);
      }
    }
    logger.info(`[mirror] retention sweep: deleted ${totalDeleted} rows older than ${keepDays} days`);
  }

  private async recordRun(scope: 'backfill' | 'daily' | 'retention', r: SyncResult): Promise<void> {
    const entry: RunLogEntry = {
      runAt: new Date().toISOString(),
      scope,
      dateId: r.dateId || null,
      tableName: r.tableName,
      rowsInserted: r.rowsInserted,
      rowsDeleted: r.rowsDeleted,
      durationMs: r.durationMs,
      error: r.error || null,
    };
    this.status.recentRuns.push(entry);
    if (this.status.recentRuns.length > 200) this.status.recentRuns.splice(0, 100);
    try {
      await pool.query(
        `INSERT INTO ${MIRROR_SCHEMA}.run_log
           (scope, date_id, table_name, rows_inserted, rows_deleted, duration_ms, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [scope, entry.dateId, entry.tableName, entry.rowsInserted, entry.rowsDeleted, entry.durationMs, entry.error],
      );
    } catch (err) {
      // Don't let logging failures break the pipeline.
      logger.warn('[mirror] failed to write run_log entry', err);
    }
  }

  /** Schedule the next daily run via setTimeout, anchored to wall clock. */
  private scheduleDaily(): void {
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(DAILY_HOUR_UTC, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    logger.info(`[mirror] next daily sync at ${next.toISOString()}`);
    this.dailyTimer = setTimeout(async () => {
      await this.runDaily();
      this.scheduleDaily(); // reschedule
    }, delayMs);
    // Don't keep the process alive just for the timer.
    this.dailyTimer.unref?.();
  }

  private async runDaily(): Promise<void> {
    try {
      const dateId = this.yesterdayUtc();
      logger.info(`[mirror] daily sync for ${dateId}`);
      await this.runForDate(dateId, 'daily');
      await this.runRetention(DEFAULT_RETENTION_DAYS);
      this.status.lastDailyAt = new Date().toISOString();
    } catch (err) {
      this.status.lastError = (err as Error).message;
      logger.error('[mirror] daily run failed', err);
    }
  }

  private lastNDates(n: number): string[] {
    const out: string[] = [];
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - 1); // start from yesterday
    for (let i = 0; i < n; i++) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return out.reverse(); // oldest first
  }

  private yesterdayUtc(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}

export const dbMirror = new DbMirrorService();
