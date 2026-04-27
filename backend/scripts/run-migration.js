import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/config/database.js';
import { logger } from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
  const migrationPath = path.join(__dirname, '../../database/06-add-user-context-columns.sql');

  try {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    logger.info('Running migration...');

    await pool.query(sql);

    logger.info('✓ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
