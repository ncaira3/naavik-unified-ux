/**
 * Automation API Routes
 * Endpoints for intent-based automation and action execution
 */
import express, { Request, Response } from 'express';
import { AutomationPipelineService } from '../services/automation-pipeline.service.js';
import { AppService } from '../services/app.service.js';
import { WorkflowGeneratorService } from '../services/workflow-generator.service.js';
import { GeneratedAppModel } from '../models/generated-app.model.js';
import { FlowTestService } from '../services/flow-test.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/automation/app-chat
 * LLM-driven conversational app builder (OpenAI)
 */
router.post('/app-chat', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'messages array is required',
      });
    }
    const result = await AppService.appChat(messages);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('App chat failed', error);
    res.status(500).json({
      success: false,
      error: 'App chat failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/automation/analyze-intent
 * Process natural language intent → report + actions
 */
router.post('/analyze-intent', async (req: Request, res: Response) => {
  try {
    const { query, userId, reportDate } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const result = await AutomationPipelineService.processIntent(query, userId, reportDate);
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('Intent analysis failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze intent',
      message: error.message
    });
  }
});

/**
 * POST /api/automation/execute-action
 * Execute an action button
 */
router.post('/execute-action', async (req: Request, res: Response) => {
  try {
    const { actionId, actionName, context, userId } = req.body;
    
    if (!actionId || !actionName) {
      return res.status(400).json({
        success: false,
        error: 'actionId and actionName are required'
      });
    }
    
    const result = await AutomationPipelineService.executeAction(
      actionId,
      actionName,
      context || {},
      userId
    );
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('Action execution failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute action',
      message: error.message
    });
  }
});

/**
 * POST /api/automation/generate-eiap
 * Generate EIAP code from natural language
 */
router.post('/generate-eiap', async (req: Request, res: Response) => {
  try {
    const { naturalLanguageInput, userId } = req.body;
    
    if (!naturalLanguageInput) {
      return res.status(400).json({
        success: false,
        error: 'naturalLanguageInput is required'
      });
    }
    
    const result = await AppService.generateEIAPCode(naturalLanguageInput, userId);
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('EIAP generation failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate EIAP code',
      message: error.message
    });
  }
});

/**
 * Build simple WorkflowJSON from EIAP result metadata (for flowchart display)
 */
function buildWorkflowFromEIAP(eiapResult: { conditions: any[]; actions: any[]; appName: string }): any {
  const nodes: any[] = [
    { id: 'start', type: 'start', position: { x: 150, y: 0 }, data: { label: 'Start' } },
    { id: 'loop', type: 'loop', position: { x: 150, y: 80 }, data: { label: 'Loop over cells' } },
  ];
  const edges: any[] = [
    { id: 'e1', source: 'start', target: 'loop' },
  ];
  let y = 160;
  let prevId = 'loop';
  for (const c of eiapResult.conditions || []) {
    const id = `check_${nodes.length}`;
    const label = c.kpi ? `Check ${c.kpi} ${c.operator || '>'} ${c.threshold ?? ''}` : 'Check condition';
    nodes.push({ id, type: 'condition', position: { x: 150, y }, data: { label } });
    edges.push({ id: `e${edges.length + 1}`, source: prevId, target: id });
    prevId = id;
    y += 80;
  }
  for (const a of eiapResult.actions || []) {
    const id = `action_${nodes.length}`;
    const label = a.parameter ? `Set ${a.parameter} = ${a.value}` : 'Action';
    nodes.push({ id, type: 'action', position: { x: 150, y }, data: { label } });
    edges.push({ id: `e${edges.length + 1}`, source: prevId, target: id });
    prevId = id;
    y += 80;
  }
  edges.push({ id: 'e_back', source: prevId, target: 'loop' });
  return { nodes, edges };
}

/**
 * POST /api/automation/workflow-from-intent
 * Generate workflow JSON and EIAP code from natural language (intent → code + flowchart)
 */
router.post('/workflow-from-intent', async (req: Request, res: Response) => {
  try {
    const { naturalLanguageInput, userId } = req.body;

    if (!naturalLanguageInput) {
      return res.status(400).json({
        success: false,
        error: 'naturalLanguageInput is required'
      });
    }

    const eiapResult = await AppService.generateEIAPCode(naturalLanguageInput, userId);
    const workflow = buildWorkflowFromEIAP(eiapResult);

    res.json({
      success: true,
      data: {
        workflow,
        appId: eiapResult.appId,
        appName: eiapResult.appName,
        code: eiapResult.code,
      }
    });
  } catch (error: any) {
    logger.error('Workflow from intent failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create workflow from intent',
      message: error.message
    });
  }
});

/**
 * POST /api/automation/generate-workflow
 * Generate workflow JSON from Python code
 */
router.post('/generate-workflow', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'code is required'
      });
    }
    
    const workflow = await WorkflowGeneratorService.parseCodeToWorkflow(code);
    
    res.json({
      success: true,
      data: workflow
    });
    
  } catch (error: any) {
    logger.error('Workflow generation failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate workflow',
      message: error.message
    });
  }
});

/**
 * Extract natural language description from workflow nodes for EIAP generation
 */
