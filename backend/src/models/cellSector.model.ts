/**
 * Cell Sector Model - Queries the filtered_cell_sector_map_view (30 miles from Union City)
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

export interface CellSector {
  CellID: string;
  CellName: string;
  SiteID: string;
  SiteName: string;
  Technology: string;
  Carrier: string;
  Azimuth: number;
  Height: number;
  SiteLatitude: number;
  SiteLongitude: number;
  CellLatitude: number;
  CellLongitude: number;
  CellAnomalyFlag: boolean;
  CellAnomalyScore: number;
  SiteAnomalyFlag: boolean;
  SiteAnomalyScore: number;
  CellCount: number;
  DateID: string;
}

export class CellSectorModel {
  /**
   * Get all cell sectors for map visualization
   */
  static async getAllSectors(dateId?: string, limit?: number): Promise<CellSector[]> {
    const client = await pool.connect();
    
    try {
      // Get the DateID with substantial data
      let targetDateId = dateId;
      if (!targetDateId) {
        const dateResult = await client.query(`
          SELECT "DateID" 
          FROM filtered_cell_sector_map_view
          GROUP BY "DateID" 
          HAVING COUNT(*) > 100
          ORDER BY "DateID" DESC 
          LIMIT 1
        `);
        targetDateId = dateResult.rows[0]?.DateID;
      }
      
      const query = `
        SELECT 
          "CellID",
          "CellName",
          "SiteID",
          "SiteName",
          "Technology",
          "Carrier",
          CAST("Azimuth" AS NUMERIC) as "Azimuth",
          CAST("Height" AS NUMERIC) as "Height",
          CAST("SiteLatitude" AS NUMERIC) as "SiteLatitude",
          CAST("SiteLongitude" AS NUMERIC) as "SiteLongitude",
          CAST("CellLatitude" AS NUMERIC) as "CellLatitude",
          CAST("CellLongitude" AS NUMERIC) as "CellLongitude",
          "CellAnomalyFlag",
          CAST("CellAnomalyScore" AS NUMERIC) as "CellAnomalyScore",
          "SiteAnomalyFlag",
          CAST("SiteAnomalyScore" AS NUMERIC) as "SiteAnomalyScore",
          "CellCount",
          "DateID"
        FROM filtered_cell_sector_map_view
        WHERE "DateID" = $1
        ORDER BY "SiteID", "CellID"
        ${limit ? `LIMIT ${limit}` : ''}
      `;
      
      const result = await client.query(query, [targetDateId]);
      
      logger.info(`Fetched ${result.rows.length} cell sectors for map (DateID: ${targetDateId})`);
      
      return result.rows.map(row => ({
        CellID: row.CellID,
        CellName: row.CellName,
        SiteID: row.SiteID,
        SiteName: row.SiteName,
        Technology: row.Technology,
        Carrier: row.Carrier,
        Azimuth: parseFloat(row.Azimuth),
        Height: parseFloat(row.Height),
        SiteLatitude: parseFloat(row.SiteLatitude),
        SiteLongitude: parseFloat(row.SiteLongitude),
        CellLatitude: parseFloat(row.CellLatitude),
        CellLongitude: parseFloat(row.CellLongitude),
        CellAnomalyFlag: row.CellAnomalyFlag,
        CellAnomalyScore: parseFloat(row.CellAnomalyScore),
        SiteAnomalyFlag: row.SiteAnomalyFlag,
        SiteAnomalyScore: parseFloat(row.SiteAnomalyScore),
        CellCount: row.CellCount,
        DateID: row.DateID,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get sectors for a specific site
   */
  static async getSectorsBySite(siteId: string, dateId?: string): Promise<CellSector[]> {
    const client = await pool.connect();
    
    try {
      let targetDateId = dateId;
      if (!targetDateId) {
        const dateResult = await client.query(`
          SELECT "DateID" 
          FROM filtered_cell_sector_map_view
          WHERE "SiteID" = $1
          ORDER BY "DateID" DESC 
          LIMIT 1
        `, [siteId]);
        targetDateId = dateResult.rows[0]?.DateID;
      }
      
      const query = `
        SELECT 
          "CellID",
          "CellName",
          "SiteID",
          "SiteName",
          "Technology",
          "Carrier",
          CAST("Azimuth" AS NUMERIC) as "Azimuth",
          CAST("Height" AS NUMERIC) as "Height",
          CAST("SiteLatitude" AS NUMERIC) as "SiteLatitude",
          CAST("SiteLongitude" AS NUMERIC) as "SiteLongitude",
          CAST("CellLatitude" AS NUMERIC) as "CellLatitude",
          CAST("CellLongitude" AS NUMERIC) as "CellLongitude",
          "CellAnomalyFlag",
          CAST("CellAnomalyScore" AS NUMERIC) as "CellAnomalyScore",
          "SiteAnomalyFlag",
          CAST("SiteAnomalyScore" AS NUMERIC) as "SiteAnomalyScore",
          "CellCount",
          "DateID"
        FROM filtered_cell_sector_map_view
        WHERE "SiteID" = $1 AND "DateID" = $2
        ORDER BY "CellID"
      `;
      
      const result = await client.query(query, [siteId, targetDateId]);
      
      return result.rows.map(row => ({
        CellID: row.CellID,
        CellName: row.CellName,
        SiteID: row.SiteID,
        SiteName: row.SiteName,
        Technology: row.Technology,
        Carrier: row.Carrier,
        Azimuth: parseFloat(row.Azimuth),
        Height: parseFloat(row.Height),
        SiteLatitude: parseFloat(row.SiteLatitude),
        SiteLongitude: parseFloat(row.SiteLongitude),
        CellLatitude: parseFloat(row.CellLatitude),
        CellLongitude: parseFloat(row.CellLongitude),
        CellAnomalyFlag: row.CellAnomalyFlag,
        CellAnomalyScore: parseFloat(row.CellAnomalyScore),
        SiteAnomalyFlag: row.SiteAnomalyFlag,
        SiteAnomalyScore: parseFloat(row.SiteAnomalyScore),
        CellCount: row.CellCount,
        DateID: row.DateID,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get statistics about cell sectors
   */
  static async getSectorStats(): Promise<any> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total_sectors,
          COUNT(DISTINCT "SiteID") as sites_with_sectors,
          COUNT(DISTINCT CASE WHEN "CellAnomalyFlag" = true THEN "CellID" END) as anomalous_sectors,
          AVG(CAST("Azimuth" AS NUMERIC)) as avg_azimuth
        FROM filtered_cell_sector_map_view
        WHERE "DateID" = (
          SELECT "DateID" 
          FROM filtered_cell_sector_map_view 
          GROUP BY "DateID" 
          HAVING COUNT(*) > 100 
          ORDER BY "DateID" DESC 
          LIMIT 1
        )
      `;
      
      const result = await client.query(query);
      return result.rows[0];
    } finally {
      client.release();
    }
  }
}
