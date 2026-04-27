/**
 * Naavik Demo Backend Server
 * Main entry point for Express API
 */
import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection, getTableCounts, initializeDemoViews } from './config/database.js';
import { hasConfiguredOpenAIKey, testOpenAI } from './config/openai.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authenticateToken } from './middleware/auth.js';
import { KPIModel } from './models/kpi.model.js';
import { kpiDataAdapter } from './services/kpi-data-adapter.service.js';
import { SQLGeneratorService } from './services/sql-generator.service.js';
import { AppGenCatalogService } from './services/appgen-catalog.service.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import siteRoutes from './routes/site.routes.js';
import kpiRoutes from './routes/kpi.routes.js';
import anomalyRoutes from './routes/anomaly.routes.js';
import rcaRoutes from './routes/rca.routes.js';
import intentRoutes from './routes/intent.routes.js';
import appRoutes from './routes/app.routes.js';
import provisioningRoutes from './routes/provisioning.routes.js';
import offenderRoutes from './routes/offender.routes.js';
import parameterRoutes from './routes/parameter.routes.js';
import automationRoutes from './routes/automation.routes.js';
import testRoutes from './routes/test.routes.js';
import queryRoutes from './routes/query.routes.js';
import telecomKnowledgeRoutes from './routes/telecom-knowledge.routes.js';
import conversationalBuilderRoutes from './routes/conversational-builder.routes.js';
import ossAdapterRoutes from './routes/oss-adapter.routes.js';
import agentRoutes from './routes/agent.routes.js';
import appgenAgentRoutes from './routes/appgen-agent.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import platformRoutes from './routes/platform.routes.js';
import compassRoutes from './routes/compass.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import { appgenTokenRouter, appgenProxy } from './routes/appgen-proxy.routes.js';
import { AppSettingsService } from './services/app-settings.service.js';
import { PlatformRegistryService } from './services/platform-registry.service.js';
import { dbSchemaRef } from './services/db-schema-reference.service.js';
import { dataSyncService } from './services/data-sync.service.js';
import { dataDictResolver } from './services/datadict-resolver.service.js';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// Middleware
// =====================================================

