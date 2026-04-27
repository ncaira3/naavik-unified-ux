import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');

interface CanonicalEntry {
  canonical: string;
  aliases: Set<string>;
}

interface MatchResult {
  canonical: string;
  alias: string;
  confidence: number;
}

export class CsvRagResolverService {
  private static initialized = false;
  private static kpiMap = new Map<string, CanonicalEntry>();
  private static parameterMap = new Map<string, CanonicalEntry>();
  private static kpiFrequency = new Map<string, number>();
  private static parameterFrequency = new Map<string, number>();

  static async resolveKPI(input: string, limit = 5): Promise<MatchResult[]> {
    await this.ensureInitialized();
    return this.rankMatches(input, this.kpiMap, limit);
  }

  static async resolveParameter(input: string, limit = 5): Promise<MatchResult[]> {
    await this.ensureInitialized();
    return this.rankMatches(input, this.parameterMap, limit);
  }

  static async listKpis(limit = 50, query?: string): Promise<Array<{ canonical: string; confidence: number }>> {
    await this.ensureInitialized();
    if (query && query.trim()) {
      return this.rankMatches(query, this.kpiMap, limit).map((m) => ({
        canonical: m.canonical,
        confidence: m.confidence,
      }));
    }

    const ranked = Array.from(this.kpiMap.values()).map((entry) => ({
      canonical: entry.canonical,
      confidence: this.kpiFrequency.get(entry.canonical) || 0,
    }));
    ranked.sort((a, b) => b.confidence - a.confidence || a.canonical.localeCompare(b.canonical));
    return ranked.slice(0, limit);
  }

  static async listParameters(limit = 50, query?: string): Promise<Array<{ canonical: string; confidence: number }>> {
    await this.ensureInitialized();
    if (query && query.trim()) {
      return this.rankMatches(query, this.parameterMap, limit).map((m) => ({
        canonical: m.canonical,
        confidence: m.confidence,
      }));
    }

    const ranked = Array.from(this.parameterMap.values()).map((entry) => ({
      canonical: entry.canonical,
      confidence: this.parameterFrequency.get(entry.canonical) || 0,
    }));
    ranked.sort((a, b) => b.confidence - a.confidence || a.canonical.localeCompare(b.canonical));
    return ranked.slice(0, limit);
  }

