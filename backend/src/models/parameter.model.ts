/**
 * Parameter Data Model
 * Handles database operations for Ericsson parameters
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

export interface Parameter {
  parameterId: number;
  model: string | null;
  moClass: string | null;
  parameterName: string;
  parameterDescription: string | null;
  dataType: string | null;
  rangeValues: string | null;
  defaultValue: string | null;
  multiplicationFactor: string | null;
  unit: string | null;
  resolution: string | null;
  readOnly: boolean;
  restricted: boolean;
  mandatory: boolean;
  persistent: boolean;
  systemCreated: boolean;
  changeTakeEffect: string | null;
  disturbances: string | null;
  dependencies: string | null;
  deprecated: boolean;
  obsolete: boolean;
  precondition: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParameterSearchFilters {
  moClass?: string;
  search?: string;
  readOnly?: boolean;
  mandatory?: boolean;
  deprecated?: boolean;
  model?: string;
  limit?: number;
  offset?: number;
}

export class ParameterModel {
  /**
   * Get parameter by ID
   */
  static async getById(parameterId: number): Promise<Parameter | null> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          parameter_id as "parameterId",
          model,
          mo_class as "moClass",
          parameter_name as "parameterName",
          parameter_description as "parameterDescription",
          data_type as "dataType",
          range_values as "rangeValues",
          default_value as "defaultValue",
          multiplication_factor as "multiplicationFactor",
          unit,
          resolution,
          read_only as "readOnly",
          restricted,
          mandatory,
          persistent,
          system_created as "systemCreated",
          change_take_effect as "changeTakeEffect",
          disturbances,
          dependencies,
          deprecated,
          obsolete,
          precondition,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM parameter_table
         WHERE parameter_id = $1`,
        [parameterId]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }
  
  /**
   * Search parameters with filters
   */
  static async search(filters: ParameterSearchFilters): Promise<{
    parameters: Parameter[];
    total: number;
  }> {
    const client = await pool.connect();
    try {
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      // Build WHERE clause
      if (filters.moClass) {
        conditions.push(`mo_class = $${paramIndex++}`);
        values.push(filters.moClass);
      }
      
      if (filters.search) {
        conditions.push(`(
          parameter_name ILIKE $${paramIndex} OR 
          parameter_description ILIKE $${paramIndex} OR
          mo_class ILIKE $${paramIndex}
        )`);
        values.push(`%${filters.search}%`);
        paramIndex++;
      }
      
      if (filters.readOnly !== undefined) {
        conditions.push(`read_only = $${paramIndex++}`);
        values.push(filters.readOnly);
      }
      
      if (filters.mandatory !== undefined) {
        conditions.push(`mandatory = $${paramIndex++}`);
        values.push(filters.mandatory);
      }
      
      if (filters.deprecated !== undefined) {
        conditions.push(`deprecated = $${paramIndex++}`);
        values.push(filters.deprecated);
      }
      
      if (filters.model) {
        conditions.push(`model = $${paramIndex++}`);
        values.push(filters.model);
      }
      
      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      
      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) FROM parameter_table ${whereClause}`,
        values
      );
      const total = parseInt(countResult.rows[0].count);
      
      // Get paginated results
      const limit = filters.limit || 50;
      const offset = filters.offset || 0;
      
      const result = await client.query(
        `SELECT 
          parameter_id as "parameterId",
          model,
          mo_class as "moClass",
          parameter_name as "parameterName",
          parameter_description as "parameterDescription",
          data_type as "dataType",
          range_values as "rangeValues",
          default_value as "defaultValue",
          unit,
          read_only as "readOnly",
          mandatory,
          deprecated
         FROM parameter_table
         ${whereClause}
         ORDER BY mo_class, parameter_name
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset]
      );
      
      return {
        parameters: result.rows,
        total
      };
    } finally {
      client.release();
    }
  }
  
  /**
   * Get all MO classes
   */
  static async getMOClasses(): Promise<string[]> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT DISTINCT mo_class
         FROM parameter_table
         WHERE mo_class IS NOT NULL
         ORDER BY mo_class`
      );
      
      return result.rows.map(row => row.mo_class);
    } finally {
      client.release();
    }
  }
  
  /**
   * Get parameters for a specific MO class
   */
  static async getByMOClass(moClass: string): Promise<Parameter[]> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          parameter_id as "parameterId",
          model,
          mo_class as "moClass",
          parameter_name as "parameterName",
          parameter_description as "parameterDescription",
          data_type as "dataType",
          range_values as "rangeValues",
          default_value as "defaultValue",
          unit,
          read_only as "readOnly",
          mandatory,
          deprecated
         FROM parameter_table
         WHERE mo_class = $1
         ORDER BY parameter_name`,
        [moClass]
      );
      
      return result.rows;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get parameter statistics
   */
  static async getStatistics(): Promise<{
    totalParameters: number;
    byMOClass: Array<{ moClass: string; count: number }>;
    readOnlyCount: number;
    mandatoryCount: number;
    deprecatedCount: number;
  }> {
    const client = await pool.connect();
    try {
      // Total count
      const totalResult = await client.query(
        'SELECT COUNT(*) FROM parameter_table'
      );
      const totalParameters = parseInt(totalResult.rows[0].count);
      
      // By MO Class
      const moClassResult = await client.query(
        `SELECT mo_class as "moClass", COUNT(*) as count
         FROM parameter_table
         WHERE mo_class IS NOT NULL
         GROUP BY mo_class
         ORDER BY count DESC
         LIMIT 20`
      );
      
      // Counts by attributes
      const readOnlyResult = await client.query(
        'SELECT COUNT(*) FROM parameter_table WHERE read_only = true'
      );
      const mandatoryResult = await client.query(
        'SELECT COUNT(*) FROM parameter_table WHERE mandatory = true'
      );
      const deprecatedResult = await client.query(
        'SELECT COUNT(*) FROM parameter_table WHERE deprecated = true'
      );
      
      return {
        totalParameters,
        byMOClass: moClassResult.rows.map(row => ({
          moClass: row.moClass,
          count: parseInt(row.count)
        })),
        readOnlyCount: parseInt(readOnlyResult.rows[0].count),
        mandatoryCount: parseInt(mandatoryResult.rows[0].count),
        deprecatedCount: parseInt(deprecatedResult.rows[0].count)
      };
    } finally {
      client.release();
    }
  }
}
