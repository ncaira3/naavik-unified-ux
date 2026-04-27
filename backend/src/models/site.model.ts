/**
 * Site Model - Database queries for site data
 */
import { pool } from '../config/database.js';
import { Site, MapSite } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class SiteModel {
  /**
   * Get all sites for a specific date
   */
  static async getAllSites(dateId?: string): Promise<Site[]> {
    const client = await pool.connect();
    
    try {
      // Use filtered_sites table (sites within 30 miles of Union City, CA)
      let query = `
        SELECT "SiteID", "SiteName", "Latitude", "Longitude", 
               "CellCount", "DateID", "AnomalyFlag", "AnomalyScore", "ClusterID"
        FROM filtered_sites
        ORDER BY "DistanceFromUnionCity"
      `;
      
      const result = await client.query(query);
      
      logger.debug(`Fetched ${result.rows.length} filtered sites (Union City area)`);
      
      return result.rows.map(row => ({
        SiteID: row.SiteID,
        SiteName: row.SiteName,
        Latitude: parseFloat(row.Latitude),
        Longitude: parseFloat(row.Longitude),
        CellCount: row.CellCount,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag || false,
        AnomalyScore: parseFloat(row.AnomalyScore) || 0,
        ClusterID: row.ClusterID || null,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get site by ID
   */
  static async getSiteById(siteId: string, dateId?: string): Promise<Site | null> {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT "SiteID", "SiteName", "Latitude", "Longitude", 
               "CellCount", "DateID", "AnomalyFlag", "AnomalyScore"
        FROM site_table
        WHERE "SiteID" = $1
      `;
      
      const params: any[] = [siteId];
      
      if (dateId) {
        query += ` AND "DateID" = $2`;
        params.push(dateId);
      } else {
        query += ` AND "DateID" = (SELECT MAX("DateID") FROM site_table WHERE "SiteID" = $1)`;
      }
      
      const result = await client.query(query, params);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        SiteID: row.SiteID,
        SiteName: row.SiteName,
        Latitude: parseFloat(row.Latitude),
        Longitude: parseFloat(row.Longitude),
        CellCount: row.CellCount,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag || false,
        AnomalyScore: parseFloat(row.AnomalyScore) || 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get sites with anomalies
   */
  static async getAnomalousSites(severity?: 'critical' | 'warning'): Promise<Site[]> {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT "SiteID", "SiteName", "Latitude", "Longitude", 
               "CellCount", "DateID", "AnomalyFlag", "AnomalyScore"
        FROM site_table
        WHERE "AnomalyFlag" = true
        AND "DateID" = (SELECT MAX("DateID") FROM site_table)
      `;
      
      if (severity === 'critical') {
        query += ` AND "AnomalyScore" >= 0.85`;
      } else if (severity === 'warning') {
        query += ` AND "AnomalyScore" >= 0.75 AND "AnomalyScore" < 0.85`;
      }
      
      query += ` ORDER BY "AnomalyScore" DESC`;
      
      const result = await client.query(query);
      
      return result.rows.map(row => ({
        SiteID: row.SiteID,
        SiteName: row.SiteName,
        Latitude: parseFloat(row.Latitude),
        Longitude: parseFloat(row.Longitude),
        CellCount: row.CellCount,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag,
        AnomalyScore: parseFloat(row.AnomalyScore),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get sites for map visualization
   */
  static async getMapSites(dateId?: string): Promise<MapSite[]> {
    const client = await pool.connect();
    const mapRow = (row: Record<string, unknown>): MapSite => {
      const anomalyScore = Number(row.AnomalyScore ?? row.anomaly_score ?? 0);
      let status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OUTAGE' = 'NORMAL';
      if (anomalyScore >= 0.9) status = 'OUTAGE';
      else if (anomalyScore >= 0.85) status = 'CRITICAL';
      else if (anomalyScore >= 0.75) status = 'WARNING';
      return {
        siteId: String(row.SiteID ?? row.site_id),
        siteName: String(row.SiteName ?? row.site_name ?? ''),
        latitude: parseFloat(String(row.Latitude ?? row.latitude ?? 0)),
        longitude: parseFloat(String(row.Longitude ?? row.longitude ?? 0)),
        cellCount: Number(row.CellCount ?? row.cell_num ?? 0),
        status,
        anomalyCount: row.AnomalyFlag ?? row.anomaly_flag ? 1 : 0,
        hasActiveTickets: parseInt(String(row.ticket_count ?? 0), 10) > 0,
      };
    };

    try {
      // Use filtered_sites view (curated sites) with no limit
      const query = `
        SELECT
          s."SiteID",
          s."SiteName",
          s."Latitude",
          s."Longitude",
          s."CellCount",
          s."AnomalyFlag",
          s."AnomalyScore",
          s."ClusterID",
          COUNT(DISTINCT t.id) as ticket_count
        FROM filtered_sites s
        LEFT JOIN ticket_table t ON s."SiteID" = t."SiteID"
          AND t."TICKET_STATUS" IN ('Work In Progress', 'Assigned')
        WHERE s."Latitude" IS NOT NULL
          AND s."Longitude" IS NOT NULL
          AND s."Latitude"::text != 'NaN'
          AND s."Longitude"::text != 'NaN'
        GROUP BY s."SiteID", s."SiteName", s."Latitude", s."Longitude",
                 s."CellCount", s."AnomalyFlag", s."AnomalyScore", s."ClusterID"
        ORDER BY s."DistanceFromUnionCity"
      `;
      const result = await client.query(query);
      logger.info(`✅ Fetched ${result.rows.length} sites for map from filtered_sites`);
      if (result.rows.length < 200) {
        logger.warn(`⚠️ WARNING: Only ${result.rows.length} sites returned. Check filtered_sites table size.`);
      }
      return result.rows.map(row => mapRow(row as Record<string, unknown>));
    } catch (err: unknown) {
      const msg = err && typeof (err as Error).message === 'string' ? (err as Error).message : '';
      if (msg.includes('filtered_sites') && (msg.includes('does not exist') || msg.includes('relation'))) {
        // Fallback: use site_table with lowercase columns
        logger.warn('filtered_sites not found; using site_table for map sites');
        const fallback = `
          SELECT
            s.site_id,
            s.site_name,
            s.latitude,
            s.longitude,
            s.cell_num,
            s.anomaly_flag,
            s.anomaly_score,
            s.clusterid,
            COUNT(DISTINCT t.id) as ticket_count
          FROM site_table s
          LEFT JOIN ticket_table t ON s.site_id = t.site_id
            AND t.ticket_status IN ('Work In Progress', 'Assigned')
          WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
          GROUP BY s.site_id, s.site_name, s.latitude, s.longitude,
                   s.cell_num, s.anomaly_flag, s.anomaly_score, s.clusterid
          ORDER BY s.site_id
        `;
        const res = await client.query(fallback);
        logger.info(`Fetched ${res.rows.length} sites for map (site_table fallback)`);
        return res.rows.map(row => mapRow(row as Record<string, unknown>));
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Search sites by name or ID
   */
  static async searchSites(searchTerm: string, limit: number = 10): Promise<Site[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT "SiteID", "SiteName", "Latitude", "Longitude", 
               "CellCount", "DateID", "AnomalyFlag", "AnomalyScore"
        FROM site_table
        WHERE "DateID" = (SELECT MAX("DateID") FROM site_table)
        AND ("SiteID" ILIKE $1 OR "SiteName" ILIKE $1)
        ORDER BY "SiteID"
        LIMIT $2
      `;
      
      const result = await client.query(query, [`%${searchTerm}%`, limit]);
      
      return result.rows.map(row => ({
        SiteID: row.SiteID,
        SiteName: row.SiteName,
        Latitude: parseFloat(row.Latitude),
        Longitude: parseFloat(row.Longitude),
        CellCount: row.CellCount,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag || false,
        AnomalyScore: parseFloat(row.AnomalyScore) || 0,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get date range available in database
   */
  static async getAvailableDates(): Promise<string[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT DISTINCT "DateID"
        FROM site_table
        ORDER BY "DateID" DESC
        LIMIT 10
      `;
      
      const result = await client.query(query);
      return result.rows.map(row => row.DateID);
    } finally {
      client.release();
    }
  }
}
