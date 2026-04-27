/**
 * Import Ericsson Parameters from Excel
 * Reads ericsson_parameters.xlsx and imports into parameter_table
 */
import { pool } from '../config/database.js';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParameterRow {
  Model?: string;
  'MO Class'?: string;
  'Parameter Name'?: string;
  'Parameter Description'?: string;
  'Data Type'?: string;
  'Range and Values'?: string;
  'Default Value'?: string;
  MultiplicationFactor?: string;
  Unit?: string;
  Resolution?: string;
  ReadOnly?: string;
  Restricted?: string;
  Mandatory?: string;
  Persistent?: string;
  SystemCreated?: string;
  'Change Take Effect'?: string;
  Disturbances?: string;
  Dependencies?: string;
  Deprecated?: string;
  Obsolete?: string;
  Precondition?: string;
}

function parseBooleanValue(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === 'yes' || lower === '1';
  }
  return false;
}

function normalizeValue(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim();
}

async function importParameters(): Promise<void> {
  const client = await pool.connect();
  
  try {
    logger.info('Starting parameter import...');
    
    // Read Excel file
    const excelPath = path.join(__dirname, '../../../dummy_data/ericsson_parameters.xlsx');
    logger.info(`Reading Excel file: ${excelPath}`);
    
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data: ParameterRow[] = xlsx.utils.sheet_to_json(worksheet);
    logger.info(`Found ${data.length} parameters to import`);
    
    // Clear existing data (optional - remove if you want to preserve existing data)
    logger.info('Clearing existing parameters...');
    await client.query('TRUNCATE TABLE parameter_table RESTART IDENTITY CASCADE');
    
    // Prepare batch insert
    const batchSize = 100;
    let imported = 0;
    let skipped = 0;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Build VALUES clause for batch insert
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;
      
      for (const row of batch) {
        // Skip rows without parameter name
        if (!row['Parameter Name']) {
          skipped++;
          continue;
        }
        
        const rowValues = [
          normalizeValue(row.Model),
          normalizeValue(row['MO Class']),
          normalizeValue(row['Parameter Name']),
          normalizeValue(row['Parameter Description']),
          normalizeValue(row['Data Type']),
          normalizeValue(row['Range and Values']),
          normalizeValue(row['Default Value']),
          normalizeValue(row.MultiplicationFactor),
          normalizeValue(row.Unit),
          normalizeValue(row.Resolution),
          parseBooleanValue(row.ReadOnly),
          parseBooleanValue(row.Restricted),
          parseBooleanValue(row.Mandatory),
          parseBooleanValue(row.Persistent),
          parseBooleanValue(row.SystemCreated),
          normalizeValue(row['Change Take Effect']),
          normalizeValue(row.Disturbances),
          normalizeValue(row.Dependencies),
          parseBooleanValue(row.Deprecated),
          parseBooleanValue(row.Obsolete),
          normalizeValue(row.Precondition)
        ];
        
        values.push(...rowValues);
        
        const placeholder = `(${Array.from({ length: 21 }, (_, idx) => `$${paramIndex + idx}`).join(', ')})`;
        placeholders.push(placeholder);
        paramIndex += 21;
        imported++;
      }
      
      if (placeholders.length > 0) {
        const insertSQL = `
          INSERT INTO parameter_table (
            model, mo_class, parameter_name, parameter_description,
            data_type, range_values, default_value, multiplication_factor,
            unit, resolution, read_only, restricted, mandatory, persistent,
            system_created, change_take_effect, disturbances, dependencies,
            deprecated, obsolete, precondition
          ) VALUES ${placeholders.join(', ')}
        `;
        
        await client.query(insertSQL, values);
        logger.info(`Imported batch: ${i + batch.length}/${data.length} (${Math.round((i + batch.length) / data.length * 100)}%)`);
      }
    }
    
    // Create indexes if they don't exist (they should from migration)
    logger.info('Ensuring indexes exist...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_parameter_mo_class ON parameter_table(mo_class);
      CREATE INDEX IF NOT EXISTS idx_parameter_name ON parameter_table(parameter_name);
      CREATE INDEX IF NOT EXISTS idx_parameter_model ON parameter_table(model);
    `);
    
    // Get final count
    const countResult = await client.query('SELECT COUNT(*) FROM parameter_table');
    const finalCount = parseInt(countResult.rows[0].count);
    
    logger.info('✓ Parameter import completed!');
    logger.info(`  - Total parameters imported: ${imported}`);
    logger.info(`  - Parameters skipped: ${skipped}`);
    logger.info(`  - Final database count: ${finalCount}`);
    
    // Show sample statistics
    const statsResult = await client.query(`
      SELECT 
        mo_class,
        COUNT(*) as param_count
      FROM parameter_table
      WHERE mo_class IS NOT NULL
      GROUP BY mo_class
      ORDER BY param_count DESC
      LIMIT 10
    `);
    
    logger.info('Top 10 MO Classes by parameter count:');
    statsResult.rows.forEach(row => {
      logger.info(`  - ${row.mo_class}: ${row.param_count} parameters`);
    });
    
  } catch (error) {
    logger.error('Parameter import failed', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await importParameters();
    logger.info('Import process completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Import process failed', error);
    process.exit(1);
  }
}

main();
