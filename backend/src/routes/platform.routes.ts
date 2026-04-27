import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { PlatformRegistryService, AppRegistryEntry } from '../services/platform-registry.service.js';
import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { logger } from '../utils/logger.js';

const adminDb = new NaavikDBConnector();

const router = Router();

// Helper to check admin role
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Admin access required');
  }
  next();
};

/**
 * GET /api/platform/registry
 * Get visible apps for current user
 */
router.get('/registry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role || 'user';

    if (!userId) {
      logger.warn('[platform] Registry request with no user ID');
      throw new AppError(401, 'UNAUTHORIZED', 'User ID required');
    }

    const registry = await PlatformRegistryService.getVisibleRegistry(userId, userRole);

    res.json({
      success: true,
      data: registry,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/platform/registry/all
 * Get all apps (admin only)
 */
router.get('/registry/all', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const registry = await PlatformRegistryService.getRegistry();
    res.json({
      success: true,
      data: registry,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/platform/registry
 * Add a new app (admin only)
 */
router.post('/registry', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry: Partial<AppRegistryEntry> = req.body;

    // Validate required fields
    if (!entry.id || !entry.displayName || !entry.iconName || !entry.containerType) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'Required fields: id, displayName, iconName, containerType'
      );
    }

    if (!['internal', 'federated', 'iframe'].includes(entry.containerType)) {
      throw new AppError(400, 'INVALID_CONTAINER_TYPE', 'containerType must be internal, federated, or iframe');
    }

    const app = await PlatformRegistryService.addApp(entry as Omit<AppRegistryEntry, 'isActive'>, req.user!.id);

    res.status(201).json({
      success: true,
      data: app,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/platform/registry/:id
 * Toggle app active state (admin only)
 */
router.put('/registry/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      throw new AppError(400, 'INVALID_INPUT', 'isActive must be a boolean');
    }

    await PlatformRegistryService.toggleApp(id, isActive);

    res.json({
      success: true,
      data: { id, isActive },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/platform/registry/:id
 * Delete an app (admin only)
 */
router.delete('/registry/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Prevent deletion of core apps
    const coreApps = ['home', 'observe', 'appgen', 'provision', 'settings'];
    if (coreApps.includes(id)) {
      throw new AppError(400, 'CANNOT_DELETE_CORE_APP', `Cannot delete core app: ${id}`);
    }

    await PlatformRegistryService.deleteApp(id);

    res.json({
      success: true,
      data: { id, deleted: true },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/platform/users/:userId/permissions
 * Get app permissions for a user (admin or self)
 */
router.get('/users/:userId/permissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;

    // Allow admin to view anyone's permissions, or users to view their own
    if (requesterRole !== 'admin' && requesterId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot view other user permissions');
    }

    const permissions = await PlatformRegistryService.getUserPermissions(userId);

    res.json({
      success: true,
      data: permissions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/platform/users/:userId/permissions/:appId
 * Set app permission for a user (admin only)
 */
router.put(
  '/users/:userId/permissions/:appId',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, appId } = req.params;
      const { isEnabled } = req.body;

      if (typeof isEnabled !== 'boolean') {
        throw new AppError(400, 'INVALID_INPUT', 'isEnabled must be a boolean');
      }

      await PlatformRegistryService.setUserPermission(userId, appId, isEnabled, req.user!.id);

      res.json({
        success: true,
        data: { userId, appId, isEnabled },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/platform/users/:userId/permissions
 * Reset all permissions for a user (admin only)
 */
router.delete(
  '/users/:userId/permissions',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;

      await PlatformRegistryService.resetUserPermissions(userId);

      res.json({
        success: true,
        data: { userId, reset: true },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/platform/admin/query
 * Execute a read-only SQL query against the remote MSSQL database (admin only).
 */
router.post('/admin/query', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sql } = req.body as { sql?: string };
    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      throw new AppError(400, 'INVALID_INPUT', 'sql is required');
    }
    const normalised = sql.trim().toUpperCase();
    if (!normalised.startsWith('SELECT') && !normalised.startsWith('WITH')) {
      throw new AppError(400, 'READ_ONLY', 'Only SELECT queries are allowed');
    }

    const start = Date.now();
    let rows: any[];
    try {
      rows = await adminDb.query(sql.trim());
    } catch (dbErr: any) {
      const msg = dbErr?.message || String(dbErr);
      return res.status(422).json({ success: false, error: msg });
    }
    const durationMs = Date.now() - start;

    logger.info(`[admin/query] ${rows.length} rows · ${durationMs}ms · user=${req.user?.id}`);
    res.json({ success: true, rows, rowCount: rows.length, durationMs });
  } catch (error) {
    next(error);
  }
});

export default router;
