/**
 * Generated App Data Model
 * Handles database operations for EIAP applications
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

export interface GeneratedApp {
  appId: string;
  appName: string;
  description: string | null;
  naturalLanguageInput: string | null;
  generatedCode: string | null;
  workflowJson: any | null;
  moClasses: string[] | null;
  parametersUsed: string[] | null;
  kpisUsed: string[] | null;
  status: 'draft' | 'validated' | 'deployed' | 'running' | 'failed' | 'archived';
  deploymentTarget: 'ERICSSON_EIAP' | 'NOKIA_EDEN' | 'AIRA_NATIVE' | 'NAAVIK_STORE';
  createdBy: string | null;
  isPredefined: boolean;
  executionCount: number;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppData {
  appName: string;
  description?: string;
  naturalLanguageInput?: string;
  generatedCode?: string;
  workflowJson?: any;
  moClasses?: string[];
  parametersUsed?: string[];
  kpisUsed?: string[];
  status?: string;
  deploymentTarget?: string;
  createdBy?: string;
  isPredefined?: boolean;
}

export interface UpdateAppData {
  appName?: string;
  description?: string;
  generatedCode?: string;
  workflowJson?: any;
  status?: string;
  deploymentTarget?: string;
  moClasses?: string[];
  parametersUsed?: string[];
  kpisUsed?: string[];
}

export interface AppSearchFilters {
  status?: string;
  deploymentTarget?: string;
  createdBy?: string;
  isPredefined?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class GeneratedAppModel {
  /**
   * Create a new app
   */
  static async create(data: CreateAppData): Promise<GeneratedApp> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO generated_app_table (
          app_name, description, natural_language_input, generated_code,
          workflow_json, mo_classes, parameters_used, kpis_used,
          status, deployment_target, created_by, is_predefined
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING 
          app_id as "appId",
          app_name as "appName",
          description,
          natural_language_input as "naturalLanguageInput",
          generated_code as "generatedCode",
          workflow_json as "workflowJson",
          mo_classes as "moClasses",
          parameters_used as "parametersUsed",
          kpis_used as "kpisUsed",
          status,
          deployment_target as "deploymentTarget",
          created_by as "createdBy",
          is_predefined as "isPredefined",
          execution_count as "executionCount",
          last_executed_at as "lastExecutedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"`,
        [
          data.appName,
          data.description || null,
          data.naturalLanguageInput || null,
          data.generatedCode || null,
          data.workflowJson ? JSON.stringify(data.workflowJson) : null,
          data.moClasses || null,
          data.parametersUsed || null,
          data.kpisUsed || null,
          data.status || 'draft',
          data.deploymentTarget || 'ERICSSON_EIAP',
          data.createdBy || null,
          data.isPredefined || false
        ]
      );
      
      logger.info(`Created app: ${result.rows[0].appName} (${result.rows[0].appId})`);
      return result.rows[0];
    } finally {
      client.release();
    }
  }
  
  /**
   * Get app by ID
   */
  static async getById(appId: string): Promise<GeneratedApp | null> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          app_id as "appId",
          app_name as "appName",
          description,
          natural_language_input as "naturalLanguageInput",
          generated_code as "generatedCode",
          workflow_json as "workflowJson",
          mo_classes as "moClasses",
          parameters_used as "parametersUsed",
          kpis_used as "kpisUsed",
          status,
          deployment_target as "deploymentTarget",
          created_by as "createdBy",
          is_predefined as "isPredefined",
          execution_count as "executionCount",
          last_executed_at as "lastExecutedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM generated_app_table
         WHERE app_id = $1`,
        [appId]
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get app by name
   */
  static async getByName(appName: string, createdBy?: string): Promise<GeneratedApp | null> {
    const client = await pool.connect();
    try {
      const query = createdBy
        ? `SELECT * FROM generated_app_table 
           WHERE app_name = $1 AND created_by = $2
           ORDER BY created_at DESC LIMIT 1`
        : `SELECT * FROM generated_app_table 
           WHERE app_name = $1
           ORDER BY created_at DESC LIMIT 1`;
      
      const params = createdBy ? [appName, createdBy] : [appName];
      
      const result = await client.query(query, params);
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        appId: row.app_id,
        appName: row.app_name,
        description: row.description,
        naturalLanguageInput: row.natural_language_input,
        generatedCode: row.generated_code,
        workflowJson: row.workflow_json,
        moClasses: row.mo_classes,
        parametersUsed: row.parameters_used,
        kpisUsed: row.kpis_used,
        status: row.status,
        deploymentTarget: row.deployment_target,
        createdBy: row.created_by,
        isPredefined: row.is_predefined,
        executionCount: row.execution_count,
        lastExecutedAt: row.last_executed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } finally {
      client.release();
    }
  }
  
  /**
   * Update app
   */
  static async update(appId: string, data: UpdateAppData): Promise<GeneratedApp | null> {
    const client = await pool.connect();
    try {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      if (data.appName !== undefined) {
        updates.push(`app_name = $${paramIndex++}`);
        values.push(data.appName);
      }
      
      if (data.description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(data.description);
      }
      
      if (data.generatedCode !== undefined) {
        updates.push(`generated_code = $${paramIndex++}`);
        values.push(data.generatedCode);
      }
      
      if (data.workflowJson !== undefined) {
        updates.push(`workflow_json = $${paramIndex++}`);
        values.push(JSON.stringify(data.workflowJson));
      }
      
      if (data.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(data.status);
      }

      if (data.deploymentTarget !== undefined) {
        updates.push(`deployment_target = $${paramIndex++}`);
        values.push(data.deploymentTarget);
      }
      
      if (data.moClasses !== undefined) {
        updates.push(`mo_classes = $${paramIndex++}`);
        values.push(data.moClasses);
      }
      
      if (data.parametersUsed !== undefined) {
        updates.push(`parameters_used = $${paramIndex++}`);
        values.push(data.parametersUsed);
      }
      
      if (data.kpisUsed !== undefined) {
        updates.push(`kpis_used = $${paramIndex++}`);
        values.push(data.kpisUsed);
      }
      
      if (updates.length === 0) {
        return this.getById(appId);
      }
      
      values.push(appId);
      
      const result = await client.query(
        `UPDATE generated_app_table
         SET ${updates.join(', ')}
         WHERE app_id = $${paramIndex}
         RETURNING 
          app_id as "appId",
          app_name as "appName",
          description,
          natural_language_input as "naturalLanguageInput",
          generated_code as "generatedCode",
          workflow_json as "workflowJson",
          mo_classes as "moClasses",
          parameters_used as "parametersUsed",
          kpis_used as "kpisUsed",
          status,
          deployment_target as "deploymentTarget",
          created_by as "createdBy",
          is_predefined as "isPredefined",
          execution_count as "executionCount",
          last_executed_at as "lastExecutedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"`,
        values
      );
      
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }
  
  /**
   * Delete app
   */
  static async delete(appId: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM generated_app_table WHERE app_id = $1',
        [appId]
      );
      
      return (result.rowCount || 0) > 0;
    } finally {
      client.release();
    }
  }
  
  /**
   * Search apps with filters
   */
  static async search(filters: AppSearchFilters): Promise<{
    apps: GeneratedApp[];
    total: number;
  }> {
    const client = await pool.connect();
    try {
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      if (filters.status) {
        conditions.push(`status = $${paramIndex++}`);
        values.push(filters.status);
      }
      
      if (filters.deploymentTarget) {
        conditions.push(`deployment_target = $${paramIndex++}`);
        values.push(filters.deploymentTarget);
      }
      
      if (filters.createdBy) {
        conditions.push(`created_by = $${paramIndex++}`);
        values.push(filters.createdBy);
      }
      
      if (filters.isPredefined !== undefined) {
        conditions.push(`is_predefined = $${paramIndex++}`);
        values.push(filters.isPredefined);
      }
      
      if (filters.search) {
        conditions.push(`(
          app_name ILIKE $${paramIndex} OR 
          description ILIKE $${paramIndex} OR
          natural_language_input ILIKE $${paramIndex}
        )`);
        values.push(`%${filters.search}%`);
        paramIndex++;
      }
      
      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      
      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) FROM generated_app_table ${whereClause}`,
        values
      );
      const total = parseInt(countResult.rows[0].count);
      
      // Get paginated results
      const limit = filters.limit || 50;
      const offset = filters.offset || 0;
      
      const result = await client.query(
        `SELECT 
          app_id as "appId",
          app_name as "appName",
          description,
          status,
          deployment_target as "deploymentTarget",
          created_by as "createdBy",
          is_predefined as "isPredefined",
          execution_count as "executionCount",
          last_executed_at as "lastExecutedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM generated_app_table
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset]
      );
      
      return {
        apps: result.rows,
        total
      };
    } finally {
      client.release();
    }
  }
  
  /**
   * Increment execution count
   */
  static async incrementExecutionCount(appId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE generated_app_table
         SET execution_count = execution_count + 1,
             last_executed_at = NOW()
         WHERE app_id = $1`,
        [appId]
      );
    } finally {
      client.release();
    }
  }
  
  /**
   * Get app execution statistics
   */
  static async getExecutionStats(appId: string): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    lastRunAt: Date | null;
  } | null> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT 
          COUNT(*) as total_runs,
          COUNT(CASE WHEN execution_status = 'completed' THEN 1 END) as successful_runs,
          COUNT(CASE WHEN execution_status = 'failed' THEN 1 END) as failed_runs,
          AVG(duration_ms) as avg_duration_ms,
          MAX(started_at) as last_run_at
         FROM automation_execution_log
         WHERE app_id = $1`,
        [appId]
      );
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        totalRuns: parseInt(row.total_runs) || 0,
        successfulRuns: parseInt(row.successful_runs) || 0,
        failedRuns: parseInt(row.failed_runs) || 0,
        avgDurationMs: parseFloat(row.avg_duration_ms) || 0,
        lastRunAt: row.last_run_at
      };
    } finally {
      client.release();
    }
  }
}
