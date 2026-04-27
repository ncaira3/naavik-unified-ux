/**
 * Database Migration Runner
 * Runs SQL migration files against the database
 */
import { pool } from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration(migrationFile: string): Promise<void> {
  const client = await pool.connect();
  
  try {
    logger.info(`Running migration: ${migrationFile}`);
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, '../../../database', migrationFile);
    let sql = await fs.readFile(sqlPath, 'utf-8');
    
    // Remove psql-specific meta-commands (\\echo, \\set, etc.)
    sql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('\\'))
      .join('\n');
    
    // Execute the SQL (pg driver handles multiple statements in one query)
    await client.query(sql);
    
    logger.info(`✓ Migration completed successfully: ${migrationFile}`);
  } catch (error) {
    logger.error(`✗ Migration failed: ${migrationFile}`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    logger.info('Starting database migrations...');
    
    // Run the automation tables migration
    await runMigration('02-automation-tables.sql');
    
    logger.info('All migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Migration process failed', error);
    process.exit(1);
  }
}

main();
