/**
 * SQL Generator Service
 * Uses OpenAI to convert natural language to safe, read-only SQL queries
 */
import { openai } from '../config/openai.js';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { DatabaseSchema, GeneratedSQL, ValidationResult } from '../types/index.js';
import { SchemaRegistryService } from './schema-registry.service.js';

const DANGEROUS_KEYWORDS = [
  'DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE',
  'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL', '--', ';--', '/*', '*/'
];

// Primary tables (filtered, curated data - USE THESE BY DEFAULT)
const PRIMARY_TABLES = [
  'filtered_sites',
  'filtered_cell_table', 
  'filtered_sector_table',
  'filtered_cell_sector_map_view'
];

// Secondary tables (full data - only use when explicitly requested or for specific KPIs)
const SECONDARY_TABLES = [
  'site_table',
  'cell_table',
  'intermediate_kpi_table',
  'subcomponent_table',
  'sector_table',
  'ticket_table',
  'cqx_offenders_truth_table'
];

const ALLOWED_TABLES = [...PRIMARY_TABLES, ...SECONDARY_TABLES];

const SQL_GENERATION_PROMPT = `You are a PostgreSQL expert for a telecom network database. Convert natural language to safe, read-only SQL.

**CRITICAL: DEFAULT TO FILTERED TABLES**
The database has two sets of tables:
1. **filtered_* tables** (PRIMARY - USE THESE BY DEFAULT): ~1,669 curated sites within 21 miles of Union City, CA
2. **full tables** (SECONDARY - only use if explicitly asked for "all data" or "entire database"): ~6,806 total sites

**Primary Tables (USE BY DEFAULT):**
- filtered_sites (~1,669 rows): SiteID, SiteName, Latitude, Longitude, CellCount, DateID, AnomalyFlag, AnomalyScore, ClusterID, Status, DistanceFromUnionCity
- filtered_cell_table (~5,000 rows): CellID, CellName, SiteID, Technology, Carrier, Latitude, Longitude, Azimuth, DateID, AnomalyFlag, AnomalyScore
- filtered_sector_table (~15,000 rows): SectorID, CellID, SiteID, Azimuth, BeamWidth, Technology, DateID
- filtered_cell_sector_map_view: Combined view with cell and sector data

**Secondary Tables (only if user says "all" or "entire" database):**
- site_table (~6,834 rows): All sites (unfiltered)
- cell_table (~39,816 rows): All cells (unfiltered)
- intermediate_kpi_table (~103,832 rows): Historical KPI data (use for KPI queries with JOINs)
- subcomponent_table (~103,710 rows): Super KPI subcomponent data
- sector_table (~10,725 rows): All sectors
- ticket_table (~161 rows): Trouble tickets (JOIN with filtered_sites)
- cqx_offenders_truth_table (~13,109 rows): Super KPI offender data

**Rules:**
1. **ALWAYS use filtered_sites/filtered_cell_table by default** unless user explicitly asks for "all sites" or "entire database"
2. ONLY use SELECT statements
3. Always include LIMIT clause (default 100, max 1000)
4. Use proper column names with quotes for mixed case
5. JOIN filtered_sites with kpi_metrics/tickets when needed
6. Return ONLY valid PostgreSQL SQL, no explanations

**Examples:**
Q: "Show me all sites"
A: SELECT "SiteID", "SiteName", "Latitude", "Longitude", "CellCount", "Status" FROM filtered_sites ORDER BY "DistanceFromUnionCity" LIMIT 100;

Q: "Show me all sites with high drop rate"
A: SELECT s."SiteID", s."SiteName", i."KPI_VALUE" as drop_rate FROM filtered_sites s JOIN intermediate_kpi_table i ON s."SiteID" = i."SITE_ID" WHERE i."KPI_NAME" = 'DATA_DROP_RATE' AND i."KPI_VALUE" > 5.0 ORDER BY i."KPI_VALUE" DESC LIMIT 100;

Q: "List sites with anomalies"
A: SELECT "SiteID", "SiteName", "AnomalyScore", "Status" FROM filtered_sites WHERE "AnomalyFlag" = true ORDER BY "AnomalyScore" DESC LIMIT 100;

Q: "How many sites are there?"
A: SELECT COUNT(*) as site_count FROM filtered_sites;

Q: "Show me ALL sites in the entire database"
A: SELECT "SiteID", "SiteName" FROM site_table LIMIT 1000;

Now convert this query:`;

