/**
 * Query Cost Estimator
 *
 * Inspects a generated SQL query BEFORE execution and predicts:
 *   - estimated rows scanned (not returned)
 *   - estimated wall-clock ms
 *   - whether required filters are present
 *   - a traffic-light warning level (green / yellow / red)
 *   - reasons + suggestions the orchestrator can show the user
 *
 * Used by SQLGeneratorService.validateSQL to gate expensive queries and by
 * the V3 orchestrator to emit cost_warning UI blocks before hitting the DB.
 *
 * This is pure heuristics — no DB round-trip — so it adds <1ms to the path.
 */
import { logger } from '../utils/logger.js';

export type WarningLevel = 'green' | 'yellow' | 'red';

export interface CostEstimate {
  estimatedRows: number;        // approx. rows the engine will scan
  estimatedMs: number;          // expected wall-clock
  warningLevel: WarningLevel;
  reasons: string[];            // why this query is expensive (human-readable)
  suggestions: string[];        // how the user can constrain it
  missingRequiredFilters: string[];   // e.g. ["intermediate_kpi_table.USID"]
  tables: string[];             // tables detected in the FROM/JOIN list
}

// ─── Cardinality reference ──────────────────────────────────────────────────
// Approximate row counts for the remote MSSQL tables. These don't need to be
// exact — they only need to be order-of-magnitude correct so the tier logic
// makes the right call.
const TABLE_CARDINALITY: Record<string, number> = {
  // Per-day rows × ~30 days retained
  site_table:                     6_800 * 30,
  cell_table:                    40_000 * 30,
  sector_table:                  10_000 * 30,
  intermediate_kpi_table:       100_000 * 30,   // ~3M
  hourly_intermediate_kpis_table: 2_400_000 * 30, // ~72M  ← the big one
  subcomponent_table:           100_000 * 30,
  cqx_offenders_truth_table:        100 * 30,   // small
  configuration_parameters_table:  1_000 * 30,  // sparse
  ret_table:                     30_000 * 30,
  outage_table:                  10_000 * 30,
  ticket_table:                     200 * 30,
  alarm_table:                    5_000 * 30,
  eim_table:                        500 * 30,
  neighbors_table_date_id:       50_000 * 30,
  neighbors_table:               50_000,        // not partitioned by date
  correlation_table:              1_000 * 30,
  // Local mirror tables (lowercased) — much smaller because offenders only
  filtered_sites:                 1_500,
  filtered_cell_table:            5_000,
  filtered_sector_table:         15_000,
};

// ─── Required-filter policy ─────────────────────────────────────────────────
// Tables that MUST have these filters in the WHERE clause to avoid massive
// scans. Without them, the query is rejected before reaching the DB.
const REQUIRED_FILTERS: Record<string, string[]> = {
  intermediate_kpi_table:         ['USID'],
  hourly_intermediate_kpis_table: ['USID', 'DATE_ID'],
  subcomponent_table:             ['USID'],
  configuration_parameters_table: ['USID'],
  outage_table:                   ['USID'],
  ret_table:                      ['USID'],
  neighbors_table_date_id:        ['SOURCE_USID'],
  kpi_table:                      ['USID'],
};

// Selectivity factors — how much each filter narrows the result set
const SELECTIVITY: Record<string, number> = {
  USID:       0.0001,   // ~1 of 6,800 sites
  DATE_ID:    0.033,    // 1 day of 30
  HOUR_ID:    1 / 24,
  kpi_name:   0.02,     // ~1 of 50 KPIs
  cell_name:  0.0001,   // ~1 of 40,000 cells
  SOURCE_USID: 0.0001,
};

// Tier thresholds
const YELLOW_MS = 2_000;
const RED_MS = 15_000;
const YELLOW_ROWS = 10_000;
const RED_ROWS = 100_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractTables(sql: string): string[] {
  const matches = Array.from(sql.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi));
  const tables = new Set<string>();
  for (const m of matches) tables.add(m[1].toLowerCase());
  return Array.from(tables);
}

