/**
 * Anomaly Detection Routes
 */
import { Router, Request, Response } from 'express';
import { AnomalyService } from '../services/anomaly.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { cacheOrFetch } from '../utils/cache.js';

const router = Router();

/**
 * GET /api/anomalies
 * Get all detected anomalies
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { dateId } = req.query;
  
  const anomalies = await cacheOrFetch(
    `anomalies:all:${dateId || 'latest'}`,
    () => AnomalyService.detectAnomalies(dateId as string | undefined),
    120 // Cache for 2 minutes (anomalies change frequently)
  );
  
  res.json({
    success: true,
    data: anomalies,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/anomalies/stats
 * Get anomaly statistics
 */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = await cacheOrFetch(
    'anomalies:stats',
    () => AnomalyService.getAnomalyStats(),
    120
  );
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/anomalies/site/:siteId
 * Get anomalies for a specific site
 */
router.get('/site/:siteId', asyncHandler(async (req: Request, res: Response) => {
  const { siteId } = req.params;
  const { days } = req.query;
  
  const anomalies = await AnomalyService.getSiteAnomalies(
    siteId,
    days ? parseInt(days as string) : 7
  );
  
  res.json({
    success: true,
    data: anomalies,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/anomalies/check
 * Check if a KPI value is anomalous
 */
router.post('/check', asyncHandler(async (req: Request, res: Response) => {
  const { kpiName, value } = req.body;
  
  if (!kpiName || value === undefined) {
    throw new AppError(400, 'MISSING_PARAMS', 'kpiName and value are required');
  }
  
  const result = AnomalyService.isAnomaly(kpiName, parseFloat(value));
  
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
