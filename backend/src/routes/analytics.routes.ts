import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { AnalyticsService } from '../services/analytics.service.js';

const router = Router();

/**
 * POST /api/analytics/clusters
 * Body: { dateId?: "YYYY-MM-DD", siteIds?: string[], k?: number }
 *
 * Returns spatial clusters over site coordinates. Intended for thematic maps / clustering overlays.
 */
router.post(
  '/clusters',
  asyncHandler(async (req: Request, res: Response) => {
    const { dateId, siteIds, k } = req.body || {};
    const kNum = Math.max(2, Math.min(24, Number(k || 6)));
    if (siteIds !== undefined && !Array.isArray(siteIds)) {
      throw new AppError(400, 'INVALID_SITE_IDS', 'siteIds must be an array of strings');
    }
    const sites = Array.isArray(siteIds) ? siteIds.map((x) => String(x)).filter(Boolean).slice(0, 1200) : undefined;
    const result = await AnalyticsService.clusterSites({
      dateId: typeof dateId === 'string' ? String(dateId).slice(0, 10) : undefined,
      siteIds: sites,
      k: kNum,
    });
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;

