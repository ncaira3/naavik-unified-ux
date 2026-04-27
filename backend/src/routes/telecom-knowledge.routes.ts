/**
 * Telecom Knowledge API Routes
 * Endpoints for parameters, KPIs, search, and Q&A
 */
import express, { Request, Response } from 'express';
import { TelecomKnowledgeService } from '../services/telecom-knowledge.service.js';
import { ParameterKPIMapperService } from '../services/parameter-kpi-mapper.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/telecom-knowledge/search
 * Semantic search across parameters and KPIs
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 10 } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const results = await TelecomKnowledgeService.search(query, limit);
    
    res.json({
      success: true,
      data: {
        results,
        count: results.length
      }
    });
    
  } catch (error: any) {
    logger.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      message: error.message
    });
  }
});

/**
 * POST /api/telecom-knowledge/ask
 * Answer questions using RAG
 */
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { question, context, conversationHistory } = req.body;
    
    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Question is required'
      });
    }
    
    const response = await TelecomKnowledgeService.answerQuestion(
      question,
      context as string | undefined,
      Array.isArray(conversationHistory) ? conversationHistory : undefined,
    );
    
    res.json({
      success: true,
      data: response
    });
    
  } catch (error: any) {
    logger.error('Q&A error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to answer question',
      message: error.message
    });
  }
});

/**
 * POST /api/telecom-knowledge/resolve
 * Resolve natural language to canonical parameter/KPI
 */
router.post('/resolve', async (req: Request, res: Response) => {
  try {
    const { type, nlInput } = req.body;
    
    if (!type || !nlInput) {
      return res.status(400).json({
        success: false,
        error: 'type and nlInput are required'
      });
    }
    
    if (type !== 'parameter' && type !== 'kpi') {
      return res.status(400).json({
        success: false,
        error: 'type must be "parameter" or "kpi"'
      });
    }
    
    let result;
    if (type === 'parameter') {
      result = await ParameterKPIMapperService.resolveParameter(nlInput);
    } else {
      result = await ParameterKPIMapperService.resolveKPI(nlInput);
    }
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('Resolve error:', error);
    res.status(500).json({
      success: false,
      error: 'Resolution failed',
      message: error.message
    });
  }
});

/**
 * GET /api/telecom-knowledge/parameters
 * List parameters with pagination
 */
router.get('/parameters', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const category = req.query.category as string;
    
    const result = await TelecomKnowledgeService.listParameters(limit, offset, category);
    
    res.json({
      success: true,
      data: {
        parameters: result.parameters,
        pagination: {
          total: result.total,
          limit,
          offset
        }
      }
    });
    
  } catch (error: any) {
    logger.error('List parameters error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list parameters',
      message: error.message
    });
  }
});

/**
 * GET /api/telecom-knowledge/parameters/:id
 * Get parameter by ID
 */
router.get('/parameters/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid parameter ID'
      });
    }
    
    const parameter = await TelecomKnowledgeService.getParameterById(id);
    
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
    logger.error('Get parameter error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get parameter',
      message: error.message
    });
  }
});

/**
 * GET /api/telecom-knowledge/kpis
 * List KPIs with pagination
 */
router.get('/kpis', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const category = req.query.category as string;
    
    const result = await TelecomKnowledgeService.listKPIs(limit, offset, category);
    
    res.json({
      success: true,
      data: {
        kpis: result.kpis,
        pagination: {
          total: result.total,
          limit,
          offset
        }
      }
    });
    
  } catch (error: any) {
    logger.error('List KPIs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list KPIs',
      message: error.message
    });
  }
});

/**
 * GET /api/telecom-knowledge/kpis/:id
 * Get KPI by ID
 */
router.get('/kpis/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid KPI ID'
      });
    }
    
    const kpi = await TelecomKnowledgeService.getKPIById(id);
    
    if (!kpi) {
      return res.status(404).json({
        success: false,
        error: 'KPI not found'
      });
    }
    
    res.json({
      success: true,
      data: kpi
    });
    
  } catch (error: any) {
    logger.error('Get KPI error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get KPI',
      message: error.message
    });
  }
});

export default router;
