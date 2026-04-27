import { Router } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { AppSettingsService } from '../services/app-settings.service.js';

const router = Router();

const ALLOWED_OEMS = ['Ericsson', 'Nokia', 'Samsung', 'Multi-OEM'];

router.get('/appgen', async (req, res, next) => {
  try {
    const settings = await AppSettingsService.getAppGenSettings();
    res.json({
      success: true,
      data: settings,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.put('/appgen/oems', async (req, res, next) => {
  try {
    const input = req.body?.enabledOems;
    if (!Array.isArray(input) || input.length === 0) {
      throw new AppError(400, 'INVALID_INPUT', 'enabledOems must be a non-empty array');
    }
    const unique = Array.from(new Set(input.map((v: any) => String(v))));
    const invalid = unique.filter((v) => !ALLOWED_OEMS.includes(v));
    if (invalid.length > 0) {
      throw new AppError(400, 'INVALID_OEM', `Unsupported OEM values: ${invalid.join(', ')}`);
    }

    const settings = await AppSettingsService.updateAppGenSettings({ enabledOems: unique });
    res.json({
      success: true,
      data: settings,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

