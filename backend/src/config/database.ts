/**
 * PostgreSQL Database Configuration
 * Connection pool for all database operations
 */
import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

const config: DatabaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5435'),
  database: process.env.DB_NAME || 'naavik_demo',
  user: process.env.DB_USER || 'naavik_user',
  password: process.env.DB_PASSWORD || 'naavik_pass_2026',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Create connection pool
export const pool = new Pool(config);

// Test connection on startup
pool.on('connect', () => {
  logger.info('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', err);
});

/**
 * Test database connection
 */
export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, current_database() as db');
    const { now, db } = result.rows[0];
    
    logger.info(`Database connection successful: ${db} at ${now}`);
    
    client.release();
    return true;
  } catch (error) {
    logger.error('Database connection failed', error);
    return false;
  }
};

/**
 * Initialize demo data if needed
 * Note: getMapSites() queries site_table directly, so no view is needed
 */
export const initializeDemoViews = async () => {
  // This function is kept for backward compatibility but is now a no-op
  // since getMapSites() queries site_table directly instead of a view
  logger.info('Demo view initialization (skipped - using direct queries)');
};

/**
 * Get table row counts for monitoring
 */
export const getTableCounts = async () => {
  const client = await pool.connect();
  
  try {
    const tables = [
      'cell_table',
      'site_table',
      'intermediate_kpi_table',
      'subcomponent_table',
      'cqx_offenders_truth_table',
      'sector_table',
      'ticket_table',
      'eim_table',
      'deployed_applications',
      'provisioning_history',
      'agent_activity_log'
    ];
    
    const counts: Record<string, number> = {};
    
    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        counts[table] = parseInt(result.rows[0].count);
      } catch (error) {
        counts[table] = 0;
      }
    }
    
    return counts;
  } finally {
    client.release();
  }
};

/**
 * Close all connections (for graceful shutdown)
 */
export const closePool = async (): Promise<void> => {
  await pool.end();
  logger.info('Database pool closed');
};
