import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { AgentOrchestratorService } from '../services/agent-orchestrator.service.js';
import { AgentOrchestratorV3 } from '../services/agent-orchestrator-v3.service.js';
import { dbSchemaRef } from '../services/db-schema-reference.service.js';
import { dataSyncService } from '../services/data-sync.service.js';
import { checkScope } from '../services/guardrails.service.js';
import { answerClarification } from '../services/clarification-store.js';
import type { SseEvent } from '../types/sse-events.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// /agent/v3/chat — true tool-use loop. The LLM picks tools from the registry
// and may call multiple in sequence. Falls back to v2 contract on the wire
// (same threadId + assistantMessage shape) so the frontend can swap easily.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/v3/chat',
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, message, currentView, stream } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      throw new AppError(400, 'MISSING_MESSAGE', 'message is required and must be a non-empty string');
    }
    if (message.length > 5000) {
      throw new AppError(400, 'MESSAGE_TOO_LONG', 'message must be 5000 characters or less');
    }
    if (threadId !== undefined && (typeof threadId !== 'string' || threadId.length > 500)) {
      throw new AppError(400, 'INVALID_THREAD_ID', 'threadId must be a string of 500 characters or less');
    }
    const result = await AgentOrchestratorV3.chat({
      threadId,
      message: message.trim(),
      currentView: typeof currentView === 'string' ? currentView : undefined,
      stream: typeof stream === 'string' ? stream : undefined,
    });
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/v3/stream — Server-Sent Events streaming version of /v3/chat.
//
// Emits the following event types as the agent works:
//   tool_start / tool_end  → live tool-call visibility (AgentActivityCard)
//   token                  → streamed assistant text
//   block                  → uiBlock JSON, rendered inline as it arrives
//   command                → uiCommand JSON (map/KPI control)
//   clarification          → suspends until POST /v3/clarify is called
//   done                   → final synthesis + trace
//   error                  → unrecoverable failure
//
// Frontend hook: useAgentStream() in src/hooks/useAgentStream.ts
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/v3/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, message, currentView } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      throw new AppError(400, 'MISSING_MESSAGE', 'message is required');
    }
    if (message.length > 5000) {
      throw new AppError(400, 'MESSAGE_TOO_LONG', 'message must be 5000 characters or less');
    }
    if (threadId !== undefined && (typeof threadId !== 'string' || threadId.length > 500)) {
      throw new AppError(400, 'INVALID_THREAD_ID', 'threadId must be a string');
    }

    // SSE handshake
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders?.();

    const send = (e: SseEvent) => {
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch (err) {
        logger.warn('[agent-v3 stream] write failed', err);
      }
    };

    // Guard 3 — scope enforcement (block clearly off-topic messages)
    const scopeIssue = checkScope(message);
    if (scopeIssue) {
      send({ type: 'token', delta: scopeIssue });
      send({ type: 'done', fullText: scopeIssue, trace: [] });
      res.end();
      return;
    }

    // Progress heartbeat every 20 s.
    // Sends a real `progress` SSE event (visible to the frontend) so the UI
    // can show elapsed time and suppress false "stalled" warnings during
    // long-running analyses (RCA pipeline can take 30–120 s).
    // Also writes a TCP-level comment for proxy keepalive.
    const requestStart = Date.now();
    const heartbeat = setInterval(() => {
      const elapsedMs = Date.now() - requestStart;
      const minutes = Math.floor(elapsedMs / 60_000);
      const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
      const timeLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      const message =
        elapsedMs > 90_000
          ? `Still working… complex analysis in progress (${timeLabel})`
          : elapsedMs > 40_000
          ? `Still working… this may take a moment (${timeLabel})`
          : `Working… (${timeLabel})`;
      try {
        send({ type: 'progress', elapsedMs, message } as SseEvent);
        res.write(': heartbeat\n\n'); // proxy TCP keepalive
      } catch {
        clearInterval(heartbeat);
      }
    }, 20_000);

    // Detect client disconnect — useful to stop wasted work, though the
    // orchestrator doesn't yet propagate cancellation into tool execution.
    req.on('close', () => {
      clearInterval(heartbeat);
    });

    try {
      const result = await AgentOrchestratorV3.chat({
        threadId,
        message: message.trim(),
        currentView: typeof currentView === 'string' ? currentView : undefined,
        onEvent: send,
      });

      // Final done event with the full assembled response so the frontend can
      // persist the message exactly the same way the atomic /v3/chat does.
      send({
        type: 'done',
        fullText: result.assistantMessage,
        trace: result.trace,
      });
    } catch (err) {
      logger.error('[agent-v3 stream] orchestrator threw', err);
      send({
        type: 'error',
        message: `Agent error: ${(err as Error).message ?? 'unknown'}`,
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/v3/clarify — answer a pending clarification.
//
// Body: { id: string, answer: string }
//
// The orchestrator's ask_clarification tool is suspended on a Promise keyed by
// `id` in the in-memory clarification store. Posting an answer here resolves
// that Promise so the orchestrator can continue. The user's SSE connection
// stays open the whole time — no second WebSocket needed.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/v3/clarify',
  asyncHandler(async (req: Request, res: Response) => {
    const { id, answer } = req.body || {};
    if (typeof id !== 'string' || !id.trim()) {
      throw new AppError(400, 'MISSING_ID', 'id is required');
    }
    if (typeof answer !== 'string') {
      throw new AppError(400, 'MISSING_ANSWER', 'answer must be a string');
    }
    const ok = answerClarification(id.trim(), answer);
    res.json({
      success: true,
      data: { resolved: ok },
      timestamp: new Date().toISOString(),
    });
  }),
);

router.post(
  '/v2/chat',
  asyncHandler(async (req: Request, res: Response) => {
    const { threadId, message, stream, currentView, action, attachments } = req.body || {};

    // Validate message is a non-empty string
    if (typeof message !== 'string' || !message.trim()) {
      throw new AppError(400, 'MISSING_MESSAGE', 'message is required and must be a non-empty string');
    }

    // Validate message length (max 5000 characters to prevent abuse)
    if (message.length > 5000) {
      throw new AppError(400, 'MESSAGE_TOO_LONG', 'message must be 5000 characters or less');
    }

    // Validate threadId if provided
    if (threadId !== undefined && (typeof threadId !== 'string' || threadId.length > 500)) {
      throw new AppError(400, 'INVALID_THREAD_ID', 'threadId must be a string of 500 characters or less');
    }

    // Validate attachments if provided (CSV text or images as data URLs)
    if (attachments !== undefined) {
      if (!Array.isArray(attachments)) {
        throw new AppError(400, 'INVALID_ATTACHMENTS', 'attachments must be an array');
      }
      if (attachments.length > 3) {
        throw new AppError(400, 'TOO_MANY_ATTACHMENTS', 'attachments must be 3 files or fewer');
      }
      for (const att of attachments) {
        if (!att || typeof att !== 'object') {
          throw new AppError(400, 'INVALID_ATTACHMENT', 'attachment must be an object');
        }
        const kind = (att as any).kind;
        const name = (att as any).name;
        const text = (att as any).text;
        const dataUrl = (att as any).dataUrl;
        if (kind !== 'csv' && kind !== 'image') {
          throw new AppError(400, 'INVALID_ATTACHMENT_KIND', 'attachment.kind must be "csv" or "image"');
        }
        if (typeof name !== 'string' || !name.trim() || name.length > 200) {
          throw new AppError(400, 'INVALID_ATTACHMENT_NAME', 'attachment.name must be a non-empty string (<= 200 chars)');
        }
        if (text !== undefined && (typeof text !== 'string' || text.length > 200_000)) {
          throw new AppError(400, 'INVALID_ATTACHMENT_TEXT', 'attachment.text must be a string (<= 200k chars)');
        }
        if (dataUrl !== undefined && (typeof dataUrl !== 'string' || dataUrl.length > 1_600_000)) {
          throw new AppError(400, 'INVALID_ATTACHMENT_DATA_URL', 'attachment.dataUrl must be a string (<= 1.6M chars)');
        }
      }
    }

    const result = await AgentOrchestratorService.chat({
      threadId,
      message: message.trim(),
      stream: typeof stream === 'string' ? stream : undefined,
      currentView: typeof currentView === 'string' ? currentView : undefined,
      attachments: Array.isArray(attachments) ? attachments : undefined,
      action:
        action && typeof action === 'object'
          ? {
              type: action.type,
              actionId: action.actionId,
            }
          : undefined,
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/admin/refresh-schema
// Re-queries the live DB for distinct KPI and subcomponent names, updates the
// schema-reference cache used by the LLM for SQL generation.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/admin/refresh-schema',
  asyncHandler(async (_req: Request, res: Response) => {
    const cache = await dbSchemaRef.refresh();
    res.json({
      success: true,
      data: {
        refreshedAt: cache.refreshedAt,
        kpiCount: cache.kpiNames.combined.length,
        subcomponentCount: cache.subcomponentNames.length,
        kpiNames: cache.kpiNames.combined,
        subcomponentNames: cache.subcomponentNames,
      },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/admin/sync-topology
// Trigger a manual sync of site topology and cell sectors from remote MSSQL.
// Returns current sync status immediately; sync runs in background.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/admin/sync-topology',
  asyncHandler(async (req: Request, res: Response) => {
    const { target = 'all' } = req.body as { target?: 'sites' | 'sectors' | 'all' };
    const status = dataSyncService.getStatus();

    if (target === 'sites' || target === 'all') {
      void dataSyncService.syncSiteTopology().catch(() => {});
    }
    if (target === 'sectors' || target === 'all') {
      void dataSyncService.syncCellSectors().catch(() => {});
    }

    res.json({
      success: true,
      data: {
        message: `Sync triggered for: ${target}`,
        status,
      },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/admin/sync-status
// Returns current sync status for site topology and cell sectors.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/admin/sync-status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: dataSyncService.getStatus(),
    });
  })
);

export default router;
