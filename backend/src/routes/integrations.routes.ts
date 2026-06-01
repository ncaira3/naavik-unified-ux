/**
 * /api/integrations — admin CRUD for external-agent and external-tool wiring.
 *
 *   GET    /api/integrations/mcp                    list MCP servers
 *   POST   /api/integrations/mcp                    create
 *   PUT    /api/integrations/mcp/:id                update (partial)
 *   DELETE /api/integrations/mcp/:id
 *   GET    /api/integrations/mcp/:id/capabilities   force-refresh + return tools/resources/prompts
 *   GET    /api/integrations/mcp/health             health snapshot for every server
 *
 *   GET    /api/integrations/a2a                    list A2A agents
 *   POST   /api/integrations/a2a
 *   PUT    /api/integrations/a2a/:id
 *   DELETE /api/integrations/a2a/:id
 *   GET    /api/integrations/a2a/:id/card           force-refresh Agent Card + return skills
 *   GET    /api/integrations/a2a/health             health snapshot for every agent
 *
 *   GET    /api/integrations/secrets/provider       which provider is active
 *
 * All endpoints are protected by the standard auth middleware mounted in
 * server.ts. Secret values are write-only on the wire — they're never
 * returned in GET responses.
 */
import express, { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { mcpRegistry } from '../services/mcp-client/registry.service.js';
import { mcpClientManager } from '../services/mcp-client/client-manager.js';
import { a2aRegistry } from '../services/a2a-client/registry.service.js';
import { getSecretProvider } from '../services/secrets/index.js';

const router = express.Router();

// ─── MCP ────────────────────────────────────────────────────────────────────

router.get('/mcp', async (_req, res) => {
  try {
    const servers = await mcpRegistry.list();
    res.json({ success: true, data: servers });
  } catch (err) {
    logger.error('[integrations] mcp list failed', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/mcp', async (req: Request, res: Response) => {
  try {
    const cfg = await mcpRegistry.create(req.body ?? {});
    res.status(201).json({ success: true, data: cfg });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.put('/mcp/:id', async (req: Request, res: Response) => {
  try {
    const cfg = await mcpRegistry.update(req.params.id, req.body ?? {});
    if (!cfg) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, data: cfg });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.delete('/mcp/:id', async (req: Request, res: Response) => {
  try {
    const ok = await mcpRegistry.delete(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/mcp/:id/capabilities', async (req: Request, res: Response) => {
  try {
    const caps = await mcpClientManager.getCapabilities(req.params.id);
    res.json({ success: true, data: caps });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/mcp/health', (_req, res) => {
  res.json({ success: true, data: mcpClientManager.listHealth() });
});

// ─── A2A ────────────────────────────────────────────────────────────────────

router.get('/a2a', async (_req, res) => {
  try {
    const agents = await a2aRegistry.list();
    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/a2a', async (req: Request, res: Response) => {
  try {
    const cfg = await a2aRegistry.create(req.body ?? {});
    res.status(201).json({ success: true, data: cfg });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.put('/a2a/:id', async (req: Request, res: Response) => {
  try {
    const cfg = await a2aRegistry.update(req.params.id, req.body ?? {});
    if (!cfg) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, data: cfg });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.delete('/a2a/:id', async (req: Request, res: Response) => {
  try {
    const ok = await a2aRegistry.delete(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/a2a/:id/card', async (req: Request, res: Response) => {
  try {
    const cfg = await a2aRegistry.get(req.params.id);
    if (!cfg) return res.status(404).json({ success: false, error: 'not found' });
    const card = await a2aRegistry.getCard(cfg, true);
    res.json({ success: true, data: { card, health: a2aRegistry.healthOf(cfg.id) } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/a2a/health', (_req, res) => {
  res.json({ success: true, data: a2aRegistry.listHealth() });
});

// ─── Secret provider info ──────────────────────────────────────────────────

router.get('/secrets/provider', async (_req, res) => {
  try {
    const provider = await getSecretProvider();
    res.json({ success: true, data: { kind: provider.kind } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
