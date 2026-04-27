/**
 * Data Anonymizer Service
 * Anonymizes sensitive data (cell names, etc.) before returning to frontend
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { KPIDataPoint } from './naavik-db-connector.service.js';

export interface AnonymizedKPIDataPoint {
  cell_name: string;
  kpi_name: string;
  kpi_value: number | null;
  DATE_ID: string;
  HOUR_ID?: number;
}

export class DataAnonymizer {
  private cellNameCache: Map<string, string> = new Map();

  /**
   * Anonymize a cell name using consistent MD5 hash
   * Generates format: CELL_######
   */
  anonymizeCellName(realCellName: string): string {
    if (!this.cellNameCache.has(realCellName)) {
      const hash = crypto
        .createHash('md5')
        .update(realCellName)
        .digest('hex')
        .substring(0, 6)
        .toUpperCase();
      
      const anonymized = `CELL_${hash}`;
      this.cellNameCache.set(realCellName, anonymized);
    }
    
    return this.cellNameCache.get(realCellName)!;
  }

  /**
   * Anonymize KPI data points
   * - Anonymizes cell names
   * - Removes USID (caller should use dummy site ID)
   * - Keeps KPI names and values unchanged
   */
  anonymizeKPIData(data: KPIDataPoint[]): AnonymizedKPIDataPoint[] {
    if (!data || data.length === 0) {
      return [];
    }

    const anonymized = data.map(row => {
      const result: AnonymizedKPIDataPoint = {
        cell_name: this.anonymizeCellName(row.cell_name),
        kpi_name: row.kpi_name,
        kpi_value: row.kpi_value,
        DATE_ID: row.DATE_ID,
      };

      // Add HOUR_ID if present
      if (row.HOUR_ID !== undefined && row.HOUR_ID !== null) {
        result.HOUR_ID = row.HOUR_ID;
      }

      return result;
    });

    logger.info(`🔒 Anonymized ${anonymized.length} KPI data points`);
    
    return anonymized;
  }

  /**
   * Clear the cell name cache (useful for testing or memory management)
   */
  clearCache(): void {
    this.cellNameCache.clear();
    logger.info('🗑️ Cell name cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { cachedCellNames: number } {
    return {
      cachedCellNames: this.cellNameCache.size,
    };
  }
}

// Singleton instance
export const dataAnonymizer = new DataAnonymizer();
