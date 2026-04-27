/**
 * Mock ENM Connector Service
 * Simulates Ericsson Element Network Manager (ENM) connectivity
 * for EIAP app execution and network parameter management
 */
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

export interface ParameterOperation {
  cmHandleId: string;
  moClass: string;
  parameterName: string;
  value: any;
}

export interface BatchResult {
  success: boolean;
  totalOperations: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    cmHandleId: string;
    success: boolean;
    error?: string;
  }>;
}

export interface ParameterMetadata {
  parameterId: number;
  model: string | null;
  moClass: string | null;
  parameterName: string;
  parameterDescription: string | null;
  dataType: string | null;
  rangeValues: string | null;
  defaultValue: string | null;
  unit: string | null;
  readOnly: boolean;
  mandatory: boolean;
}

/**
 * Mock ENM Connector Service
 * Simulates network element interactions with realistic latency and validation
 */
export class ENMConnectorService {
  private connected: boolean = false;
  private connectionLatency: number = 200; // ms
  private operationLatency: number = 150; // ms
  
  constructor() {
    logger.info('ENM Connector Service initialized (mock mode)');
  }
  
  /**
   * Simulate ENM connection
   */
  async connect(): Promise<boolean> {
    await this.simulateLatency(this.connectionLatency);
    this.connected = true;
    logger.info('✓ Mock ENM connection established');
    return true;
  }
  
  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }
  
  /**
   * Get CM handle IDs for a specific entity type
   * Mock: Returns cell/site IDs from database based on entity type
   */
  async getCMHandleIds(entityType: string): Promise<string[]> {
    await this.simulateLatency(this.operationLatency);
    
    const client = await pool.connect();
    try {
      let query: string;
      
      switch (entityType.toLowerCase()) {
        case 'eutrancell':
        case 'eutrancellfdd':
        case 'eutrancelltdd':
          // Return SiteIDs (from cells)
          query = `
            SELECT DISTINCT "SiteID" as id
            FROM cell_table
            WHERE "SiteID" IS NOT NULL
            ORDER BY "SiteID"
            LIMIT 1000
          `;
          break;

        case 'site':
        case 'enodebfunction':
          // Return site IDs
          query = `
            SELECT DISTINCT "SiteID" as id
            FROM site_table
            WHERE "SiteID" IS NOT NULL
            ORDER BY "SiteID"
            LIMIT 1000
          `;
          break;

        default:
          logger.warn(`Unknown entity type: ${entityType}, returning SiteIDs by default`);
          query = `
            SELECT DISTINCT "SiteID" as id
            FROM cell_table
            WHERE "SiteID" IS NOT NULL
            ORDER BY "SiteID"
            LIMIT 1000
          `;
      }
      
      const result = await client.query(query);
      const ids = result.rows.map(row => row.id);
      
      logger.info(`Retrieved ${ids.length} CM handle IDs for entity type: ${entityType}`);
      return ids;
      
    } catch (error) {
      logger.error(`Failed to get CM handle IDs for ${entityType}`, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get parameter value for a specific CM handle
   * Mock: Returns default value from parameter_table or current value from a mock store
   */
  async getParameter(
    cmHandleId: string,
    moClass: string,
    parameterName: string
  ): Promise<any> {
    await this.simulateLatency(this.operationLatency);
    
    const client = await pool.connect();
    try {
      // Get parameter metadata and default value
      const result = await client.query(
        `SELECT * FROM parameter_table 
         WHERE mo_class = $1 AND parameter_name = $2 
         LIMIT 1`,
        [moClass, parameterName]
      );
      
      if (result.rows.length === 0) {
        logger.warn(`Parameter not found: ${moClass}.${parameterName}`);
        return null;
      }
      
      const param = result.rows[0];
      
      // Return default value (in real ENM, this would query the actual NE)
      const value = param.default_value;
      
      logger.debug(`Get parameter: ${cmHandleId}.${moClass}.${parameterName} = ${value}`);
      return this.parseParameterValue(value, param.data_type);
      
    } catch (error) {
      logger.error(`Failed to get parameter ${moClass}.${parameterName}`, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Set parameter value for a specific CM handle
   * Mock: Validates parameter and logs operation to execution log
   */
  async setParameter(
    cmHandleId: string,
    moClass: string,
    parameterName: string,
    value: any,
    executionId?: string
  ): Promise<boolean> {
    await this.simulateLatency(this.operationLatency);
    
    const client = await pool.connect();
    try {
      // Validate parameter exists and is writable
      const paramResult = await client.query(
        `SELECT * FROM parameter_table 
         WHERE mo_class = $1 AND parameter_name = $2 
         LIMIT 1`,
        [moClass, parameterName]
      );
      
      if (paramResult.rows.length === 0) {
        throw new Error(`Parameter not found: ${moClass}.${parameterName}`);
      }
      
      const param = paramResult.rows[0];
      
      if (param.read_only) {
        throw new Error(`Parameter is read-only: ${moClass}.${parameterName}`);
      }
      
      // Validate value against range (basic validation)
      const validatedValue = this.validateParameterValue(value, param);
      
      // Log the operation (mock: in real ENM, this would actually configure the NE)
      logger.info(`✓ Set parameter: ${cmHandleId}.${moClass}.${parameterName} = ${validatedValue}`);
      
      // Simulate 95% success rate
      const success = Math.random() > 0.05;
      
      if (!success) {
        throw new Error('Simulated network element communication failure');
      }
      
      return true;
      
    } catch (error) {
      logger.error(`Failed to set parameter ${moClass}.${parameterName}`, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get KPI value for a specific CM handle
   * Returns actual KPI data from intermediate_kpi_table
   */
  async getKPI(cmHandleId: string, kpiName: string): Promise<number | null> {
    await this.simulateLatency(this.operationLatency);
    
    const client = await pool.connect();
    try {
      // Get latest KPI value for this site
      const result = await client.query(
        `SELECT "KPIValue" as kpi_value
         FROM intermediate_kpi_table
         WHERE "SiteID" = $1 AND "KPIName" = $2
         ORDER BY "DateID" DESC
         LIMIT 1`,
        [cmHandleId, kpiName]
      );
      
      if (result.rows.length === 0) {
        logger.warn(`KPI not found: ${cmHandleId}.${kpiName}`);
        return null;
      }
      
      const value = parseFloat(result.rows[0].kpi_value);
      logger.debug(`Get KPI: ${cmHandleId}.${kpiName} = ${value}`);
      
      return isNaN(value) ? null : value;
      
    } catch (error) {
      logger.error(`Failed to get KPI ${kpiName}`, error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Batch set parameters across multiple CM handles
   */
  async batchSetParameters(
    operations: ParameterOperation[],
    executionId?: string
  ): Promise<BatchResult> {
    logger.info(`Executing batch operation: ${operations.length} parameters to set`);
    
    const results: Array<{
      cmHandleId: string;
      success: boolean;
      error?: string;
    }> = [];
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const op of operations) {
      try {
        await this.setParameter(
          op.cmHandleId,
          op.moClass,
          op.parameterName,
          op.value,
          executionId
        );
        
        results.push({
          cmHandleId: op.cmHandleId,
          success: true
        });
        successCount++;
        
      } catch (error: any) {
        results.push({
          cmHandleId: op.cmHandleId,
          success: false,
          error: error.message
        });
        failureCount++;
      }
    }
    
    const result: BatchResult = {
      success: failureCount === 0,
      totalOperations: operations.length,
      successCount,
      failureCount,
      results
    };
    
    logger.info(`Batch operation completed: ${successCount} succeeded, ${failureCount} failed`);
    
    return result;
  }
  
  /**
   * Get parameter metadata
   */
  async getParameterMetadata(
    moClass: string,
    parameterName: string
  ): Promise<ParameterMetadata | null> {
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
          mandatory
         FROM parameter_table 
         WHERE mo_class = $1 AND parameter_name = $2 
         LIMIT 1`,
        [moClass, parameterName]
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
      
    } finally {
      client.release();
    }
  }
  
  /**
   * List all parameters for an MO class
   */
  async listParameters(moClass: string): Promise<ParameterMetadata[]> {
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
          mandatory
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
   * Simulate network latency
   */
  private async simulateLatency(ms: number): Promise<void> {
    // Add some randomness (±30%)
    const actual = ms * (0.7 + Math.random() * 0.6);
    await new Promise(resolve => setTimeout(resolve, actual));
  }
  
  /**
   * Parse parameter value based on data type
   */
  private parseParameterValue(value: string | null, dataType: string | null): any {
    if (value === null) return null;
    
    if (!dataType) return value;
    
    const type = dataType.toLowerCase();
    
    if (type.includes('int') || type.includes('long')) {
      return parseInt(value);
    }
    
    if (type.includes('float') || type.includes('double')) {
      return parseFloat(value);
    }
    
    if (type.includes('bool')) {
      return value.toLowerCase() === 'true';
    }
    
    return value;
  }
  
  /**
   * Validate parameter value against constraints
   */
  private validateParameterValue(value: any, param: any): any {
    // Basic type validation
    if (param.data_type) {
      const type = param.data_type.toLowerCase();
      
      if (type.includes('int') && !Number.isInteger(Number(value))) {
        throw new Error(`Value must be an integer: ${value}`);
      }
      
      if (type.includes('bool') && typeof value !== 'boolean') {
        throw new Error(`Value must be boolean: ${value}`);
      }
    }
    
    // Range validation (if range is specified)
    if (param.range_values) {
      // Parse range (e.g., "-140..-43", "0..100", "true|false")
      const range = param.range_values;
      
      if (range.includes('..')) {
        const [min, max] = range.split('..').map(Number);
        const numValue = Number(value);
        
        if (!isNaN(min) && !isNaN(max) && !isNaN(numValue)) {
          if (numValue < min || numValue > max) {
            throw new Error(`Value ${value} out of range [${min}, ${max}]`);
          }
        }
      }
    }
    
    return value;
  }
  
  /**
   * Disconnect from ENM (cleanup)
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('ENM connection closed');
  }
}

// Singleton instance
let enmConnectorInstance: ENMConnectorService | null = null;

export const getENMConnector = (): ENMConnectorService => {
  if (!enmConnectorInstance) {
    enmConnectorInstance = new ENMConnectorService();
  }
  return enmConnectorInstance;
};
