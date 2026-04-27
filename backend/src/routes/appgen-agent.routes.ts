import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { AppGenUnifiedAgentService } from '../services/appgen-unified-agent.service.js';
import { ConversationMemoryService } from '../services/conversation-memory.service.js';
import { ProgressiveAppGenService } from '../services/progressive-appgen.service.js';
import type { AppGenAgentChannel } from '../types/conversational-builder.js';

const router = Router();

const isValidChannel = (value: unknown): value is AppGenAgentChannel =>
  value === 'home_build' || value === 'appgen_chat';

router.post('/v1/chat', asyncHandler(async (req: Request, res: Response) => {
  const { threadId, message, channel = 'appgen_chat' } = req.body as {
    threadId?: string;
    message?: string;
    channel?: AppGenAgentChannel;
  };

  if (!message || typeof message !== 'string') {
    throw new AppError(400, 'INVALID_MESSAGE', 'message string is required');
  }
  if (!isValidChannel(channel)) {
    throw new AppError(400, 'INVALID_CHANNEL', 'channel must be "home_build" or "appgen_chat"');
  }

  const result = await AppGenUnifiedAgentService.chat({ threadId, message, channel });
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/v1/state/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const channel = isValidChannel(req.query.channel) ? req.query.channel : 'appgen_chat';
  const state = await AppGenUnifiedAgentService.getState(threadId, channel);
  if (!state) {
    throw new AppError(404, 'THREAD_NOT_FOUND', `Thread ${threadId} not found`);
  }
  res.json({
    success: true,
    data: state,
    timestamp: new Date().toISOString(),
  });
}));

router.post('/v1/generate', asyncHandler(async (req: Request, res: Response) => {
  const { threadId, authorizationToken } = req.body as { threadId?: string; authorizationToken?: string };
  if (!threadId || typeof threadId !== 'string') {
    throw new AppError(400, 'INVALID_THREAD', 'threadId is required');
  }
  if (!authorizationToken || typeof authorizationToken !== 'string') {
    throw new AppError(400, 'INVALID_AUTHORIZATION', 'authorizationToken is required');
  }
  const result = await AppGenUnifiedAgentService.generate(threadId, authorizationToken);
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

router.post('/v1/package-rapp', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.body as { threadId?: string };
  if (!threadId || typeof threadId !== 'string') {
    throw new AppError(400, 'INVALID_THREAD', 'threadId is required');
  }
  const result = await AppGenUnifiedAgentService.packageRapp(threadId);
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

router.post('/v1/reset', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.body as { threadId?: string };
  if (!threadId || typeof threadId !== 'string') {
    throw new AppError(400, 'INVALID_THREAD', 'threadId is required');
  }
  await AppGenUnifiedAgentService.reset(threadId);
  res.json({
    success: true,
    data: { threadId, reset: true },
    timestamp: new Date().toISOString(),
  });
}));

// Memory and Context endpoints
router.get('/v1/context/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const context = await ConversationMemoryService.buildContext(threadId);
  await ConversationMemoryService.saveContext(context);
  res.json({
    success: true,
    data: context,
    timestamp: new Date().toISOString(),
  });
}));

// Progressive app building endpoints
router.get('/v1/app-state/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const appState = await ProgressiveAppGenService.getAppState(threadId);
  res.json({
    success: true,
    data: appState,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/v1/suggestions/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const slotType = req.query.slotType as string | undefined;
  let suggestions;

  if (slotType) {
    suggestions = await ProgressiveAppGenService.refineSuggestions(threadId, slotType);
  } else {
    const appState = await ProgressiveAppGenService.getAppState(threadId);
    suggestions = appState.suggestions;
  }

  res.json({
    success: true,
    data: suggestions,
    timestamp: new Date().toISOString(),
  });
}));

router.get('/v1/help/:slotType', asyncHandler(async (req: Request, res: Response) => {
  const { slotType } = req.params;
  const helpText = ProgressiveAppGenService.getHelpText(slotType);
  res.json({
    success: true,
    data: { slotType, helpText },
    timestamp: new Date().toISOString(),
  });
}));

router.get('/v1/validate/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const validation = await ProgressiveAppGenService.validateProgressiveState(threadId);
  res.json({
    success: true,
    data: validation,
    timestamp: new Date().toISOString(),
  });
}));

export default router;

