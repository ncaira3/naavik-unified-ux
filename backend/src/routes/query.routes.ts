/**
 * Query Routes
 * API endpoints for database queries and analysis
 */
import { Router, Request, Response } from 'express';
import { SQLGeneratorService } from '../services/sql-generator.service.js';
import { QueryExecutorService, AnalysisQuery } from '../services/query-executor.service.js';
import { SchemaRegistryService } from '../services/schema-registry.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Initialize SQL Generator Service
SQLGeneratorService.initialize().catch(error => {
  logger.error('Failed to initialize SQL Generator Service', error);
});

/**
 * POST /api/query/natural
 * Convert natural language to SQL and execute
 */
router.post('/natural', asyncHandler(async (req: Request, res: Response) => {
  const { query, schemaId, schema } = req.body as {
    query?: string;
    schemaId?: string;
    schema?: any;
  };
  
  if (!query || typeof query !== 'string') {
    throw new AppError(400, 'INVALID_QUERY', 'Query string is required');
  }
  
  logger.info(`Natural language query: "${query}"`);
  
  // Generate SQL
  const generatedSQL = await SQLGeneratorService.generateSQL(query, {
    schemaId: schemaId ? String(schemaId) : undefined,
    schema,
  });
  
  // Execute query
  const result = await QueryExecutorService.executeQuery(generatedSQL.sql, generatedSQL.params);
  
  res.json({
    success: true,
    data: {
      query,
      schemaId: schemaId || null,
      generatedSQL: generatedSQL.sql,
      result,
      warnings: generatedSQL.warnings
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/query/execute
 * Execute a pre-validated SQL query
 */
router.post('/execute', asyncHandler(async (req: Request, res: Response) => {
  const { sql, params = [], schemaId, schema } = req.body;
  
  if (!sql || typeof sql !== 'string') {
    throw new AppError(400, 'INVALID_SQL', 'SQL string is required');
  }
  
  // Validate SQL for safety
  let effectiveSchema = schema;
  if (!effectiveSchema && schemaId) {
    const registered = await SchemaRegistryService.getSchema(String(schemaId));
    effectiveSchema = registered?.schema;
  }
  const validation = await SQLGeneratorService.validateSQL(sql, effectiveSchema);
  
  if (!validation.valid) {
    throw new AppError(400, 'UNSAFE_SQL', validation.errors.join(', '));
  }
  
  // Execute query
  const result = await QueryExecutorService.executeQuery(sql, params);
  
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/query/schema-registry
 * List all registered schemas
 */
router.get('/schema-registry', asyncHandler(async (_req: Request, res: Response) => {
  const schemas = await SchemaRegistryService.listSchemas();
  res.json({
    success: true,
    data: schemas.map((s) => ({
      schemaId: s.schemaId,
      description: s.description || null,
      tableCount: s.schema.tables.length,
      updatedAt: s.updatedAt,
    })),
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/query/schema-registry/:schemaId
 * Get one registered schema
 */
router.get('/schema-registry/:schemaId', asyncHandler(async (req: Request, res: Response) => {
  const entry = await SchemaRegistryService.getSchema(String(req.params.schemaId));
  if (!entry) {
    throw new AppError(404, 'SCHEMA_NOT_FOUND', `Schema "${req.params.schemaId}" not found`);
  }
  res.json({
    success: true,
    data: entry,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/query/schema-registry
 * Upsert a schema by schemaId
 * Body: { schemaId: string, description?: string, schema: DatabaseSchema }
 */
router.post('/schema-registry', asyncHandler(async (req: Request, res: Response) => {
  const { schemaId, description, schema } = req.body || {};
  if (!schemaId || typeof schemaId !== 'string') {
    throw new AppError(400, 'INVALID_SCHEMA_ID', 'schemaId is required');
  }
  const entry = await SchemaRegistryService.upsertSchema({
    schemaId,
    description: typeof description === 'string' ? description : undefined,
    schema,
  });
  res.json({
    success: true,
    data: entry,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * DELETE /api/query/schema-registry/:schemaId
 * Remove a schema definition
 */
router.delete('/schema-registry/:schemaId', asyncHandler(async (req: Request, res: Response) => {
  const deleted = await SchemaRegistryService.deleteSchema(String(req.params.schemaId));
  if (!deleted) {
    throw new AppError(404, 'SCHEMA_NOT_FOUND', `Schema "${req.params.schemaId}" not found`);
  }
  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/query/analyze
 * Run statistical analysis and return structured results with charts
 */
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const analysisQuery: AnalysisQuery = req.body;
  
  if (!analysisQuery.type || !analysisQuery.table || !analysisQuery.columns) {
    throw new AppError(400, 'INVALID_ANALYSIS', 'Analysis type, table, and columns are required');
  }
  
  logger.info(`Analysis query: ${analysisQuery.type} on ${analysisQuery.table}`);
  
  // Execute analysis
  const result = await QueryExecutorService.executeAnalysis(analysisQuery);
  
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/query/schema
 * Get database schema for context
 */
router.get('/schema', asyncHandler(async (req: Request, res: Response) => {
  const schema = SQLGeneratorService.getSchema();
  
  if (!schema) {
    throw new AppError(500, 'SCHEMA_NOT_LOADED', 'Database schema not available');
  }
  
  res.json({
    success: true,
    data: schema,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/query/export
 * Export query results to CSV
 */
router.post('/export', asyncHandler(async (req: Request, res: Response) => {
  const { sql, params = [] } = req.body;
  
  if (!sql || typeof sql !== 'string') {
    throw new AppError(400, 'INVALID_SQL', 'SQL string is required');
  }
  
  // Validate and execute
  const validation = await SQLGeneratorService.validateSQL(sql);
  if (!validation.valid) {
    throw new AppError(400, 'UNSAFE_SQL', validation.errors.join(', '));
  }
  
  const result = await QueryExecutorService.executeQuery(sql, params);
  const csv = QueryExecutorService.exportToCSV(result);
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="query_results.csv"');
  res.send(csv);
}));

export default router;