function detectFilter(sql: string, column: string): boolean {
  // Detect "column = 'X'" / "column IN (...)" / "column >= ..." / "column BETWEEN ..."
  // Also handles CAST(column AS DATE) wrappings.
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\b${escaped}\\s*(?:=|>=|<=|>|<|!=|<>|IN|BETWEEN)`, 'i'),
    new RegExp(`CAST\\s*\\(\\s*${escaped}\\s+AS\\s+\\w+\\s*\\)\\s*(?:=|>=|<=|BETWEEN)`, 'i'),
    new RegExp(`DATEADD\\s*\\(\\s*\\w+\\s*,\\s*-?\\d+\\s*,\\s*[^)]*\\)\\s*(?:<=|>=|<|>)`, 'i'),
  ];
  return patterns.some((p) => p.test(sql));
}

function detectExplicitUnboundedIntent(sql: string): boolean {
  // The user can ask for "all sites" / "entire database" — the SQL generator
  // is allowed to skip the USID filter when that's the explicit intent. We
  // detect this by looking for hint comments or `TOP 1000` (max allowed).
  return /--\s*unbounded/i.test(sql) || /SELECT\s+\*?\s*TOP\s+1000\b/i.test(sql);
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function estimateQueryCost(sql: string, opts: { allowUnbounded?: boolean } = {}): CostEstimate {
  const reasons: string[] = [];
  const suggestions: string[] = [];
  const missingRequiredFilters: string[] = [];

  const tables = extractTables(sql);
  if (!tables.length) {
    return {
      estimatedRows: 0,
      estimatedMs: 0,
      warningLevel: 'green',
      reasons: ['No tables detected in SQL — likely a constant expression.'],
      suggestions: [],
      missingRequiredFilters: [],
      tables: [],
    };
  }

  // Sum baseline rows across all tables in FROM/JOIN
  let baselineRows = 0;
  for (const t of tables) {
    baselineRows += TABLE_CARDINALITY[t] ?? 1_000;
  }

  // Filter detection
  const hasUsid       = detectFilter(sql, 'USID') || detectFilter(sql, 'SOURCE_USID');
  const hasDate       = detectFilter(sql, 'DATE_ID');
  const hasHour       = detectFilter(sql, 'HOUR_ID');
  const hasKpiName    = detectFilter(sql, 'kpi_name');
  const hasCellName   = detectFilter(sql, 'cell_name');
  const isUnbounded   = detectExplicitUnboundedIntent(sql);

  // Required-filter check (skipped if the SQL declared "unbounded" intent
  // and the caller explicitly allowed it via opts.allowUnbounded).
  if (!opts.allowUnbounded || !isUnbounded) {
    for (const t of tables) {
      const required = REQUIRED_FILTERS[t];
      if (!required) continue;
      for (const col of required) {
        const hasIt =
          col === 'USID' ? hasUsid :
          col === 'DATE_ID' ? hasDate :
          col === 'HOUR_ID' ? hasHour :
          col === 'SOURCE_USID' ? hasUsid :
          detectFilter(sql, col);
        if (!hasIt) {
          missingRequiredFilters.push(`${t}.${col}`);
        }
      }
    }
  }

  // Apply selectivity to estimate row count
  let selectivity = 1.0;
  if (hasUsid)    selectivity *= SELECTIVITY.USID;
  if (hasDate)    selectivity *= SELECTIVITY.DATE_ID;
  if (hasHour)    selectivity *= SELECTIVITY.HOUR_ID;
  if (hasKpiName) selectivity *= SELECTIVITY.kpi_name;
  if (hasCellName) selectivity *= SELECTIVITY.cell_name;

  const estimatedRows = Math.max(1, Math.round(baselineRows * selectivity));

  // Estimate wall-clock: index-backed scan is fast; full scan is slow.
  const indexBacked = hasUsid || hasDate;
  let estimatedMs;
  if (indexBacked) {
    // ~1 ms per 1000 rows returned + 50 ms base overhead
    estimatedMs = 50 + estimatedRows * 0.001 * 1;
  } else {
    // Full scan: ~50 ms per 1000 rows scanned + 100 ms overhead
    estimatedMs = 100 + baselineRows * 0.05;
  }
  estimatedMs = Math.round(estimatedMs);

  // Tier classification
  let warningLevel: WarningLevel = 'green';
  if (missingRequiredFilters.length > 0) {
    warningLevel = 'red';
    for (const f of missingRequiredFilters) {
      const [tbl, col] = f.split('.');
      reasons.push(`${tbl} requires a ${col} filter — without it the query scans the whole table.`);
      if (col === 'USID' || col === 'SOURCE_USID') {
        suggestions.push('Add a site filter ("for USID 9787" or pick a site from the map).');
      } else if (col === 'DATE_ID') {
        suggestions.push('Add a date filter ("for the last 7 days" or "on 2026-05-01").');
      }
    }
  } else if (estimatedMs > RED_MS || estimatedRows > RED_ROWS) {
    warningLevel = 'red';
    reasons.push(
      `This query is estimated to take ${(estimatedMs / 1000).toFixed(0)}s and scan ~${estimatedRows.toLocaleString()} rows.`,
    );
    suggestions.push('Narrow it: pick a site, shorten the time range, or filter by KPI name.');
  } else if (estimatedMs > YELLOW_MS || estimatedRows > YELLOW_ROWS) {
    warningLevel = 'yellow';
    reasons.push(`Estimated ~${(estimatedMs / 1000).toFixed(1)}s for ~${estimatedRows.toLocaleString()} rows.`);
  }

  const result: CostEstimate = {
    estimatedRows,
    estimatedMs,
    warningLevel,
    reasons,
    suggestions,
    missingRequiredFilters,
    tables,
  };

  if (warningLevel !== 'green') {
    logger.info(`[cost-est] ${warningLevel.toUpperCase()} · ${estimatedMs}ms · ${estimatedRows} rows · tables=${tables.join(',')} · missing=${missingRequiredFilters.join('|') || '-'}`);
  }

  return result;
}

/**
 * Build a human-readable summary of the cost estimate — used inside chat
 * messages and llmText for the orchestrator's synthesis.
 */
export function summarizeCost(est: CostEstimate): string {
  const lines: string[] = [];
  if (est.warningLevel === 'red') {
    lines.push('Query rejected — would scan too much data.');
  } else if (est.warningLevel === 'yellow') {
    lines.push('Query OK but slow.');
  } else {
    lines.push('Query OK.');
  }
  lines.push(`Estimated: ${(est.estimatedMs / 1000).toFixed(1)}s · ~${est.estimatedRows.toLocaleString()} rows scanned`);
  if (est.reasons.length) lines.push('Reasons: ' + est.reasons.join(' '));
  if (est.suggestions.length) lines.push('Try: ' + est.suggestions.join(' '));
  return lines.join('\n');
}
