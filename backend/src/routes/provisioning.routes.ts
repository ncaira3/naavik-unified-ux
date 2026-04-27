/**
 * Zero-Touch Provisioning Routes
 * Automated site deployment
 */
import { Router, Request, Response } from 'express';
import { ProvisioningService } from '../services/provisioning.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { ProvisioningRequest } from '../types/index.js';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = Router();

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * GET /api/provisioning/site-candidates
 * Build synthetic "new site" candidates between existing topology points.
 * Query params:
 *   - quarter: Q1 | Q2 | Q3 | Q4 | ALL (default ALL)
 *   - percentPerQuarter: candidate size as % of base sites per quarter (default 3, max 20)
 *   - limit: optional hard cap (max 500)
 */
router.get('/site-candidates', asyncHandler(async (req: Request, res: Response) => {
  const quarter = String(req.query.quarter || 'ALL').toUpperCase();
  const percentPerQuarter = Math.min(
    Math.max(parseFloat(String(req.query.percentPerQuarter || '3')) || 3, 1),
    20
  );
  const limitParam = req.query.limit ? Math.min(Math.max(parseInt(String(req.query.limit), 10) || 1, 1), 500) : null;
  const allowedQuarter = new Set(['ALL', 'Q1', 'Q2', 'Q3', 'Q4']);
  if (!allowedQuarter.has(quarter)) {
    throw new AppError(400, 'INVALID_QUARTER', 'quarter must be one of ALL, Q1, Q2, Q3, Q4');
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
        SELECT "SiteID", "Latitude", "Longitude"
        FROM filtered_sites
        WHERE "Latitude" IS NOT NULL
          AND "Longitude" IS NOT NULL
          AND "Latitude"::text <> 'NaN'
          AND "Longitude"::text <> 'NaN'
        ORDER BY "DistanceFromUnionCity" NULLS LAST, "SiteID"
        LIMIT 1800
      `
    );

    const baseSites = result.rows
      .map((row: any) => ({
        siteId: String(row.SiteID),
        latitude: Number(row.Latitude),
        longitude: Number(row.Longitude),
      }))
      .filter((s: any) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));

    const quarterByIndex = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
    const perQuarterCap = Math.max(1, Math.floor(baseSites.length * (percentPerQuarter / 100)));
    const hardCap = limitParam ?? (quarter === 'ALL' ? perQuarterCap * 4 : perQuarterCap);
    const quarterCounts = new Map<'Q1' | 'Q2' | 'Q3' | 'Q4', number>([
      ['Q1', 0],
      ['Q2', 0],
      ['Q3', 0],
      ['Q4', 0],
    ]);
    const candidates: Array<{
      siteId: string;
      siteName: string;
      latitude: number;
      longitude: number;
      quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
      status: 'READY';
      anchorSiteA: string;
      anchorSiteB: string;
      technology: '4G+5G';
      bandPlan: 'N41+N71';
      oem: 'Ericsson';
      softwareVersion: '26Q1';
    }> = [];

    // Deterministically reshuffle anchors so candidates are geographically scattered.
    const shuffled = [...baseSites].sort((a, b) => {
      const ah = stableHash(a.siteId);
      const bh = stableHash(b.siteId);
      return ah - bh;
    });

    for (let i = 0; i < shuffled.length; i += 1) {
      const a = shuffled[i];
      const b = shuffled[(i + 1) % shuffled.length];
      const quarterForRow = quarterByIndex[i % 4];
      if (quarter !== 'ALL' && quarterForRow !== quarter) continue;
      if ((quarterCounts.get(quarterForRow) || 0) >= perQuarterCap) continue;

      // Scatter around anchor with deterministic offset (approx 250m - 1.15km).
      const h = stableHash(`${a.siteId}:${b.siteId}:${quarterForRow}`);
      const angleDeg = h % 360;
      const angleRad = (angleDeg * Math.PI) / 180;
      const radiusMeters = 250 + (h % 900);
      const latRad = (a.latitude * Math.PI) / 180;
      const deltaLat = (radiusMeters * Math.cos(angleRad)) / 111320;
      const deltaLon = (radiusMeters * Math.sin(angleRad)) / (111320 * Math.max(0.2, Math.cos(latRad)));
      const candidateLat = a.latitude + deltaLat;
      const candidateLon = a.longitude + deltaLon;

      candidates.push({
        siteId: `SITE_NEW_${String(i + 1).padStart(4, '0')}`,
        siteName: `Planned Site ${String(i + 1).padStart(4, '0')}`,
        latitude: Number(candidateLat.toFixed(6)),
        longitude: Number(candidateLon.toFixed(6)),
        quarter: quarterForRow,
        status: 'READY',
        anchorSiteA: a.siteId,
        anchorSiteB: b.siteId,
        technology: '4G+5G',
        bandPlan: 'N41+N71',
        oem: 'Ericsson',
        softwareVersion: '26Q1',
      });
      quarterCounts.set(quarterForRow, (quarterCounts.get(quarterForRow) || 0) + 1);

      if (candidates.length >= hardCap) break;
    }

    logger.info(`Provisioning candidates generated: quarter=${quarter}, percentPerQuarter=${percentPerQuarter}, count=${candidates.length}`);

    res.json({
      success: true,
      data: {
        quarter,
        percentPerQuarter,
        perQuarterCap,
        count: candidates.length,
        quarterCounts: Object.fromEntries(quarterCounts),
        candidates,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Failed to generate provisioning candidates, returning empty list', err);
    res.json({
      success: true,
      data: {
        quarter,
        percentPerQuarter,
        perQuarterCap: 0,
        count: 0,
        quarterCounts: {},
        candidates: [],
      },
      timestamp: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
}));

/**
 * POST /api/provisioning/start
 * Start zero-touch provisioning workflow
 */
router.post('/start', asyncHandler(async (req: Request, res: Response) => {
  const provisioningRequest: ProvisioningRequest = {
    siteId: req.body.siteId,
    location: req.body.location,
    configuration: req.body.configuration,
    triggeredBy: req.body.triggeredBy || 'INTENT',
  };
  
  // Validate request
  const validation = ProvisioningService.validateRequest(provisioningRequest);
  if (!validation.valid) {
    throw new AppError(400, 'INVALID_REQUEST', validation.error!);
  }
  
  // Start provisioning
  const provisioningId = await ProvisioningService.startProvisioning(provisioningRequest);
  
  res.json({
    success: true,
    data: {
      provisioningId,
      message: 'Provisioning workflow started',
      estimatedDuration: '9 seconds',
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/provisioning/:provisioningId
 * Get provisioning status
 */
router.get('/:provisioningId', asyncHandler(async (req: Request, res: Response) => {
  const { provisioningId } = req.params;
  
  const status = await ProvisioningService.getProvisioningStatus(provisioningId);
  
  if (!status) {
    throw new AppError(404, 'PROVISIONING_NOT_FOUND', `Provisioning ${provisioningId} not found`);
  }
  
  res.json({
    success: true,
    data: status,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/provisioning
 * Get provisioning history
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.query;
  
  const history = await ProvisioningService.getProvisioningHistory(
    limit ? parseInt(limit as string) : 20
  );
  
  res.json({
    success: true,
    data: history,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/provisioning/:provisioningId/cancel
 * Cancel ongoing provisioning
 */
router.post('/:provisioningId/cancel', asyncHandler(async (req: Request, res: Response) => {
  const { provisioningId } = req.params;
  
  // Check if exists
  const status = await ProvisioningService.getProvisioningStatus(provisioningId);
  if (!status) {
    throw new AppError(404, 'PROVISIONING_NOT_FOUND', `Provisioning ${provisioningId} not found`);
  }
  
  if (status.status === 'COMPLETED') {
    throw new AppError(400, 'ALREADY_COMPLETED', 'Cannot cancel completed provisioning');
  }
  
  await ProvisioningService.cancelProvisioning(provisioningId);
  
  res.json({
    success: true,
    data: {
      provisioningId,
      message: 'Provisioning cancelled',
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/provisioning/validate
 * Validate provisioning request without starting
 */
router.post('/validate', asyncHandler(async (req: Request, res: Response) => {
  const provisioningRequest: ProvisioningRequest = {
    siteId: req.body.siteId,
    location: req.body.location,
    configuration: req.body.configuration,
    triggeredBy: req.body.triggeredBy || 'INTENT',
  };
  
  const validation = ProvisioningService.validateRequest(provisioningRequest);
  
  if (!validation.valid) {
    res.json({
      success: false,
      data: {
        valid: false,
        error: validation.error,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  
  res.json({
    success: true,
    data: {
      valid: true,
      message: 'Provisioning request is valid',
      estimatedCells: provisioningRequest.configuration.sectors * provisioningRequest.configuration.carriers.length,
    },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
