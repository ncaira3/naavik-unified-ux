/**
 * Documentation Routes
 *
 *   POST /api/docs/search   { query, limit? }  → ranked sections with snippets
 *   POST /api/docs/chat     { question, history? } → grounded answer + citations
 *   GET  /api/docs/stats                       → index health check
 */
import express, { Request, Response } from 'express';
import {
  searchDocs,
  chatWithDocs,
  getDocsCorpusStats,
  initDocsRag,
} from '../services/docs-rag.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Lazy init — first hit warms the index.
let initPromise: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!initPromise) initPromise = initDocsRag().catch((err) => {
    logger.error('[docs] init failed', err);
    initPromise = null;
    throw err;
  });
  return initPromise;
}

router.post('/search', async (req: Request, res: Response) => {
  try {
    await ensureReady();
    const { query, limit = 8 } = req.body ?? {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'query is required' });
    }
    const results = await searchDocs(query, Math.min(20, Math.max(1, Number(limit) || 8)));
    return res.json({ success: true, data: { results, count: results.length } });
  } catch (err: any) {
    logger.error('[docs] search failed', err);
    return res.status(500).json({ success: false, error: err.message || 'search failed' });
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  try {
    await ensureReady();
    const { question, history } = req.body ?? {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, error: 'question is required' });
    }
    const safeHistory = Array.isArray(history)
      ? history
          .filter((h: any) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
          .slice(-10)
      : [];
    const response = await chatWithDocs(question, safeHistory);
    return res.json({ success: true, data: response });
  } catch (err: any) {
    logger.error('[docs] chat failed', err);
    return res.status(500).json({ success: false, error: err.message || 'chat failed' });
  }
});

router.get('/stats', async (_req: Request, res: Response) => {
  await ensureReady().catch(() => undefined);
  return res.json({ success: true, data: getDocsCorpusStats() });
});

export default router;
