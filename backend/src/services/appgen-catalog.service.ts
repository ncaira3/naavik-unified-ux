import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');

interface CatalogResult {
  canonical: string;
  confidence: number;
}

interface LangChainReranker {
  rerank(query: string, candidates: CatalogResult[]): Promise<CatalogResult[]>;
}

export class AppGenCatalogService {
  private static initialized = false;
  private static langchainReranker: LangChainReranker | null = null;

  static async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ensureSchema();
    await this.seedFromCsv();
    await this.tryInitializeLangChainReranker();
    this.initialized = true;
  }

  static async resolveKpi(input: string, limit = 8): Promise<CatalogResult[]> {
    await this.initialize();
    return this.resolve('kpi', input, limit);
  }

  static async resolveParameter(input: string, limit = 8): Promise<CatalogResult[]> {
    await this.initialize();
    return this.resolve('parameter', input, limit);
  }

  static async listKpis(limit = 50, query?: string): Promise<CatalogResult[]> {
    await this.initialize();
    if (query && query.trim()) return this.resolveKpi(query, limit);
    const result = await pool.query(
      `SELECT canonical_name
       FROM appgen_catalog_items
       WHERE item_type = 'kpi'
       ORDER BY canonical_name ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({ canonical: String(row.canonical_name), confidence: 0.7 }));
  }

  static async listParameters(limit = 50, query?: string): Promise<CatalogResult[]> {
    await this.initialize();
    if (query && query.trim()) return this.resolveParameter(query, limit);
    const result = await pool.query(
      `SELECT canonical_name
       FROM appgen_catalog_items
       WHERE item_type = 'parameter'
       ORDER BY canonical_name ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({ canonical: String(row.canonical_name), confidence: 0.7 }));
  }

  private static async ensureSchema(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appgen_catalog_items (
        id BIGSERIAL PRIMARY KEY,
        item_type VARCHAR(24) NOT NULL,
        canonical_name TEXT NOT NULL,
        source VARCHAR(64) NOT NULL DEFAULT 'dummy_data',
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (item_type, canonical_name)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appgen_catalog_aliases (
        id BIGSERIAL PRIMARY KEY,
        item_id BIGINT NOT NULL REFERENCES appgen_catalog_items(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (item_id, normalized_alias)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_appgen_alias_norm ON appgen_catalog_aliases(normalized_alias);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_appgen_item_type ON appgen_catalog_items(item_type);`);
  }

  private static async seedFromCsv(): Promise<void> {
    const kpis = new Set<string>();
    const parameters = new Set<string>();

    await this.extractColumnValues(path.join(REPO_ROOT, 'dummy_data/intermediate_kpi_table.csv'), 'kpi_name', (value) => {
      const v = value.trim();
      if (v) kpis.add(v);
    });
    await this.extractHeaders(path.join(REPO_ROOT, 'dummy_data/cell_table.csv'), (header) => {
      const v = header.trim();
      if (v) parameters.add(v);
    });

    for (const kpi of kpis) {
      const itemId = await this.upsertItem('kpi', kpi);
      await this.upsertAliases(itemId, this.generateAliases(kpi, 'kpi'));
    }

    for (const parameter of parameters) {
      const itemId = await this.upsertItem('parameter', parameter);
      await this.upsertAliases(itemId, this.generateAliases(parameter, 'parameter'));
    }

    logger.info('AppGen catalog seeded from CSV', {
      kpis: kpis.size,
      parameters: parameters.size,
    });
  }

  private static async upsertItem(itemType: 'kpi' | 'parameter', canonicalName: string): Promise<number> {
    const result = await pool.query(
      `INSERT INTO appgen_catalog_items (item_type, canonical_name, source)
       VALUES ($1, $2, 'dummy_data')
       ON CONFLICT (item_type, canonical_name)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [itemType, canonicalName]
    );
    return Number(result.rows[0].id);
  }

  private static async upsertAliases(itemId: number, aliases: string[]): Promise<void> {
    for (const alias of aliases) {
      const normalized = this.normalize(alias);
      if (!normalized) continue;
      await pool.query(
        `INSERT INTO appgen_catalog_aliases (item_id, alias, normalized_alias)
         VALUES ($1, $2, $3)
         ON CONFLICT (item_id, normalized_alias) DO NOTHING`,
        [itemId, alias, normalized]
      );
    }
  }

  private static async resolve(itemType: 'kpi' | 'parameter', input: string, limit: number): Promise<CatalogResult[]> {
    const normalizedInput = this.normalize(input);
    if (!normalizedInput) return [];

    const result = await pool.query(
      `SELECT i.canonical_name, a.alias, a.normalized_alias
       FROM appgen_catalog_items i
       JOIN appgen_catalog_aliases a ON a.item_id = i.id
       WHERE i.item_type = $1
         AND (
           a.normalized_alias LIKE $2
           OR a.normalized_alias LIKE $3
           OR a.normalized_alias = $4
         )`,
      [itemType, `%${normalizedInput}%`, `${normalizedInput}%`, normalizedInput]
    );

    const byCanonical = new Map<string, number>();
    for (const row of result.rows) {
      const canonical = String(row.canonical_name);
      const candidateNorm = String(row.normalized_alias || this.normalize(String(row.alias || canonical)));
      const score = this.similarity(normalizedInput, candidateNorm);
      const prev = byCanonical.get(canonical) ?? 0;
      if (score > prev) byCanonical.set(canonical, score);
    }

    const baseCandidates: CatalogResult[] = Array.from(byCanonical.entries())
      .map(([canonical, confidence]) => ({ canonical, confidence: Number(confidence.toFixed(4)) }))
      .filter((item) => item.confidence >= 0.42)
      .sort((a, b) => b.confidence - a.confidence || a.canonical.localeCompare(b.canonical))
      .slice(0, limit);

    if (baseCandidates.length === 0) {
      const broad = await pool.query(
        `SELECT canonical_name
         FROM appgen_catalog_items
         WHERE item_type = $1
         ORDER BY canonical_name ASC
         LIMIT $2`,
        [itemType, limit]
      );
      return broad.rows.map((row) => ({ canonical: String(row.canonical_name), confidence: 0.35 }));
    }

    if (this.langchainReranker) {
      try {
        return await this.langchainReranker.rerank(input, baseCandidates);
      } catch {
        return baseCandidates;
      }
    }
    return baseCandidates;
  }

  private static async tryInitializeLangChainReranker(): Promise<void> {
    try {
      const dynamicImport = Function('m', 'return import(m)') as (moduleName: string) => Promise<any>;
      const module = await dynamicImport('./langchain-catalog-reranker.service.js');
      if (module?.LangChainCatalogRerankerService) {
        this.langchainReranker = new module.LangChainCatalogRerankerService();
        logger.info('AppGen catalog LangChain reranker enabled');
      }
    } catch {
      this.langchainReranker = null;
      logger.info('AppGen catalog LangChain reranker unavailable, using lexical ranking');
    }
  }

  private static async extractColumnValues(filePath: string, columnName: string, onValue: (value: string) => void): Promise<void> {
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return;
      const headers = this.parseCsvLine(lines[0]);
      const index = headers.findIndex((h) => h.trim().toLowerCase() === columnName.toLowerCase());
      if (index === -1) return;
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        const parts = this.parseCsvLine(line);
        if (index < parts.length) onValue(parts[index] || '');
      }
    } catch {
      // ignore missing file
    }
  }

  private static async extractHeaders(filePath: string, onHeader: (header: string) => void): Promise<void> {
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const firstLine = text.split(/\r?\n/, 1)[0] || '';
      this.parseCsvLine(firstLine).forEach(onHeader);
    } catch {
      // ignore missing file
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
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  }

  private static generateAliases(value: string, itemType: 'kpi' | 'parameter'): string[] {
    const aliases = new Set<string>([value, this.toSnake(value), this.toSpaced(value), this.normalize(value)]);
    const lower = value.toLowerCase();
    if (itemType === 'kpi') {
      if (lower.includes('prb')) aliases.add('dl prb util');
      if (lower.includes('rrc')) aliases.add('rrc failure rate');
      if (lower.includes('drop')) aliases.add('drop rate');
    } else {
      if (lower.includes('qrxlevmin')) aliases.add('qrx lev min');
      if (lower.includes('crsgain')) aliases.add('crs gain');
      if (lower.includes('cellindividualoffset')) aliases.add('cell individual offset');
    }
    return Array.from(aliases);
  }

  private static toSnake(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s\-]+/g, '_')
      .toLowerCase();
  }

  private static toSpaced(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-]+/g, ' ')
      .toLowerCase()
      .trim();
  }

  private static normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;
    if (a.includes(b) || b.includes(a)) {
      const shorter = Math.min(a.length, b.length);
      const longer = Math.max(a.length, b.length);
      return shorter / longer;
    }
    const distance = this.levenshtein(a, b);
    return 1 - distance / Math.max(a.length, b.length);
  }

  private static levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[a.length][b.length];
  }
}

