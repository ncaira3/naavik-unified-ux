/**
 * Root Cause Analysis Routes
 */
import { Router, Request, Response } from 'express';
import { RCAService } from '../services/rca.service.js';
import { AnomalyService } from '../services/anomaly.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { cacheOrFetch } from '../utils/cache.js';
import { runLiveRca, getRcaLiveCacheStats } from '../services/rca-live.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/rca/run-live
 * Body: { siteId: string, date?: string (YYYY-MM-DD), fresh?: boolean }
 *
 * Calls services/rca pipeline on demand. Slow (30-180s typical). Cached for
 * 15 minutes per (siteId, date). Falls back to mirror.cqx_offenders_truth_table
 * if the live service is unreachable.
 */
router.post('/run-live', asyncHandler(async (req: Request, res: Response) => {
  const siteId = String(req.body?.siteId ?? '').trim();
  const date = req.body?.date ? String(req.body.date) : undefined;
  const fresh = Boolean(req.body?.fresh);
  if (!siteId) {
    throw new AppError(400, 'MISSING_PARAM', 'siteId is required');
  }
  logger.info(`[rca-live] /run-live siteId=${siteId} date=${date ?? '(default)'} fresh=${fresh}`);
  const result = await runLiveRca({ siteId, date, fresh });
  res.json({ success: true, data: result });
}));

/**
 * GET /api/rca/live-stats — cache-health probe.
 */
router.get('/live-stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: getRcaLiveCacheStats() });
});

/**
 * GET /api/rca/outages
 * Get all active outages with neighbor impact
 */
router.get('/outages', asyncHandler(async (req: Request, res: Response) => {
  const outages = await cacheOrFetch(
    'rca:outages:active',
    () => RCAService.getActiveOutages(),
    120 // 2 minutes
  );
  
  res.json({
    success: true,
    data: outages,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/rca/analyze
 * Perform root cause analysis for a specific anomaly
 */
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const { anomalyId, siteId, kpiName } = req.body;
  
  if (!siteId) {
    throw new AppError(400, 'MISSING_SITE', 'siteId is required');
  }
  
  // Get site anomalies
  const anomalies = await AnomalyService.getSiteAnomalies(siteId, 1);
  
  if (anomalies.length === 0) {
    throw new AppError(404, 'NO_ANOMALIES', `No anomalies found for site ${siteId}`);
  }
  
  // Find specific anomaly or use first one
  let targetAnomaly = anomalies[0];
  
  if (kpiName) {
    const filtered = anomalies.find(a => a.kpiName === kpiName);
    if (filtered) targetAnomaly = filtered;
  }
  
  // Perform RCA
  const rca = await RCAService.analyzeAnomaly(targetAnomaly);
  
  res.json({
    success: true,
    data: {
      anomaly: targetAnomaly,
      rca,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/rca/site/:siteId
 * Get RCA for a specific site
 */
router.get('/site/:siteId', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  
  const anomalies = await AnomalyService.getSiteAnomalies(siteId, 1);
  
  if (anomalies.length === 0) {
    res.json({
      success: true,
      data: {
        message: `No anomalies found for site ${siteId}`,
        rca: null,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  
  // Analyze the most severe anomaly
  const topAnomaly = anomalies.sort((a, b) => {
    const severityMap = { critical: 3, warning: 2, info: 1 };
    return severityMap[b.severity] - severityMap[a.severity];
  })[0];
  
  const rca = await RCAService.analyzeAnomaly(topAnomaly);
  
  res.json({
    success: true,
    data: {
      anomaly: topAnomaly,
      rca,
      allAnomalies: anomalies,
    },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
