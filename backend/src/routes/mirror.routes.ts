/**
 * Admin endpoints for the DB mirror.
 *
 * Mounted under /api/mirror (protected by authenticateToken in server.ts).
 *
 *   GET  /api/mirror/status               → current orchestrator status
 *   POST /api/mirror/backfill?days=30     → trigger a backfill (fire-and-forget)
 */
import { Router, Request, Response } from 'express';
import { dbMirror } from '../services/db-mirror/mirror.service.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: dbMirror.getStatus(), timestamp: new Date().toISOString() });
  }),
);

router.post(
  '/backfill',
  asyncHandler(async (req: Request, res: Response) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    // Fire-and-forget — backfill takes minutes, we don't want to block the HTTP response.
    void dbMirror.backfill(days);
    res.json({
      success: true,
      data: { triggered: true, days, message: `Backfill triggered for last ${days} days. Watch /api/mirror/status for progress.` },
      timestamp: new Date().toISOString(),
    });
  }),
);

export default router;