function workflowToDescription(workflow: any): string {
  const labels: string[] = (workflow?.nodes || [])
    .map((n: any) => n?.data?.label)
    .filter(Boolean);
  if (labels.length === 0) return 'Optimize PRB utilization by adjusting qRxLevMin when threshold exceeded';
  return labels.join(', ').replace(/Check (.*?) (.*?) (\d+)/g, 'when $1 $2 $3');
}

/**
 * POST /api/automation/generate-code
 * Generate Python EIAP code from workflow JSON
 */
router.post('/generate-code', async (req: Request, res: Response) => {
  try {
    const { workflow } = req.body;
    
    if (!workflow) {
      return res.status(400).json({
        success: false,
        error: 'workflow is required'
      });
    }
    
    const description = workflowToDescription(workflow);
    const eiapResult = await AppService.generateEIAPCode(description);
    
    res.json({
      success: true,
      data: { code: eiapResult.code }
    });
    
  } catch (error: any) {
    logger.error('Code generation failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate code',
      message: error.message
    });
  }
});

/**
 * POST /api/automation/validate-workflow
 * Validate workflow structure
 */
router.post('/validate-workflow', async (req: Request, res: Response) => {
  try {
    const { workflow } = req.body;
    
    if (!workflow) {
      return res.status(400).json({
        success: false,
        error: 'workflow is required'
      });
    }
    
    const result = await WorkflowGeneratorService.validateWorkflow(workflow);
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error: any) {
    logger.error('Workflow validation failed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate workflow',
      message: error.message
    });
  }
});

/**
 * POST /api/automation/apps
 * Create a new app (save as applet)
 */
router.post('/apps', async (req: Request, res: Response) => {
  try {
    const { appName, description, naturalLanguageInput, generatedCode, workflowJson, moClasses, parametersUsed, kpisUsed, status } = req.body;
    const userId = (req as any).user?.userId;

    if (!appName || typeof appName !== 'string' || !appName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'App name is required'
      });
    }

    const allowedStatuses = new Set(['draft', 'validated', 'deployed', 'running', 'failed', 'archived']);
    const normalizedStatus = typeof status === 'string' && allowedStatuses.has(status) ? status : 'draft';

    const app = await GeneratedAppModel.create({
      appName: appName.trim(),
      description: description || null,
      naturalLanguageInput: naturalLanguageInput || null,
      generatedCode: generatedCode || null,
      workflowJson: workflowJson || null,
      moClasses: moClasses || null,
      parametersUsed: parametersUsed || null,
      kpisUsed: kpisUsed || null,
      status: normalizedStatus,
      deploymentTarget: 'NAAVIK_STORE',
      createdBy: userId || null,
      isPredefined: false
    });

    res.status(201).json({
      success: true,
      data: app
    });
  } catch (error: any) {
    logger.error('Failed to create app', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save applet',
      message: error.message
    });
  }
});

/**
 * GET /api/automation/apps
 * Get all generated apps
 */
router.get('/apps', async (req: Request, res: Response) => {
  try {
    const { status, search, limit, offset } = req.query;
    
    const result = await GeneratedAppModel.search({
      status: status as string,
      search: search as string,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0
    });
    
    res.json({
      success: true,
      data: result.apps,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0
      }
    });
    
  } catch (error: any) {
    logger.error('Failed to get apps', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve apps',
      message: error.message
    });
  }
});

/**
 * GET /api/automation/apps/:appId
 * Get specific app by ID
 */
router.get('/apps/:appId', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    const app = await GeneratedAppModel.getById(appId);
    
    if (!app) {
      return res.status(404).json({
        success: false,
        error: 'App not found'
      });
    }
    
    res.json({
      success: true,
      data: app
    });
    
  } catch (error: any) {
    logger.error('Failed to get app', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve app',
      message: error.message
    });
  }
});

/**
 * PATCH /api/automation/apps/:appId
 * Update app
 */
router.patch('/apps/:appId', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const updateData = req.body;
    
    const app = await GeneratedAppModel.update(appId, updateData);
    
    if (!app) {
      return res.status(404).json({
        success: false,
        error: 'App not found'
      });
    }
    
    res.json({
      success: true,
      data: app
    });
    
  } catch (error: any) {
    logger.error('Failed to update app', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update app',
      message: error.message
    });
  }
});

/**
 * DELETE /api/automation/apps/:appId
 * Delete app
 */
router.delete('/apps/:appId', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    const deleted = await GeneratedAppModel.delete(appId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'App not found'
      });
    }
    
    res.json({
      success: true,
      message: 'App deleted successfully'
    });
    
  } catch (error: any) {
    logger.error('Failed to delete app', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete app',
      message: error.message
    });
  }
});

/**
 * POST /api/automation/test-flow
 * Generate and execute test cases for a workflow
 */
router.post('/test-flow', async (req: Request, res: Response) => {
  try {
    const { workflowJson, code, siteId } = req.body;

    if (!workflowJson || !code) {
      return res.status(400).json({
        success: false,
        error: 'workflowJson and code are required'
      });
    }

    const result = await FlowTestService.generateAndRunTests(workflowJson, code, siteId);

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error('Flow test failed', error);
    res.status(500).json({
      success: false,
      error: 'Flow test failed',
      message: error.message
    });
  }
});

export default router;
