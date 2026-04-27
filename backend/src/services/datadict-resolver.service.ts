/**
 * DataDict Resolver — fuzzy-match KPI/CM parameter names against the
 * Ericsson EIAP DataDict catalog (16,038 params, domain: telco_RAN).
 *
 * Loaded once at startup from the JSON file and indexed in memory.
 * Provides fuzzyMatch() for the resolve_kpi_param agent tool.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolved at startup — tries sibling project first, then local copy
const DATADICT_PATHS = [
  path.resolve(
    __dirname,
    '../../../../appgen-agent-experimental/adapters/data/schemas/datadictConfigRuntime.json',
  ),
  path.resolve(__dirname, '../data/datadictConfigRuntime.json'),
];

export interface DataDictEntry {
  paramName: string;
  category: string; // e.g. "ManagedObject", "struct", etc.
  structureName: string; // globalStructureName
  dataType?: string;
  description?: string;
}

export interface MatchResult {
  paramName: string;
  structureName: string;
  category: string;
  dataType?: string;
  description?: string;
  score: number; // 0–1 similarity
}

// ─── Levenshtein distance ────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  // Early exits
  if (m === 0) return n;
  if (n === 0) return m;
  // Use two-row DP to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ─── Similarity score (0–1) ──────────────────────────────────────────────────
function similarity(a: string, b: string): number {
  const na = a.toUpperCase();
  const nb = b.toUpperCase();
  if (na === nb) return 1.0;

  // Exact substring match is high confidence
  if (na.includes(nb) || nb.includes(na)) {
    return 0.85;
  }

  // Token overlap (split by underscore or non-word chars)
  const tokA = new Set(na.split(/[_\W]+/).filter(Boolean));
  const tokB = new Set(nb.split(/[_\W]+/).filter(Boolean));
  const intersection = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const tokenScore = union > 0 ? intersection / union : 0;

  // Levenshtein normalised
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const editScore = maxLen > 0 ? 1 - dist / maxLen : 0;

  // Weighted blend: token overlap (0.6) + edit distance (0.4)
  return tokenScore * 0.6 + editScore * 0.4;
}

// ─── DataDictResolver ────────────────────────────────────────────────────────
class DataDictResolver {
  private entries: DataDictEntry[] = [];
  private byName = new Map<string, DataDictEntry>(); // uppercase key → entry
  private loaded = false;
  private loadAttempted = false;

  /** Load and index the DataDict JSON. Called once at startup. */
  async load(): Promise<void> {
    if (this.loadAttempted) return;
    this.loadAttempted = true;

    const filePath = DATADICT_PATHS.find((p) => fs.existsSync(p));
    if (!filePath) {
      logger.warn('[DataDictResolver] datadictConfigRuntime.json not found — fuzzy KPI matching disabled.');
      return;
    }

    logger.info(`[DataDictResolver] Loading DataDict from ${filePath}…`);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Deep-traverse the JSON tree, collecting every object that has a `paramName` field.
      // The file has 16,038 such objects nested inside globalStructureDef recursively.
      const seen = new Set<string>();

      const collect = (obj: any, structureName: string): void => {
        if (obj === null || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) collect(item, structureName);
          return;
        }
        // Update structureName context when we enter a globalStructureName node
        const sn: string = typeof obj.globalStructureName === 'string'
          ? obj.globalStructureName
          : structureName;

        if (typeof obj.paramName === 'string' && obj.paramName) {
          const key = `${sn}::${obj.paramName}`;
          if (!seen.has(key)) {
            seen.add(key);
            const pdef: any = (obj.paramDefinition && typeof obj.paramDefinition === 'object')
              ? obj.paramDefinition
              : {};
            const entry: DataDictEntry = {
              paramName: obj.paramName,
              structureName: sn,
              category: typeof obj.paramCategory === 'string' ? obj.paramCategory : 'unknown',
              dataType: pdef.dataType
                ? (typeof pdef.dataType === 'string' ? pdef.dataType : JSON.stringify(pdef.dataType).slice(0, 80))
                : undefined,
              description: typeof obj.paramDescription === 'string'
                ? obj.paramDescription
                : typeof pdef.description === 'string' ? pdef.description : undefined,
            };
            this.entries.push(entry);
            // Prefer first encounter for exact-name lookup
            if (!this.byName.has(entry.paramName.toUpperCase())) {
              this.byName.set(entry.paramName.toUpperCase(), entry);
            }
          }
        }

        for (const val of Object.values(obj)) {
          collect(val, sn);
        }
      };

      collect(parsed, '');

      this.loaded = true;
      logger.info(`[DataDictResolver] Indexed ${this.entries.length} parameters.`);
    } catch (err) {
      logger.error('[DataDictResolver] Failed to load DataDict:', err);
    }
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  get paramCount(): number {
    return this.entries.length;
  }

  /** Exact lookup by canonical name. */
  findExact(paramName: string): DataDictEntry | undefined {
    return this.byName.get(paramName.toUpperCase());
  }

  /**
   * Fuzzy-match user input against all indexed parameters.
   * Returns top N results sorted by score descending.
   */
  fuzzyMatch(
    userInput: string,
    options: { limit?: number; minScore?: number; category?: string } = {},
  ): MatchResult[] {
    const { limit = 5, minScore = 0.35, category } = options;

    if (!this.loaded || !userInput.trim()) return [];

    const needle = userInput.trim().toUpperCase();

    // Exact hit — return immediately with score 1.0
    const exact = this.byName.get(needle);
    if (exact) {
      if (category && exact.category !== category) return [];
      return [{ ...exact, score: 1.0 }];
    }

    // Score all entries
    const scored: MatchResult[] = [];
    for (const entry of this.entries) {
      if (category && entry.category !== category) continue;
      const score = similarity(needle, entry.paramName);
      if (score >= minScore) {
        scored.push({ ...entry, score });
      }
    }

    // Sort descending, take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

export const dataDictResolver = new DataDictResolver();