export class SQLGeneratorService {
  private static schema: DatabaseSchema | null = null;
  private static tableCounts: Map<string, number> = new Map();

  private static getAllowedTablesFromSchema(schema?: DatabaseSchema | null): string[] {
    if (!schema?.tables?.length) return ALLOWED_TABLES.map((t) => t.toLowerCase());
    return schema.tables.map((t) => t.name.toLowerCase());
  }

  /**
   * Initialize by loading database schema and table counts
   */
  static async initialize(): Promise<void> {
    try {
      this.schema = await this.fetchSchema();
      await this.fetchTableCounts();
      logger.info('SQL Generator Service initialized with schema and counts');
    } catch (error) {
      logger.error('Failed to initialize SQL Generator Service', error);
    }
  }

  /**
   * Fetch database schema
   */
  private static async fetchSchema(): Promise<DatabaseSchema> {
    const result = await pool.query(`
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name IN (${ALLOWED_TABLES.map(t => `'${t}'`).join(',')})
      ORDER BY table_name, ordinal_position
    `);

    const tableMap = new Map<string, any[]>();
    
    result.rows.forEach(row => {
      if (!tableMap.has(row.table_name)) {
        tableMap.set(row.table_name, []);
      }
      tableMap.get(row.table_name)!.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES'
      });
    });

    return {
      tables: Array.from(tableMap.entries()).map(([name, columns]) => ({
        name,
        columns
      }))
    };
  }

  /**
   * Fetch row counts for all tables
   */
  private static async fetchTableCounts(): Promise<void> {
    try {
      for (const table of ALLOWED_TABLES) {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        this.tableCounts.set(table, count);
        logger.info(`Table ${table}: ${count} rows`);
      }
    } catch (error) {
      logger.error('Failed to fetch table counts', error);
    }
  }

  /**
   * Get enhanced context about database
   */
  static getDatabaseContext(): string {
    const context = [
      'Database Context:',
      '- filtered_sites: ' + (this.tableCounts.get('filtered_sites') || '~1,669') + ' sites (curated, within 21 miles of Union City)',
      '- filtered_cell_table: ' + (this.tableCounts.get('filtered_cell_table') || '~5,000') + ' cells',
      '- filtered_sector_table: ' + (this.tableCounts.get('filtered_sector_table') || '~15,000') + ' sectors',
      '- site_table: ' + (this.tableCounts.get('site_table') || '~6,806') + ' sites (full database)',
      '- cell_table: ' + (this.tableCounts.get('cell_table') || '~20,000') + ' cells (full database)',
      '',
      'DEFAULT: Use filtered_* tables unless user explicitly asks for "all" or "entire" database'
    ];
    
    return context.join('\n');
  }

  /**
   * Generate SQL from natural language
   */
  static async generateSQL(
    query: string,
    options?: { schema?: DatabaseSchema; schemaId?: string }
  ): Promise<GeneratedSQL> {
    try {
      // Use OpenAI if available
      if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key') {
        return await this.generateWithOpenAI(query, options);
      } else {
        return await this.generateFallback(query);
      }
    } catch (error) {
      logger.error('SQL generation failed', error);
      throw new Error('Failed to generate SQL query');
    }
  }

  /**
   * Generate SQL using OpenAI with enhanced context
   */
  private static async generateWithOpenAI(
    query: string,
    options?: { schema?: DatabaseSchema; schemaId?: string }
  ): Promise<GeneratedSQL> {
    let effectiveSchema: DatabaseSchema | undefined = options?.schema;
    if (!effectiveSchema && options?.schemaId) {
      const registered = await SchemaRegistryService.getSchema(options.schemaId);
      effectiveSchema = registered?.schema;
    }

    const schemaContext = effectiveSchema
      ? SchemaRegistryService.schemaToPromptContext(effectiveSchema)
      : this.getDatabaseContext();

    // Add database context to the prompt
    const contextualPrompt = `${SQL_GENERATION_PROMPT}

${schemaContext}

User Query: ${query}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: contextualPrompt },
        { role: 'user', content: 'Generate SQL for the above query' }
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    let sql = response.choices[0].message.content?.trim() || '';
    
    // Clean up SQL
    sql = sql.replace(/```sql/g, '').replace(/```/g, '').trim();
    
    // Remove any trailing semicolon for safety
    sql = sql.replace(/;$/, '');

    // Ensure filtered tables are used by default
    sql = this.ensureFilteredTables(sql, query);

    // Validate the generated SQL
    const validation = await this.validateSQL(sql, effectiveSchema);
    
    if (!validation.valid) {
      throw new Error(`Invalid SQL generated: ${validation.errors.join(', ')}`);
    }

    return {
      sql,
      params: [],
      estimatedRows: this.estimateRowCount(sql),
      safe: validation.valid,
      warnings: validation.warnings
    };
  }

  /**
   * Ensure filtered tables are used unless user explicitly wants full data
   */
  private static ensureFilteredTables(sql: string, originalQuery: string): string {
    const lowerQuery = originalQuery.toLowerCase();
    
    // If user explicitly asks for "all" or "entire" database, keep as is
    if (lowerQuery.includes('all sites in database') || 
        lowerQuery.includes('entire database') ||
        lowerQuery.includes('complete database') ||
        lowerQuery.includes('full database')) {
      return sql;
    }
    
    // Otherwise, replace full tables with filtered tables
    let modifiedSql = sql;
    modifiedSql = modifiedSql.replace(/\bsite_table\b/gi, 'filtered_sites');
    modifiedSql = modifiedSql.replace(/\bcell_table\b/gi, 'filtered_cell_table');
    modifiedSql = modifiedSql.replace(/FROM\s+sectors\b/gi, 'FROM filtered_sector_table');
    
    return modifiedSql;
  }

  /**
   * Fallback SQL generation (rule-based)
   */
  private static async generateFallback(query: string): Promise<GeneratedSQL> {
    const lowerQuery = query.toLowerCase();
    let sql = '';
    let warnings: string[] = ['Using fallback query generation'];

    // Check if user wants full database
    const wantsFullDB = lowerQuery.includes('all sites in database') || 
                        lowerQuery.includes('entire database') ||
                        lowerQuery.includes('complete database');

    const siteTable = wantsFullDB ? 'site_table' : 'filtered_sites';
    const cellTable = wantsFullDB ? 'cell_table' : 'filtered_cell_table';

    if (!wantsFullDB) {
      warnings.push(`Using ${siteTable} (filtered data: ~1,669 sites)`);
    }

    // Simple pattern matching for common queries
    if (lowerQuery.includes('how many sites') || lowerQuery.includes('count sites')) {
      sql = `SELECT COUNT(*) as site_count FROM ${siteTable}`;
    } else if (lowerQuery.includes('all sites') || lowerQuery.includes('list sites') || lowerQuery.includes('show sites')) {
      sql = `SELECT "SiteID", "SiteName", "Latitude", "Longitude", "CellCount", "Status" FROM ${siteTable} ${!wantsFullDB ? 'ORDER BY "DistanceFromUnionCity"' : ''} LIMIT 100`;
    } else if (lowerQuery.includes('anomal')) {
      sql = `SELECT "SiteID", "SiteName", "AnomalyScore", "Status" FROM ${siteTable} WHERE "AnomalyFlag" = true ORDER BY "AnomalyScore" DESC LIMIT 100`;
    } else if (lowerQuery.includes('how many cells') || lowerQuery.includes('count cells')) {
      sql = `SELECT COUNT(*) as cell_count FROM ${cellTable}`;
    } else if (lowerQuery.includes('cells') || lowerQuery.includes('list cells')) {
      sql = `SELECT "CellID", "CellName", "SiteID", "Technology" FROM ${cellTable} LIMIT 100`;
    } else if (lowerQuery.includes('drop rate')) {
      sql = `SELECT s."SiteID", s."SiteName", i."KPI_VALUE" as drop_rate
             FROM ${siteTable} s 
             JOIN intermediate_kpi_table i ON s."SiteID" = i."SITE_ID"
             WHERE i."KPI_NAME" = 'DATA_DROP_RATE' 
             ORDER BY i."KPI_VALUE" DESC LIMIT 100`;
    } else if (lowerQuery.includes('throughput') || lowerQuery.includes('tput')) {
      sql = `SELECT s."SiteID", s."SiteName", i."KPI_VALUE" as throughput
             FROM ${siteTable} s 
             JOIN intermediate_kpi_table i ON s."SiteID" = i."SITE_ID"
             WHERE i."KPI_NAME" = 'DL_DRB_TPUT' 
             ORDER BY i."KPI_VALUE" DESC LIMIT 100`;
    } else if (lowerQuery.includes('critical') || lowerQuery.includes('outage')) {
      sql = `SELECT "SiteID", "SiteName", "Status", "AnomalyScore" FROM ${siteTable} WHERE "Status" IN ('CRITICAL', 'OUTAGE') ORDER BY "AnomalyScore" DESC LIMIT 100`;
    } else {
      // Default: show sites with summary
      sql = `SELECT "SiteID", "SiteName", "Status", "CellCount", "AnomalyFlag" FROM ${siteTable} ${!wantsFullDB ? 'ORDER BY "DistanceFromUnionCity"' : ''} LIMIT 100`;
    }

    return {
      sql,
      params: [],
      estimatedRows: 100,
      safe: true,
      warnings
    };
  }

  /**
   * Validate SQL for safety
   */
  static async validateSQL(sql: string, schema?: DatabaseSchema | null): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const upperSQL = sql.toUpperCase();
    const allowedTables = this.getAllowedTablesFromSchema(schema);

    // Check for dangerous keywords
    for (const keyword of DANGEROUS_KEYWORDS) {
      if (upperSQL.includes(keyword)) {
        errors.push(`Dangerous keyword detected: ${keyword}`);
      }
    }

    // Must be a SELECT statement
    if (!upperSQL.trim().startsWith('SELECT')) {
      errors.push('Only SELECT statements are allowed');
    }

    // Check for LIMIT clause
    if (!upperSQL.includes('LIMIT')) {
      warnings.push('Query should include LIMIT clause');
      // Auto-add LIMIT if missing
      sql += ' LIMIT 1000';
    }

    // Extract LIMIT value
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1]);
      if (limit > 1000) {
        errors.push('LIMIT cannot exceed 1000 rows');
      }
    }

    // Check for allowed tables only
    const tableMatches = sql.match(/\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi);
    if (tableMatches) {
      tableMatches.forEach((match) => {
        const table = match.replace(/\b(?:FROM|JOIN)\s+/i, '').trim();
        if (!allowedTables.includes(table.toLowerCase())) {
          errors.push(`Table ${table} is not in allowed list`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Estimate row count for a query
   */
  private static estimateRowCount(sql: string): number {
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      return Math.min(parseInt(limitMatch[1]), 1000);
    }
    return 100; // Default estimate
  }

  /**
   * Get schema information for client
   */
  static getSchema(): DatabaseSchema | null {
    return this.schema;
  }
}
