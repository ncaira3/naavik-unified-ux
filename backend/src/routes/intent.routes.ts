/**
 * Intent Parsing Routes
 * Natural language query processing
 */
import { Router, Request, Response } from 'express';
import { IntentService } from '../services/intent.service.js';
import { AgentService } from '../services/agent.service.js';
import { AnomalyService } from '../services/anomaly.service.js';
import { RCAService } from '../services/rca.service.js';
import { UiCommandService } from '../services/ui-command.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/intent/parse
 * Parse natural language query and return structured intent
 */
router.post('/parse', asyncHandler(async (req: Request, res: Response) => {
  const { query } = req.body;
  
  if (!query || typeof query !== 'string') {
    throw new AppError(400, 'INVALID_QUERY', 'Query string is required');
  }
  
  const parsedIntent = await IntentService.parseIntent(query);
  
  res.json({
    success: true,
    data: parsedIntent,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/intent/execute
 * Parse query, execute agent workflow, and return results
 */
router.post('/execute', asyncHandler(async (req: Request, res: Response) => {
  const { query, context } = req.body;
  
  if (!query || typeof query !== 'string') {
    throw new AppError(400, 'INVALID_QUERY', 'Query string is required');
  }
  
  logger.info(`Executing intent: "${query}"`);
  
  // Step 1: Parse intent
  const parsedIntent = await IntentService.parseIntent(query);
  
  // Step 2: Execute based on intent type
  let workflowResult = null;
  let additionalData = null;
  
  switch (parsedIntent.intent) {
    case 'QUERY_DB':
      // Execute database query workflow
      additionalData = {
        message: 'I can query the database for you. Processing your request...',
        intent: 'QUERY_DB',
        action: 'redirect_to_query',
        query
      };
      break;
      
    case 'ANALYZE_DATA':
      // Execute analysis workflow
      additionalData = {
        message: 'Running data analysis...',
        intent: 'ANALYZE_DATA',
        action: 'redirect_to_analysis',
        query
      };
      break;
      
    case 'SHOW_MAP':
      // Prepare map visualization
      additionalData = {
        message: 'Preparing map visualization...',
        intent: 'SHOW_MAP',
        action: 'show_map'
      };
      break;
      
    case 'CREATE_DASHBOARD':
      // Dashboard creation
      additionalData = {
        message: 'Creating custom dashboard...',
        intent: 'CREATE_DASHBOARD',
        action: 'create_dashboard'
      };
      break;
      
    case 'CREATE_WORKFLOW':
      // Workflow creation
      additionalData = {
        message: 'Setting up automation workflow...',
        intent: 'CREATE_WORKFLOW',
        action: 'create_workflow'
      };
      break;
      
    case 'GENERATE_CODE':
      // Code generation
      additionalData = {
        message: 'Generating monitoring script...',
        intent: 'GENERATE_CODE',
        action: 'generate_code'
      };
      break;
    
    case 'OBSERVE':
    case 'ANALYZE_RCA':
      // Execute agent workflow
      workflowResult = await AgentService.executeObserveWorkflow(parsedIntent);
      additionalData = workflowResult.finalResult;
      break;
      
    case 'BUILD_APP':
      // Prepare app generation workflow
      additionalData = {
        message: 'App generation workflow ready. Please provide app requirements.',
        nextStep: 'Clarify requirements',
        intent: 'BUILD_APP'
      };
      break;
      
    case 'PROVISION':
      // Prepare provisioning workflow
      additionalData = {
        message: 'Provisioning workflow initiated. Provide site location and configuration.',
        nextStep: 'Configure site parameters',
        intent: 'PROVISION'
      };
      break;
      
    default:
      additionalData = {
        message: 'I can help with database queries, data analysis, maps, app building, workflows, code generation, or site provisioning. Could you clarify your request?',
      };
  }
  
  // Step 3: Generate natural language response
  const response = IntentService.generateResponse(parsedIntent, additionalData);
  
  res.json({
    success: true,
    data: {
      query,
      parsedIntent,
      response,
      workflow: workflowResult,
      additionalData,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/intent/ui-command
 * Interpret a chat message into UI actions (map navigation, open analysis, explain RCA).
 */
router.post('/ui-command', asyncHandler(async (req: Request, res: Response) => {
  const { query, currentView, selectedSiteToken, selectedDateId } = req.body || {};

  if (!query || typeof query !== 'string') {
    throw new AppError(400, 'INVALID_QUERY', 'Query string is required');
  }

  const result = await UiCommandService.interpret({
    query,
    currentView: typeof currentView === 'string' ? currentView : undefined,
    selectedSiteToken: typeof selectedSiteToken === 'string' ? selectedSiteToken : null,
    selectedDateId: typeof selectedDateId === 'string' ? selectedDateId : null,
  });

  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/intent/workflow/:workflowId
 * Get workflow execution history
 */
router.get('/workflow/:workflowId', asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params;
  
  const history = await AgentService.getWorkflowHistory(workflowId);
  
  res.json({
    success: true,
    data: {
      workflowId,
      agents: history,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/intent/observe
 * Direct endpoint for observe workflow (bypasses intent parsing)
 */
router.post('/observe', asyncHandler(async (req: Request, res: Response) => {
  const { filters } = req.body;
  
  // Create intent object
  const intent = {
    intent: 'OBSERVE' as const,
    confidence: 1.0,
    chainOfThought: ['Direct observe workflow request'],
    filters: filters || {},
    actionParams: {},
    executionTime: 0,
  };
  
  // Execute agent workflow
  const workflowResult = await AgentService.executeObserveWorkflow(intent);
  
  res.json({
    success: true,
    data: workflowResult,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
