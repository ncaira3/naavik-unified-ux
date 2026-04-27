/**
 * Parameter API Routes
 * Endpoints for Ericsson parameter management
 */
import express, { Request, Response } from 'express';
import { ParameterService } from '../services/parameter.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/parameters
 * List all parameters with pagination and filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { moClass, search, readOnly, mandatory, deprecated, model, limit, offset } = req.query;
    
    const filters: any = {
      moClass: moClass as string,
      search: search as string,
      model: model as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0
    };
    
    if (readOnly !== undefined) filters.readOnly = readOnly === 'true';
    if (mandatory !== undefined) filters.mandatory = mandatory === 'true';
    if (deprecated !== undefined) filters.deprecated = deprecated === 'true';
    
    const result = await ParameterService.searchParameters(filters);
    
    res.json({
      success: true,
      data: result.parameters,
      pagination: {
        total: result.total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: (filters.offset + filters.limit) < result.total
      }
    });
    
  } catch (error: any) {
    logger.error('Failed to list parameters', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve parameters',
      message: error.message
    });
  }
});

/**
 * GET /api/parameters/search
 * Search parameters by name or description
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, moClass, limit } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query required'
      });
    }
    
    const result = await ParameterService.searchParameters({
      search: q as string,
      moClass: moClass as string,
      limit: limit ? parseInt(limit as string) : 20
    });
    
    res.json({
      success: true,
      data: result.parameters,
      total: result.total
    });
    
  } catch (error: any) {
    logger.error('Parameter search failed', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

/**
 * GET /api/parameters/mo-classes/list
 * List all MO classes (must be before /:parameterId)
 */
router.get('/mo-classes/list', async (req: Request, res: Response) => {
  try {
    const moClasses = await ParameterService.getMOClasses();
    
    res.json({
      success: true,
      data: moClasses
    });
    
  } catch (error: any) {
    logger.error('Failed to get MO classes', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve MO classes',
      message: error.message
    });
  }
});

/**
 * GET /api/parameters/mo-class/:moClass
 * Get parameters for a specific MO class
 */
router.get('/mo-class/:moClass', async (req: Request, res: Response) => {
  try {
    const { moClass } = req.params;
    
    const parameters = await ParameterService.getParametersByMOClass(moClass);
    
    res.json({
      success: true,
      data: parameters,
      moClass,
      count: parameters.length
    });
    
  } catch (error: any) {
    logger.error('Failed to get parameters for MO class', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve parameters',
      message: error.message
    });
  }
});

/**
 * GET /api/parameters/stats/summary
 * Get parameter statistics (must be before /:parameterId)
 */
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const stats = await ParameterService.getStatistics();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error: any) {
    logger.error('Failed to get parameter statistics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/parameters/:parameterId
 * Get parameter by ID (must be last among GET routes)
 */
router.get('/:parameterId', async (req: Request, res: Response) => {
  try {
    const parameterId = parseInt(req.params.parameterId);
    
    if (isNaN(parameterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid parameter ID'
      });
    }
    
    const parameter = await ParameterService.getParameterById(parameterId);
    
    if (!parameter) {
      return res.status(404).json({
        success: false,
        error: 'Parameter not found'
      });
    }
    
    res.json({
      success: true,
      data: parameter
    });
    
  } catch (error: any) {
    logger.error('Failed to get parameter', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve parameter',
      message: error.message
    });
  }
});

export default router;