  private static async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromCsv();
    this.initialized = true;
  }

  private static async loadFromCsv(): Promise<void> {
    try {
      await Promise.all([
        this.loadKpisFromCsv(),
        this.loadParametersFromCsv(),
      ]);
      logger.info('CSV RAG resolver initialized', {
        kpis: this.kpiMap.size,
        parameters: this.parameterMap.size,
      });
    } catch (error) {
      logger.warn('CSV RAG resolver failed to initialize', error);
    }
  }

  private static async loadKpisFromCsv(): Promise<void> {
    const files = [
      path.join(REPO_ROOT, 'raw_data/intermediate_kpi_table.csv'),
      path.join(REPO_ROOT, 'data/all_usids_daily_kpi.csv'),
      path.join(REPO_ROOT, 'data/all_usids_hourly_kpi.csv'),
    ];

    for (const file of files) {
      await this.extractColumnValues(file, 'kpi_name', (raw) => {
        const canonical = raw.trim();
        if (!canonical) return;
        this.addEntry(this.kpiMap, canonical, canonical);
        this.addKpiAliases(canonical);
        this.kpiFrequency.set(canonical, (this.kpiFrequency.get(canonical) || 0) + 1);
      });
    }
  }

  private static async loadParametersFromCsv(): Promise<void> {
    const files = [
      path.join(REPO_ROOT, 'raw_data/cell_table.csv'),
      path.join(REPO_ROOT, 'filtered_data/cell_table.csv'),
      path.join(REPO_ROOT, 'dummy_data/cell_table.csv'),
    ];

    for (const file of files) {
      const header = await this.readHeader(file);
      for (const col of header) {
        const canonical = col.trim();
        if (!canonical) continue;
        this.addEntry(this.parameterMap, canonical, canonical);
        this.addParameterAliases(canonical);
        this.parameterFrequency.set(canonical, (this.parameterFrequency.get(canonical) || 0) + 1);
      }
    }

    // Seed common telecom parameter names to improve miss/typo coverage.
    const seedParameters = ['qRxLevMin', 'crsGain', 'a3Offset', 'maxHARQTx', 'cellIndividualOffset', 'qQualMin'];
    for (const p of seedParameters) {
      this.addEntry(this.parameterMap, p, p);
      this.addParameterAliases(p);
      this.parameterFrequency.set(p, (this.parameterFrequency.get(p) || 0) + 1);
    }
  }

  private static async extractColumnValues(
    filePath: string,
    columnName: string,
    onValue: (value: string) => void
  ): Promise<void> {
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return;
      const header = this.parseCsvLine(lines[0]);
      const idx = header.findIndex((h) => h.trim().toLowerCase() === columnName.toLowerCase());
      if (idx === -1) return;

      // Cap scan for safety on large files.
      const maxLines = Math.min(lines.length, 200000);
      for (let i = 1; i < maxLines; i += 1) {
        const line = lines[i];
        if (!line) continue;
        const parts = this.parseCsvLine(line);
        if (idx >= parts.length) continue;
        onValue(parts[idx] || '');
      }
    } catch {
      // ignore missing or unreadable files
    }
  }

  private static async readHeader(filePath: string): Promise<string[]> {
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const firstLine = text.split(/\r?\n/, 1)[0] || '';
      return this.parseCsvLine(firstLine);
    } catch {
      return [];
    }
  }

  private static parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current);
    return out.map((v) => v.trim());
  }

  private static addEntry(target: Map<string, CanonicalEntry>, canonical: string, alias: string): void {
    const key = canonical;
    if (!target.has(key)) {
      target.set(key, { canonical, aliases: new Set<string>() });
    }
    target.get(key)!.aliases.add(alias);
    target.get(key)!.aliases.add(this.toSnake(alias));
    target.get(key)!.aliases.add(this.toSpaced(alias));
    target.get(key)!.aliases.add(this.normalize(alias));
  }

  private static addKpiAliases(canonical: string): void {
    const lower = canonical.toLowerCase();
    if (lower.includes('prb')) {
      this.addEntry(this.kpiMap, canonical, 'prb utilization');
      this.addEntry(this.kpiMap, canonical, 'dl prb util');
      this.addEntry(this.kpiMap, canonical, 'prb util');
    }
    if (lower.includes('rrc')) {
      this.addEntry(this.kpiMap, canonical, 'rrc failure rate');
    }
    if (lower.includes('drop')) {
      this.addEntry(this.kpiMap, canonical, 'drop rate');
    }
  }

  private static addParameterAliases(canonical: string): void {
    const lower = canonical.toLowerCase();
    if (lower.includes('qrxlevmin')) {
      this.addEntry(this.parameterMap, canonical, 'qrx lev min');
    }
    if (lower.includes('crsgain')) {
      this.addEntry(this.parameterMap, canonical, 'crs gain');
    }
    if (lower.includes('cellindividualoffset')) {
      this.addEntry(this.parameterMap, canonical, 'cell individual offset');
    }
  }

  private static rankMatches(input: string, map: Map<string, CanonicalEntry>, limit: number): MatchResult[] {
    const queryNorm = this.normalize(input);
    const queryCompact = this.compact(queryNorm);
    if (!queryNorm) return [];

    const scored: MatchResult[] = [];
    for (const entry of map.values()) {
      let bestAlias = entry.canonical;
      let bestScore = 0;
      for (const alias of entry.aliases) {
        const aliasNorm = this.normalize(alias);
        const aliasCompact = this.compact(aliasNorm);
        let score = this.similarity(queryNorm, aliasNorm);
        if (queryCompact && aliasCompact && queryCompact === aliasCompact) {
          score = 1;
        } else if (queryCompact && aliasCompact && (queryCompact.includes(aliasCompact) || aliasCompact.includes(queryCompact))) {
          score = Math.max(score, 0.95);
        }
        if (score > bestScore) {
          bestScore = score;
          bestAlias = alias;
        }
      }
      if (bestScore >= 0.45) {
        scored.push({
          canonical: entry.canonical,
          alias: bestAlias,
          confidence: Number(bestScore.toFixed(4)),
        });
      }
    }

    scored.sort((a, b) => b.confidence - a.confidence || a.canonical.localeCompare(b.canonical));
    return scored.slice(0, limit);
  }

  private static similarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.92;

    const dice = this.diceCoefficient(a, b);
    const lev = this.levenshteinSimilarity(a, b);
    const token = this.tokenOverlap(a, b);
    return Math.max(dice * 0.5 + lev * 0.35 + token * 0.15, Math.max(dice, lev, token));
  }

  private static diceCoefficient(a: string, b: string): number {
    const bigrams = (s: string): string[] => {
      if (s.length < 2) return [s];
      const arr: string[] = [];
      for (let i = 0; i < s.length - 1; i += 1) arr.push(s.slice(i, i + 2));
      return arr;
    };
    const aB = bigrams(a);
    const bB = bigrams(b);
    const bCount = new Map<string, number>();
    for (const g of bB) bCount.set(g, (bCount.get(g) || 0) + 1);
    let overlap = 0;
    for (const g of aB) {
      const n = bCount.get(g) || 0;
      if (n > 0) {
        overlap += 1;
        bCount.set(g, n - 1);
      }
    }
    return (2 * overlap) / (aB.length + bB.length);
  }

  private static levenshteinSimilarity(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) dp[i][0] = i;
    for (let j = 0; j <= n; j += 1) dp[0][j] = j;
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    const distance = dp[m][n];
    return 1 - distance / Math.max(m, n);
  }

  private static tokenOverlap(a: string, b: string): number {
    const aSet = new Set(a.split(/\s+/).filter(Boolean));
    const bSet = new Set(b.split(/\s+/).filter(Boolean));
    if (aSet.size === 0 || bSet.size === 0) return 0;
    let inter = 0;
    for (const t of aSet) if (bSet.has(t)) inter += 1;
    return inter / Math.max(aSet.size, bSet.size);
  }

  private static normalize(v: string): string {
    return v
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static compact(v: string): string {
    return this.normalize(v).replace(/[^a-z0-9]/g, '');
  }

  private static toSnake(v: string): string {
    return this.normalize(v).replace(/\s+/g, '_');
  }

  private static toSpaced(v: string): string {
    return this.normalize(v);
  }
}
