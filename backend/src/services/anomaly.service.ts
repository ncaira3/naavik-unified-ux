/**
 * Anomaly Detection Service
 * Detects network anomalies based on KPI thresholds
 */
import { pool } from '../config/database.js';
import { Anomaly } from '../types/index.js';
import { ANOMALY_THRESHOLDS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

export class AnomalyService {
  /**
   * Detect anomalies for all sites
   */
  static async detectAnomalies(dateId?: string): Promise<Anomaly[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          k."KPIID",
          k."SiteID",
          s."SiteName",
          k."CellName",
          k."KPIName",
          k."KPIValue",
          k."AnomalyFlag",
          k."AnomalyScore",
          k."DateID",
          s."Latitude",
          s."Longitude"
        FROM intermediate_kpi_table k
        JOIN site_table s ON k."SiteID" = s."SiteID" AND k."DateID" = s."DateID"
        WHERE k."AnomalyFlag" = true
        AND k."DateID" = COALESCE($1, (SELECT MAX("DateID") FROM intermediate_kpi_table))
        ORDER BY k."AnomalyScore" DESC
        LIMIT 100
      `;
      
      const result = await client.query(query, dateId ? [dateId] : [null]);
      
      const anomalies: Anomaly[] = result.rows.map(row => {
        const threshold = this.getThreshold(row.KPIName, row.KPIValue);
        const severity = this.calculateSeverity(row.AnomalyScore);
        
        return {
          anomalyId: row.KPIID,
          siteId: row.SiteID,
          siteName: row.SiteName,
          type: row.KPIName,
          severity,
          kpiName: row.KPIName,
          value: parseFloat(row.KPIValue),
          threshold,
          detectedAt: new Date(row.DateID),
          location: {
            latitude: parseFloat(row.Latitude),
            longitude: parseFloat(row.Longitude),
          },
        };
      });
      
      logger.info(`Detected ${anomalies.length} anomalies`);
      return anomalies;
      
    } finally {
      client.release();
    }
  }

  /**
   * Get anomalies for a specific site
   */
  static async getSiteAnomalies(siteId: string, days: number = 7): Promise<Anomaly[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          k."KPIID",
          k."SiteID",
          s."SiteName",
          k."CellName",
          k."KPIName",
          k."KPIValue",
          k."AnomalyFlag",
          k."AnomalyScore",
          k."DateID",
          s."Latitude",
          s."Longitude"
        FROM intermediate_kpi_table k
        JOIN site_table s ON k."SiteID" = s."SiteID" AND k."DateID" = s."DateID"
        WHERE k."SiteID" = $1
        AND k."AnomalyFlag" = true
        AND k."DateID" >= (SELECT MAX("DateID") FROM intermediate_kpi_table) - INTERVAL '${days} days'
        ORDER BY k."DateID" DESC, k."AnomalyScore" DESC
      `;
      
      const result = await client.query(query, [siteId]);
      
      return result.rows.map(row => ({
        anomalyId: row.KPIID,
        siteId: row.SiteID,
        siteName: row.SiteName,
        type: row.KPIName,
        severity: this.calculateSeverity(row.AnomalyScore),
        kpiName: row.KPIName,
        value: parseFloat(row.KPIValue),
        threshold: this.getThreshold(row.KPIName, row.KPIValue),
        detectedAt: new Date(row.DateID),
        location: {
          latitude: parseFloat(row.Latitude),
          longitude: parseFloat(row.Longitude),
        },
      }));
      
    } finally {
      client.release();
    }
  }

  /**
   * Calculate severity based on anomaly score
   */
  private static calculateSeverity(score: number): 'critical' | 'warning' | 'info' {
    if (score >= 0.7) return 'critical';
    if (score >= 0.3) return 'warning';
    return 'info';
  }

  /**
   * Get threshold for a KPI
   */
  private static getThreshold(kpiName: string, value: number): number {
    const config = ANOMALY_THRESHOLDS[kpiName as keyof typeof ANOMALY_THRESHOLDS];
    
    if (!config) {
      return value * 1.2; // Default: 20% above current value
    }
    
    // For inverse thresholds (lower is worse), return warning threshold
    if ('inverse' in config && config.inverse) {
      return config.warning;
    }
    
    // For normal thresholds (higher is worse), return critical threshold
    return config.critical;
  }

  /**
   * Check if a KPI value is anomalous
   */
  static isAnomaly(kpiName: string, value: number): { isAnomaly: boolean; severity: 'critical' | 'warning' | 'info' | null } {
    const config = ANOMALY_THRESHOLDS[kpiName as keyof typeof ANOMALY_THRESHOLDS];
    
    if (!config) {
      return { isAnomaly: false, severity: null };
    }
    
    if ('inverse' in config && config.inverse) {
      // Lower values are worse
      if (value < config.critical) {
        return { isAnomaly: true, severity: 'critical' };
      }
      if (value < config.warning) {
        return { isAnomaly: true, severity: 'warning' };
      }
    } else {
      // Higher values are worse
      if (value > config.critical) {
        return { isAnomaly: true, severity: 'critical' };
      }
      if (value > config.warning) {
        return { isAnomaly: true, severity: 'warning' };
      }
    }
    
    return { isAnomaly: false, severity: null };
  }

  /**
   * Get anomaly statistics
   */
  static async getAnomalyStats(): Promise<{
    total: number;
    critical: number;
    warning: number;
    info: number;
    byKPI: Record<string, number>;
  }> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          "KPIName",
          COUNT(*) as count,
          SUM(CASE WHEN "AnomalyScore" >= 0.7 THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN "AnomalyScore" >= 0.3 AND "AnomalyScore" < 0.7 THEN 1 ELSE 0 END) as warning,
          SUM(CASE WHEN "AnomalyScore" < 0.3 THEN 1 ELSE 0 END) as info
        FROM intermediate_kpi_table
        WHERE "AnomalyFlag" = true
        AND "DateID" = (SELECT MAX("DateID") FROM intermediate_kpi_table)
        GROUP BY "KPIName"
        ORDER BY count DESC
      `;
      
      const result = await client.query(query);
      
      let total = 0;
      let critical = 0;
      let warning = 0;
      let info = 0;
      const byKPI: Record<string, number> = {};
      
      result.rows.forEach(row => {
        const count = parseInt(row.count);
        total += count;
        critical += parseInt(row.critical);
        warning += parseInt(row.warning);
        info += parseInt(row.info);
        byKPI[row.KPIName] = count;
      });
      
      return { total, critical, warning, info, byKPI };
      
    } finally {
      client.release();
    }
  }
}
