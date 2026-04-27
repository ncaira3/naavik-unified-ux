/**
 * App Generation Routes
 * GenAI conversational app builder
 */
import { Router, Request, Response } from 'express';
import { AppService } from '../services/app.service.js';
import { AppGenAgentService } from '../services/appgen-agent.service.js';
import { DEMO_SCENARIOS, getDemoScenario } from '../services/demo-conversations.js';
import { matchHardcodedScenario } from '../services/scenario-matcher.service.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { DeploymentTarget } from '../types/index.js';

const router = Router();

/**
 * POST /api/apps/generate
 * Generate or continue app generation conversation
 */
router.post('/generate', asyncHandler(async (req: Request, res: Response) => {
  const { userIntent, conversationId, refinements } = req.body;
  
  if (!userIntent || typeof userIntent !== 'string') {
    throw new AppError(400, 'INVALID_INTENT', 'userIntent string is required');
  }
  
  const response = await AppService.generateApp({
    userIntent,
    conversationId,
    refinements,
  });
  
  res.json({
    success: true,
    data: response,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps
 * Get all generated/deployed apps
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const apps = await AppService.getAllApps();
  
  res.json({
    success: true,
    data: apps,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps/:appId
 * Get specific app details
 */
router.get('/:appId', asyncHandler(async (req: Request, res: Response) => {
  const { appId } = req.params;
  
  const app = await AppService.getAppById(appId);
  
  if (!app) {
    throw new AppError(404, 'APP_NOT_FOUND', `App ${appId} not found`);
  }
  
  res.json({
    success: true,
    data: app,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/apps/:appId/deploy
 * Deploy app to target platform
 */
router.post('/:appId/deploy', asyncHandler(async (req: Request, res: Response) => {
  const { appId } = req.params;
  const { target } = req.body;
  
  if (!target || !Object.values(DeploymentTarget).includes(target)) {
    throw new AppError(400, 'INVALID_TARGET', 'Valid deployment target is required');
  }
  
  // Check if app exists
  const app = await AppService.getAppById(appId);
  if (!app) {
    throw new AppError(404, 'APP_NOT_FOUND', `App ${appId} not found`);
  }
  
  // Deploy app
  await AppService.deployApp(appId, target as DeploymentTarget);
  
  res.json({
    success: true,
    data: {
      appId,
      target,
      status: 'DEPLOYED',
      message: `App deployed to ${target}`,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * DELETE /api/apps/:appId
 * Delete app
 */
router.delete('/:appId', asyncHandler(async (req: Request, res: Response) => {
  const { appId } = req.params;
  
  // Check if app exists
  const app = await AppService.getAppById(appId);
  if (!app) {
    throw new AppError(404, 'APP_NOT_FOUND', `App ${appId} not found`);
  }
  
  await AppService.deleteApp(appId);
  
  res.json({
    success: true,
    data: {
      appId,
      message: 'App deleted successfully',
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps/:appId/code
 * Get generated Python code
 */
router.get('/:appId/code', asyncHandler(async (req: Request, res: Response) => {
  const { appId } = req.params;
  
  const app = await AppService.getAppById(appId);
  
  if (!app) {
    throw new AppError(404, 'APP_NOT_FOUND', `App ${appId} not found`);
  }
  
  // Return code as plain text
  res.set('Content-Type', 'text/plain');
  res.send(app.spec.pythonCode);
}));

/**
 * POST /api/apps/agent/chat
 * Agent-based conversational app building (multi-turn with state)
 * Request: { message: string, threadId?: string }
 * Response: { threadId, messages, workflow, code, nextAction, pendingQuestion }
 * Hardcoded scenario matcher runs first - when user input matches known scenarios,
 * returns scripted response + workflow + code without calling LLM.
 */
router.post('/agent/chat', asyncHandler(async (req: Request, res: Response) => {
  const { message, threadId } = req.body;
  
  if (!message || typeof message !== 'string') {
    throw new AppError(400, 'INVALID_MESSAGE', 'message string is required');
  }
  
  // Check hardcoded scenarios first (works in non-demo mode, no OpenAI needed)
  const existingState = threadId ? AppGenAgentService.getState(threadId) : null;
  const existingMessages = (existingState?.messages || []).map(m => ({ role: m.role, content: m.content }));
  
  const scenarioMatch = matchHardcodedScenario(existingMessages, message);
  
  if (scenarioMatch) {
    const state = AppGenAgentService.getOrCreateState(threadId);
    state.messages.push({ role: 'user', content: message });
    state.messages.push({ role: 'assistant', content: scenarioMatch.assistantResponse });
    if (scenarioMatch.workflow) state.workflow = scenarioMatch.workflow;
    if (scenarioMatch.generatedCode) state.generatedCode = scenarioMatch.generatedCode;
    state.nextAction = scenarioMatch.isComplete ? 'done' : null;
    
    return res.json({
      success: true,
      data: {
        threadId: state.threadId,
        messages: state.messages,
        workflow: state.workflow,
        generatedCode: state.generatedCode,
        nextAction: state.nextAction,
        pendingQuestion: null,
        searchResults: [],
        fromHardcodedScenario: scenarioMatch.scenarioId,
      },
      timestamp: new Date().toISOString(),
    });
  }
  
  const state = await AppGenAgentService.processMessage(threadId, message);
  
  res.json({
    success: true,
    data: {
      threadId: state.threadId,
      messages: state.messages,
      workflow: state.workflow,
      generatedCode: state.generatedCode,
      nextAction: state.nextAction,
      pendingQuestion: state.pendingQuestion,
      searchResults: state.searchResults.map(r => ({
        name: r.function.name,
        description: r.function.description,
        signature: r.function.signature,
      })),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps/agent/state/:threadId
 * Get current agent state for a conversation thread
 */
router.get('/agent/state/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  
  const state = AppGenAgentService.getState(threadId);
  
  if (!state) {
    throw new AppError(404, 'THREAD_NOT_FOUND', `Thread ${threadId} not found`);
  }
  
  res.json({
    success: true,
    data: {
      threadId: state.threadId,
      messages: state.messages,
      workflow: state.workflow,
      generatedCode: state.generatedCode,
      nextAction: state.nextAction,
      pendingQuestion: state.pendingQuestion,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/apps/agent/search
 * Search function library
 */
router.post('/agent/search', asyncHandler(async (req: Request, res: Response) => {
  const { query, limit = 5 } = req.body;
  
  if (!query || typeof query !== 'string') {
    throw new AppError(400, 'INVALID_QUERY', 'query string is required');
  }
  
  const results = await AppGenAgentService.searchFunctions(query, limit);
  
  res.json({
    success: true,
    data: results.map(r => ({
      name: r.function.name,
      description: r.function.description,
      signature: r.function.signature,
      score: r.score,
    })),
    count: results.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps/agent/health
 * Test agent service health (no auth required for debugging)
 */
router.get('/agent/health', asyncHandler(async (req: Request, res: Response) => {
  const testResults = await AppGenAgentService.searchFunctions('rsrp', 2);
  
  res.json({
    success: true,
    data: {
      functionLibraryLoaded: testResults.length > 0,
      functionsFound: testResults.length,
      sampleFunctions: testResults.map(r => r.function.name),
      openaiConfigured: !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key',
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps/demo/scenarios
 * Get available demo conversation scenarios
 */
router.get('/demo/scenarios', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: DEMO_SCENARIOS.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      messageCount: s.conversation.length,
    })),
    count: DEMO_SCENARIOS.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/apps/demo/:scenarioId
 * Get a specific demo scenario with full conversation and workflow
 */
router.get('/demo/:scenarioId', asyncHandler(async (req: Request, res: Response) => {
  const { scenarioId } = req.params;
  
  const scenario = getDemoScenario(scenarioId);
  
  if (!scenario) {
    throw new AppError(404, 'SCENARIO_NOT_FOUND', `Demo scenario ${scenarioId} not found`);
  }
  
  res.json({
    success: true,
    data: scenario,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