// CORS - allow frontend to access API (including all localhost ports for dev)
app.use(cors({
  origin: process.env.CORS_ORIGIN || function (origin, callback) {
    // Allow all localhost origins for development
    if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// =====================================================
// Routes
// =====================================================

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

// API version
app.get('/api', (req, res) => {
  res.json({
    success: true,
    data: {
      name: 'Naavik Demo API',
      version: '1.0.0',
      endpoints: {
        auth: '/api/auth',
        sites: '/api/sites',
        kpis: '/api/kpis',
        anomalies: '/api/anomalies',
        rca: '/api/rca',
        intent: '/api/intent',
        apps: '/api/apps',
        provisioning: '/api/provisioning',
        offenders: '/api/offenders',
        parameters: '/api/parameters',
        automation: '/api/automation',
        query: '/api/query',
        ossAdapter: '/api/oss-adapter',
        compass: '/api/compass',
      },
    },
  });
});

// Auth routes (no middleware - handles own auth)
app.use('/api/auth', authRoutes);

// Protected routes (require authentication)
app.use('/api/sites', authenticateToken, siteRoutes);
app.use('/api/kpis', authenticateToken, kpiRoutes);
app.use('/api/anomalies', authenticateToken, anomalyRoutes);
app.use('/api/rca', authenticateToken, rcaRoutes);
app.use('/api/intent', authenticateToken, intentRoutes);
app.use('/api/apps', authenticateToken, appRoutes);
app.use('/api/provisioning', authenticateToken, provisioningRoutes);
app.use('/api/offenders', authenticateToken, offenderRoutes);
app.use('/api/parameters', authenticateToken, parameterRoutes);
app.use('/api/automation', authenticateToken, automationRoutes);
app.use('/api/query', authenticateToken, queryRoutes);
app.use('/api/telecom-knowledge', authenticateToken, telecomKnowledgeRoutes);
app.use('/api/conversational-builder', authenticateToken, conversationalBuilderRoutes);
app.use('/api/oss-adapter', authenticateToken, ossAdapterRoutes);
app.use('/api/agent', authenticateToken, agentRoutes);
app.use('/api/appgen/agent', authenticateToken, appgenAgentRoutes);
app.use('/api/settings', authenticateToken, settingsRoutes);
app.use('/api/platform', authenticateToken, platformRoutes);
app.use('/api/compass', authenticateToken, compassRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/test', authenticateToken, testRoutes);

// AppGen integration routes and proxy
app.use('/api', authenticateToken, appgenTokenRouter);
app.use('/appgen-api', appgenProxy);

// =====================================================
// Error Handling
// =====================================================

app.use(notFoundHandler);
app.use(errorHandler);

// =====================================================
// KPI Prewarm — background, never blocks startup
// =====================================================

import { pool } from './config/database.js';

async function prewarmTopOffenders(): Promise<void> {
  try {
    // Get the latest date with offender data
    const dateRow = await pool.query(
      `SELECT "DateID" FROM cqx_offenders_truth_table ORDER BY "DateID" DESC LIMIT 1`
    );
    const dateId = String(dateRow.rows[0]?.DateID || '').slice(0, 10);
    if (!dateId) return;

    // Grab top 20 offender sites
    const siteRows = await pool.query(
      `SELECT "SiteID" FROM cqx_offenders_truth_table WHERE "DateID" = $1
       ORDER BY COALESCE("TOTAL_IMPACT_LATEST", 0) DESC LIMIT 20`,
      [dateId]
    );
    const siteIds: string[] = siteRows.rows.map((r: any) => String(r.SiteID)).filter(Boolean);
    if (!siteIds.length) return;

    logger.info(`🔥 KPI prewarm: warming ${siteIds.length} top-offender sites for ${dateId}`);

    // Fire bundles concurrently with a small concurrency cap (4) to avoid
    // hammering the remote DB immediately at startup
    const CONCURRENCY = 4;
    for (let i = 0; i < siteIds.length; i += CONCURRENCY) {
      await Promise.allSettled(
        siteIds.slice(i, i + CONCURRENCY).map((siteId) =>
          kpiDataAdapter.getBundle(siteId, dateId, 'daily').catch((e: any) =>
            logger.warn(`Prewarm failed for ${siteId}: ${e?.message}`)
          )
        )
      );
    }

    logger.info(`✅ KPI prewarm complete for ${siteIds.length} sites`);
  } catch (err: any) {
    logger.warn(`KPI prewarm skipped: ${err?.message}`);
  }
}

// =====================================================
// Server Startup
// =====================================================

async function startServer() {
  try {
    logger.info('Starting Naavik Demo Backend...');

    // Start Express server immediately so auth and basic routes are available
    app.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`🌐 API: http://localhost:${PORT}/api`);
      logger.info(`💚 Health: http://localhost:${PORT}/health`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Run heavy initialization in the background so dev login is never blocked.
    void (async () => {
      // Test database connection
      logger.info('Testing database connection...');
      const dbConnected = await testConnection();

      if (!dbConnected) {
        logger.error('Database connection failed. API calls may fail.');
      } else {
        const counts = await getTableCounts();
        logger.info('Database table counts:');
        Object.entries(counts).forEach(([table, count]) => {
          logger.info(`  ${table}: ${count} rows`);
        });
      }

      logger.info('Initializing demo views and seed data...');
      try {
        await initializeDemoViews();
      } catch (error) {
        logger.warn('Could not initialize demo views.');
      }

      if (hasConfiguredOpenAIKey()) {
        logger.info('Testing OpenAI connection...');
        await testOpenAI();
      } else {
        logger.warn('OPENAI_API_KEY not set. AI features will be limited.');
      }

      logger.info('Initializing real-time KPI data services...');
      try {
        await KPIModel.initialize();

        // Pre-warm KPI bundle cache for top offenders so charts load instantly
        // on first visit. Runs in the background — never blocks server startup.
        void prewarmTopOffenders();
      } catch (error) {
        logger.error('Failed to initialize KPI services. KPI data may be unavailable.');
        logger.error('Error:', error);
      }

      logger.info('Initializing SQL Generator Service...');
      try {
        await SQLGeneratorService.initialize();
        logger.info('SQL Generator Service initialized with database context');
      } catch (error) {
        logger.error('Failed to initialize SQL Generator. Queries will use fallback logic.');
        logger.error('Error:', error);
      }

      logger.info('Initializing AppGen catalog service...');
      try {
        await AppGenCatalogService.initialize();
        logger.info('AppGen catalog service initialized');
      } catch (error) {
        logger.error('Failed to initialize AppGen catalog service.');
        logger.error('Error:', error);
      }

      logger.info('Initializing app settings service...');
      try {
        await AppSettingsService.initialize();
        logger.info('App settings service initialized');
      } catch (error) {
        logger.error('Failed to initialize app settings service.');
        logger.error('Error:', error);
      }

      logger.info('Initializing platform registry service...');
      try {
        await PlatformRegistryService.initialize();
        logger.info('Platform registry service initialized');
      } catch (error) {
        logger.error('Failed to initialize platform registry service.');
        logger.error('Error:', error);
      }

      logger.info('Refreshing DB schema reference (KPI + subcomponent names)…');
      try {
        await dbSchemaRef.refresh();
        const s = dbSchemaRef.status() as any;
        logger.info(`DB schema reference ready: ${s.kpiCount} KPIs, ${s.subcomponentCount} subcomponents`);
      } catch (error) {
        logger.warn('DB schema reference refresh failed — using disk cache or static fallback.');
      }

      logger.info('Initializing data sync service (local topology cache)…');
      try {
        await dataSyncService.initialize();
        dataSyncService.start();
      } catch (error) {
        logger.warn('Data sync service init failed — map will load from remote on first request.');
      }

      logger.info('Loading DataDict parameter catalog…');
      dataDictResolver.load().catch((err) => {
        logger.warn('DataDict load failed — KPI fuzzy matching disabled.', err);
      });
    })();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
