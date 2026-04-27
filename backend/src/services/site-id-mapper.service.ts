/**
 * Site ID Mapper Service
 * Maps dummy site IDs (UST105013) to real USIDs (270C66AF-34E9-875C-990E-8B5ADAA52500)
 * and vice versa
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

export class SiteIdMapper {
  private dummyToRealMap: Map<string, string> = new Map();
  private realToDummyMap: Map<string, string> = new Map();
  private initialized: boolean = false;

  private static normalizeDummySiteId(value: string | null | undefined): string {
    return String(value || '').trim().toUpperCase();
  }

  private static normalizeRealUSID(value: string | null | undefined): string {
    return String(value || '').trim();
  }

  private static toNumericUSID(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (/^\d{4,6}$/.test(trimmed)) return trimmed;

    const ustMatch = trimmed.match(/^UST(\d{4,6})$/i);
    if (ustMatch) return ustMatch[1];

    const siteMatch = trimmed.match(/^SITE[_-]?[A-Z]?0*(\d{4,6})$/i);
    if (siteMatch) return siteMatch[1];

    return null;
  }

  /**
   * Initialize the mapper by loading site_table from database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('⚠️ SiteIdMapper already initialized');
      return;
    }

    try {
      logger.info('🔄 Initializing SiteIdMapper...');
      
      const client = await pool.connect();
      
      try {
        const quoteIdent = (ident: string): string => `"${String(ident).replace(/"/g, '""')}"`;
        const pickColumn = (columns: string[], candidates: string[]): string | null => {
          const lowered = new Map(columns.map((c) => [c.toLowerCase(), c]));
          for (const candidate of candidates) {
            const hit = lowered.get(candidate.toLowerCase());
            if (hit) return hit;
          }
          return null;
        };

        const tableCandidates: Array<'filtered_sites' | 'site_table'> = ['filtered_sites', 'site_table'];
        const allRows: Array<{ siteId: string; realUSID: string | null }> = [];

        for (const tableName of tableCandidates) {
          const columnResult = await client.query(
            `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = $1
              AND table_schema = 'public'
            `,
            [tableName]
          );
          const columns = columnResult.rows.map((r) => String(r.column_name));
          if (!columns.length) continue;

          const siteIdColumn = pickColumn(columns, ['SiteID', 'site_id']);
          if (!siteIdColumn) continue;

          const realIdColumn = pickColumn(columns, ['USID', 'RealUSID', 'SiteIDOriginal', 'real_usid', 'usid']);
          const query = realIdColumn
            ? `
                SELECT ${quoteIdent(siteIdColumn)}::text AS "siteId", ${quoteIdent(realIdColumn)}::text AS "realUSID"
                FROM ${tableName}
                WHERE ${quoteIdent(siteIdColumn)} IS NOT NULL
                  AND ${quoteIdent(realIdColumn)} IS NOT NULL
              `
            : `
                SELECT ${quoteIdent(siteIdColumn)}::text AS "siteId", NULL::text AS "realUSID"
                FROM ${tableName}
                WHERE ${quoteIdent(siteIdColumn)} IS NOT NULL
              `;

          const result = await client.query(query);
          result.rows.forEach((row: any) => {
            allRows.push({
              siteId: String(row.siteId || '').trim(),
              realUSID: row.realUSID ? String(row.realUSID).trim() : null,
            });
          });
        }

        // Build both mappings
        allRows.forEach((row) => {
          const dummyId = SiteIdMapper.normalizeDummySiteId(row.siteId);
          const fromRealColumn = SiteIdMapper.toNumericUSID(row.realUSID);
          const fromDummyId = SiteIdMapper.toNumericUSID(dummyId);
          const realUSID = fromRealColumn || fromDummyId;

          if (!realUSID) return;
          const normalizedRealUSID = SiteIdMapper.normalizeRealUSID(realUSID);
          this.dummyToRealMap.set(dummyId, normalizedRealUSID);
          this.realToDummyMap.set(normalizedRealUSID, dummyId);
        });
        
        this.initialized = true;
        logger.info(`✅ SiteIdMapper initialized with ${this.dummyToRealMap.size} mappings`);
        
        // Log sample mappings
        const samples = Array.from(this.dummyToRealMap.entries()).slice(0, 3);
        samples.forEach(([dummy, real]) => {
          logger.info(`   ${dummy} ↔ ${real.substring(0, 20)}...`);
        });
        
      } finally {
        client.release();
      }
    } catch (error: any) {
      logger.error('❌ Failed to initialize SiteIdMapper:', error.message);
      throw error;
    }
  }

  /**
   * Get real USID from dummy site ID
   */
  getRealUSID(dummySiteId: string): string | null {
    if (!this.initialized) {
      logger.warn('⚠️ SiteIdMapper not initialized, call initialize() first');
      return null;
    }
    
    const normalizedDummy = SiteIdMapper.normalizeDummySiteId(dummySiteId);
    const realUSID = this.dummyToRealMap.get(normalizedDummy);
    
    if (!realUSID) {
      logger.warn(`⚠️ No real USID found for dummy site ID: ${normalizedDummy}`);
    }
    
    return realUSID || null;
  }

  /**
   * Resolve real USID from any site token used in UI/chat.
   * Supports canonical dummy IDs (USTxxxxx), synthetic SITE_X1234 tokens,
   * and plain numeric tokens.
   */
  resolveRealUSIDFromAnyToken(siteToken: string): string | null {
    if (!this.initialized) return null;
    const token = SiteIdMapper.normalizeDummySiteId(siteToken);

    // Direct map hit
    const direct = this.getRealUSID(token);
    if (direct) return direct;

    // SITE_X1234 -> try UST1234 fallback
    const siteMatch = token.match(/^SITE[_-]?[A-Z]?0*(\d{4,8})$/i);
    if (siteMatch) {
      const ustToken = `UST${siteMatch[1]}`;
      const mapped = this.getRealUSID(ustToken);
      if (mapped) return mapped;
      return siteMatch[1];
    }

    // Plain numeric or UST
    const numeric = SiteIdMapper.toNumericUSID(token);
    if (numeric) {
      const mappedFromNumericUst = this.getRealUSID(`UST${numeric}`);
      if (mappedFromNumericUst) return mappedFromNumericUst;
      return numeric;
    }

    return null;
  }

  /**
   * Get dummy site ID from real USID
   */
  getDummySiteId(realUSID: string): string | null {
    if (!this.initialized) {
      logger.warn('⚠️ SiteIdMapper not initialized, call initialize() first');
      return null;
    }
    
    const normalizedRealUSID = SiteIdMapper.normalizeRealUSID(realUSID);
    const dummyId = this.realToDummyMap.get(normalizedRealUSID);
    
    if (!dummyId) {
      logger.warn(`⚠️ No dummy site ID found for real USID: ${normalizedRealUSID.substring(0, 20)}...`);
    }
    
    return dummyId || null;
  }

  /**
   * Check if a dummy site ID exists in the mapping
   */
  hasDummySiteId(dummySiteId: string): boolean {
    return this.dummyToRealMap.has(SiteIdMapper.normalizeDummySiteId(dummySiteId));
  }

  /**
   * Get all dummy site IDs
   */
  getAllDummySiteIds(): string[] {
    return Array.from(this.dummyToRealMap.keys());
  }

  /**
   * Get mapping statistics
   */
  getStats(): { totalMappings: number; initialized: boolean } {
    return {
      totalMappings: this.dummyToRealMap.size,
      initialized: this.initialized,
    };
  }
}

// Singleton instance
export const siteIdMapper = new SiteIdMapper();
