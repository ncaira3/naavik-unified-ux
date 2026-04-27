/**
 * Cell Model - Database queries for cell data
 */
import { pool } from '../config/database.js';
import { Cell } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class CellModel {
  /**
   * Get all cells for a specific site
   */
  static async getCellsBySite(siteId: string, dateId?: string): Promise<Cell[]> {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT "CellID", "CellName", "SiteID", "Technology", "Carrier",
               "NumKPIs", "Latitude", "Longitude", "Azimuth", "DateID",
               "AnomalyFlag", "AnomalyScore"
        FROM filtered_cell_table
        WHERE "SiteID" = $1
      `;
      
      const params: any[] = [siteId];
      
      if (dateId) {
        query += ` AND "DateID" = $2`;
        params.push(dateId);
      } else {
        query += ` AND "DateID" = (SELECT MAX("DateID") FROM cell_table WHERE "SiteID" = $1)`;
      }
      
      query += ` ORDER BY "CellName"`;
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        CellID: row.CellID,
        CellName: row.CellName,
        SiteID: row.SiteID,
        Technology: row.Technology,
        Carrier: row.Carrier,
        NumKPIs: row.NumKPIs,
        Latitude: row.Latitude ? parseFloat(row.Latitude) : undefined,
        Longitude: row.Longitude ? parseFloat(row.Longitude) : undefined,
        Azimuth: row.Azimuth ? parseFloat(row.Azimuth) : undefined,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag || false,
        AnomalyScore: parseFloat(row.AnomalyScore) || 0,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get cell by ID
   */
  static async getCellById(cellId: string): Promise<Cell | null> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT "CellID", "CellName", "SiteID", "Technology", "Carrier",
               "NumKPIs", "Latitude", "Longitude", "Azimuth", "DateID",
               "AnomalyFlag", "AnomalyScore"
        FROM filtered_cell_table
        WHERE "CellID" = $1
        AND "DateID" = (SELECT MAX("DateID") FROM filtered_cell_table WHERE "CellID" = $1)
      `;
      
      const result = await client.query(query, [cellId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        CellID: row.CellID,
        CellName: row.CellName,
        SiteID: row.SiteID,
        Technology: row.Technology,
        Carrier: row.Carrier,
        NumKPIs: row.NumKPIs,
        Latitude: row.Latitude ? parseFloat(row.Latitude) : undefined,
        Longitude: row.Longitude ? parseFloat(row.Longitude) : undefined,
        Azimuth: row.Azimuth ? parseFloat(row.Azimuth) : undefined,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag || false,
        AnomalyScore: parseFloat(row.AnomalyScore) || 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get cells by technology type
   */
  static async getCellsByTechnology(technology: string, limit: number = 100): Promise<Cell[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT "CellID", "CellName", "SiteID", "Technology", "Carrier",
               "NumKPIs", "DateID", "AnomalyFlag", "AnomalyScore"
        FROM cell_table
        WHERE "Technology" = $1
        AND "DateID" = (SELECT MAX("DateID") FROM cell_table)
        ORDER BY "SiteID", "CellName"
        LIMIT $2
      `;
      
      const result = await client.query(query, [technology, limit]);
      
      return result.rows.map(row => ({
        CellID: row.CellID,
        CellName: row.CellName,
        SiteID: row.SiteID,
        Technology: row.Technology,
        Carrier: row.Carrier,
        NumKPIs: row.NumKPIs,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag || false,
        AnomalyScore: parseFloat(row.AnomalyScore) || 0,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get technology breakdown statistics
   */
  static async getTechnologyStats(): Promise<Record<string, number>> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT "Technology", COUNT(*) as count
        FROM cell_table
        WHERE "DateID" = (SELECT MAX("DateID") FROM cell_table)
        GROUP BY "Technology"
        ORDER BY COUNT(*) DESC
      `;
      
      const result = await client.query(query);
      
      const stats: Record<string, number> = {};
      result.rows.forEach(row => {
        stats[row.Technology] = parseInt(row.count);
      });
      
      return stats;
    } finally {
      client.release();
    }
  }

  /**
   * Get cells with anomalies
   */
  static async getAnomalousCells(siteId?: string): Promise<Cell[]> {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT "CellID", "CellName", "SiteID", "Technology", "Carrier",
               "NumKPIs", "DateID", "AnomalyFlag", "AnomalyScore"
        FROM cell_table
        WHERE "AnomalyFlag" = true
        AND "DateID" = (SELECT MAX("DateID") FROM cell_table)
      `;
      
      const params: any[] = [];
      
      if (siteId) {
        query += ` AND "SiteID" = $1`;
        params.push(siteId);
      }
      
      query += ` ORDER BY "AnomalyScore" DESC LIMIT 50`;
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        CellID: row.CellID,
        CellName: row.CellName,
        SiteID: row.SiteID,
        Technology: row.Technology,
        Carrier: row.Carrier,
        NumKPIs: row.NumKPIs,
        DateID: row.DateID,
        AnomalyFlag: row.AnomalyFlag,
        AnomalyScore: parseFloat(row.AnomalyScore),
      }));
    } finally {
      client.release();
    }
  }
}
