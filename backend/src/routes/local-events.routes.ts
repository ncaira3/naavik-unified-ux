/**
 * Local Events Routes
 *
 *   GET /api/local-events/near?lat&lng&radius&startDate&endDate
 *     → events around a point, default 5 mi / today..+7d
 *
 *   GET /api/local-events/site/:usid?radius&startDate&endDate
 *     → resolves the site's lat/lng then returns events
 *
 *   GET /api/local-events/providers
 *     → which upstreams have keys configured
 */
import express, { Request, Response } from 'express';
import { findLocalEvents, getActiveProviders } from '../services/local-events/index.js';
import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const remoteDb = new NaavikDBConnector();

router.get('/providers', (_req, res) => {
  res.json({ success: true, data: { providers: getActiveProviders() } });
});

router.get('/near', async (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Number(req.query.radius ?? 5);
  if (!isFinite(lat) || !isFinite(lng)) {
    return res
      .status(400)
      .json({ success: false, error: 'lat and lng are required numbers' });
  }
  try {
    const events = await findLocalEvents({
      lat,
      lng,
      radiusMiles: radius,
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    });
    res.json({ success: true, data: { events, count: events.length } });
  } catch (err: any) {
    logger.error('[local-events] /near failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/site/:usid', async (req: Request, res: Response) => {
  const usid = String(req.params.usid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (!usid) {
    return res.status(400).json({ success: false, error: 'usid required' });
  }
  const radius = Number(req.query.radius ?? 5);
  try {
    // Resolve lat/lng — prefer local site mirror if available, fall back to remote.
    let lat: number | undefined;
    let lng: number | undefined;
    try {
      const rows = (await remoteDb.query(
        `SELECT TOP 1 LATITUDE, LONGITUDE FROM site_table WITH (NOLOCK)
         WHERE USID = '${usid}' ORDER BY DATE_ID DESC`,
      )) as Array<{ LATITUDE: number; LONGITUDE: number }>;
      lat = Number(rows[0]?.LATITUDE);
      lng = Number(rows[0]?.LONGITUDE);
    } catch (err) {
      logger.warn(`[local-events] could not resolve lat/lng for USID ${usid}`, err);
    }

    if (!isFinite(lat as number) || !isFinite(lng as number)) {
      return res
        .status(404)
        .json({ success: false, error: `No coordinates available for USID ${usid}` });
    }

    const events = await findLocalEvents({
      lat: lat as number,
      lng: lng as number,
      radiusMiles: radius,
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    });
    res.json({
      success: true,
      data: {
        usid,
        lat,
        lng,
        radiusMiles: radius,
        events,
        count: events.length,
      },
    });
  } catch (err: any) {
    logger.error('[local-events] /site failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
