import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { ConversationalBuilderService } from '../services/conversational-builder.service.js';

const router = Router();

/**
 * POST /api/conversational-builder/v1/chat
 * Body: { threadId?, message, channel: "appstore"|"main_chat" }
 */
router.post('/v1/chat', asyncHandler(async (req: Request, res: Response) => {
  const { threadId, message, channel = 'appstore' } = req.body as {
    threadId?: string;
    message?: string;
    channel?: 'appstore' | 'main_chat';
  };

  if (!message || typeof message !== 'string') {
    throw new AppError(400, 'INVALID_MESSAGE', 'message string is required');
  }
  if (channel !== 'appstore' && channel !== 'main_chat') {
    throw new AppError(400, 'INVALID_CHANNEL', 'channel must be "appstore" or "main_chat"');
  }

  const userId = (req as any).user?.id;
  const result = await ConversationalBuilderService.chat({ threadId, message, channel, userId });
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/conversational-builder/v1/state/:threadId
 */
router.get('/v1/state/:threadId', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const state = await ConversationalBuilderService.getState(threadId);
  if (!state) {
    throw new AppError(404, 'THREAD_NOT_FOUND', `Thread ${threadId} not found`);
  }
  res.json({
    success: true,
    data: state,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/conversational-builder/v1/generate
 * Body: { threadId }
 */
router.post('/v1/generate', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.body as { threadId?: string };
  if (!threadId || typeof threadId !== 'string') {
    throw new AppError(400, 'INVALID_THREAD', 'threadId is required');
  }
  const result = await ConversationalBuilderService.generate(threadId);
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/conversational-builder/v1/package-rapp
 * Body: { threadId }
 */
router.post('/v1/package-rapp', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.body as { threadId?: string };
  if (!threadId || typeof threadId !== 'string') {
    throw new AppError(400, 'INVALID_THREAD', 'threadId is required');
  }
  const result = await ConversationalBuilderService.packageRapp(threadId);
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/conversational-builder/v1/reset
 * Body: { threadId }
 */
router.post('/v1/reset', asyncHandler(async (req: Request, res: Response) => {
  const { threadId } = req.body as { threadId?: string };
  if (!threadId || typeof threadId !== 'string') {
    throw new AppError(400, 'INVALID_THREAD', 'threadId is required');
  }
  await ConversationalBuilderService.reset(threadId);
  res.json({
    success: true,
    data: { threadId, reset: true },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/conversational-builder/v1/sessions
 * List recent conversation sessions for the current user
 */
router.get('/v1/sessions', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'User ID is required');
  }
  const limit = Number((req.query.limit as string) || 20);
  const sessions = await ConversationalBuilderService.listSessionsByUser(userId, limit);
  res.json({
    success: true,
    data: sessions,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
