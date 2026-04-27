/**
 * Workflow Generator Service
 * Builds automation workflows with triggers and actions
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { WorkflowConfig, TriggerCondition, WorkflowAction } from '../types/index.js';

export interface WorkflowRequest {
  name: string;
  description: string;
  trigger: TriggerCondition;
  actions: WorkflowAction[];
}

export class WorkflowGeneratorService {
  /**
   * Generate workflow configuration
   */
  static async generateWorkflow(request: WorkflowRequest): Promise<WorkflowConfig> {
    const workflowId = uuidv4();
    
    logger.info(`Generating workflow: ${request.name}`);
    
    // Validate trigger and actions
    this.validateWorkflow(request);
    
    return {
      id: workflowId,
      name: request.name,
      trigger: request.trigger,
      actions: request.actions,
      active: true
    };
  }

  /**
   * Validate workflow configuration
   */
  static validateWorkflow(request: WorkflowRequest | any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Workflow name is required');
    }
    
    if (!request.trigger || !request.trigger.type) {
      errors.push('Workflow trigger is required');
    }
    
    if (!request.actions || request.actions.length === 0) {
      errors.push('At least one action is required');
    }
    
    // Validate trigger config
    switch (request.trigger?.type) {
      case 'kpi_threshold':
        if (!request.trigger?.config?.kpi || !request.trigger?.config?.threshold) {
          errors.push('KPI threshold trigger requires kpi and threshold');
        }
        break;
      case 'time_based':
        if (!request.trigger?.config?.schedule) {
          errors.push('Time-based trigger requires schedule');
        }
        break;
      case 'event_based':
        if (!request.trigger?.config?.eventType) {
          errors.push('Event-based trigger requires eventType');
        }
        break;
    }

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
    return { valid: true, errors: [] };
  }

  /**
   * Parse generated code into a lightweight workflow shape for UI flowchart rendering.
   */
  static async parseCodeToWorkflow(code: string): Promise<{ nodes: any[]; edges: any[] }> {
    const lines = code.split('\n').map((line) => line.trim()).filter(Boolean);
    const nodes: any[] = [{ id: 'start', type: 'start', data: { label: 'Start' }, position: { x: 100, y: 80 } }];
    const edges: any[] = [];
    let prev = 'start';
    let i = 1;
    let y = 200;

    for (const line of lines) {
      if (line.startsWith('#') || line.startsWith('"""') || line.startsWith("'''")) continue;
      let nodeType: 'condition' | 'action' | null = null;
      if (/^if\s+|^elif\s+|\bwhen\b|\bthreshold\b/i.test(line)) nodeType = 'condition';
      else if (/\bincrease\b|\bdecrease\b|\bset\b|\bupdate\b|\bexecute\b/i.test(line)) nodeType = 'action';
      if (!nodeType) continue;

      const id = `n${i++}`;
      nodes.push({
        id,
        type: nodeType,
        data: { label: line.slice(0, 80) },
        position: { x: 100, y },
      });
      edges.push({ id: `e-${prev}-${id}`, source: prev, target: id });
      prev = id;
      y += 120;
    }

    const endId = `n${i}`;
    nodes.push({ id: endId, type: 'end', data: { label: 'End' }, position: { x: 100, y } });
    edges.push({ id: `e-${prev}-${endId}`, source: prev, target: endId });
    return { nodes, edges };
  }

  /**
   * Create KPI threshold trigger
   */
  static createKpiThresholdTrigger(
    kpi: string,
    threshold: number,
    operator: '>' | '<' | '>=' | '<=' | '=' = '>'
  ): TriggerCondition {
    return {
      type: 'kpi_threshold',
      config: {
        kpi,
        threshold,
        operator,
        checkInterval: '5m' // Check every 5 minutes
      }
    };
  }

  /**
   * Create time-based trigger (cron)
   */
  static createTimeTrigger(schedule: string): TriggerCondition {
    return {
      type: 'time_based',
      config: {
        schedule, // Cron format: "0 */6 * * *" = every 6 hours
        timezone: 'UTC'
      }
    };
  }

  /**
   * Create event-based trigger
   */
  static createEventTrigger(eventType: string): TriggerCondition {
    return {
      type: 'event_based',
      config: {
        eventType, // e.g., 'site_outage', 'anomaly_detected'
        filters: {}
      }
    };
  }

  /**
   * Create alert action
   */
  static createAlertAction(
    channels: ('email' | 'slack' | 'webhook')[],
    message: string
  ): WorkflowAction {
    return {
      type: 'alert',
      config: {
        channels,
        message,
        severity: 'high'
      }
    };
  }

  /**
   * Create provision action
   */
  static createProvisionAction(siteConfig: any): WorkflowAction {
    return {
      type: 'provision',
      config: siteConfig
    };
  }

  /**
   * Create analysis action
   */
  static createAnalyzeAction(analysisType: string): WorkflowAction {
    return {
      type: 'analyze',
      config: {
        analysisType,
        saveResults: true
      }
    };
  }

  /**
   * Create script execution action
   */
  static createExecuteScriptAction(scriptPath: string, params: any = {}): WorkflowAction {
    return {
      type: 'execute_script',
      config: {
        scriptPath,
        params,
        timeout: 300000 // 5 minutes
      }
    };
  }

  /**
   * Generate workflow from natural language description
   */
  static async generateFromDescription(description: string): Promise<WorkflowConfig> {
    // Parse description to extract trigger and actions
    const lowerDesc = description.toLowerCase();
    
    let trigger: TriggerCondition;
    const actions: WorkflowAction[] = [];
    
    // Detect trigger type
    if (lowerDesc.includes('when') || lowerDesc.includes('if')) {
      if (lowerDesc.includes('drops below') || lowerDesc.includes('exceeds') || lowerDesc.includes('threshold')) {
        // KPI threshold trigger
        const kpiMatch = lowerDesc.match(/(\w+(?:_\w+)*)\s+(?:drops below|exceeds|>|<)\s+([\d.]+)/);
        if (kpiMatch) {
          const kpi = kpiMatch[1].toUpperCase();
          const threshold = parseFloat(kpiMatch[2]);
          const operator = lowerDesc.includes('below') || lowerDesc.includes('<') ? '<' : '>';
          trigger = this.createKpiThresholdTrigger(kpi, threshold, operator);
        } else {
          trigger = this.createKpiThresholdTrigger('DATA_DROP_RATE', 5.0);
        }
      } else if (lowerDesc.includes('every') || lowerDesc.includes('daily') || lowerDesc.includes('hourly')) {
        // Time-based trigger
        let schedule = '0 * * * *'; // Default: hourly
        if (lowerDesc.includes('daily')) schedule = '0 0 * * *';
        if (lowerDesc.includes('every 6 hours')) schedule = '0 */6 * * *';
        trigger = this.createTimeTrigger(schedule);
      } else {
        // Event-based trigger
        trigger = this.createEventTrigger('anomaly_detected');
      }
    } else {
      // Default trigger
      trigger = this.createTimeTrigger('0 */6 * * *');
    }
    
    // Detect actions
    if (lowerDesc.includes('alert') || lowerDesc.includes('notify')) {
      actions.push(this.createAlertAction(['email'], 'Alert from automated workflow'));
    }
    
    if (lowerDesc.includes('analyze') || lowerDesc.includes('investigation')) {
      actions.push(this.createAnalyzeAction('root_cause'));
    }
    
    if (lowerDesc.includes('provision') || lowerDesc.includes('deploy')) {
      actions.push(this.createProvisionAction({ technology: '5G' }));
    }
    
    // Default action if none detected
    if (actions.length === 0) {
      actions.push(this.createAlertAction(['email'], 'Workflow triggered'));
    }
    
    return this.generateWorkflow({
      name: 'Auto-generated Workflow',
      description,
      trigger,
      actions
    });
  }

  /**
   * Generate executable workflow code (Node.js)
   */
  static generateWorkflowCode(config: WorkflowConfig): string {
    return `/**
 * Automated Workflow: ${config.name}
 * Generated by Naavik Workflow Generator
 */

const schedule = require('node-schedule');
const { Client } = require('pg');

// Database configuration — pulled from environment so generated workflows
// never embed credentials in source.
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'naavik_demo',
  user: process.env.DB_USER || 'naavik_user',
  password: process.env.DB_PASSWORD
};

// Workflow configuration
const WORKFLOW_ID = '${config.id}';
const WORKFLOW_NAME = '${config.name}';

${this.generateTriggerCode(config.trigger)}

${this.generateActionsCode(config.actions)}

// Start workflow
console.log(\`Starting workflow: \${WORKFLOW_NAME}\`);
setupTrigger();
`;
  }

  /**
   * Generate trigger code
   */
  private static generateTriggerCode(trigger: TriggerCondition): string {
    switch (trigger.type) {
      case 'time_based':
        return `function setupTrigger() {
  // Schedule: ${trigger.config.schedule}
  schedule.scheduleJob('${trigger.config.schedule}', () => {
    logger.info(\`Workflow triggered at \${new Date().toISOString()}\`);
    executeActions();
  });
}`;

      case 'kpi_threshold':
        return `async function setupTrigger() {
  // Check KPI threshold every ${trigger.config.checkInterval || '5m'}
  const checkInterval = setInterval(async () => {
    try {
      const db = await getDatabase();
      const result = await db.query(
        'SELECT AVG("KPIValue") as avg FROM kpi_metrics WHERE "KPIName" = $1 AND "DateID" >= NOW() - INTERVAL \\'7 days\\'',
        ['${trigger.config.kpi}']
      );

      if (result.rows.length > 0) {
        const avgValue = parseFloat(result.rows[0].avg || 0);
        if (avgValue ${trigger.config.operator || '>'} ${trigger.config.threshold}) {
          logger.warn(\`KPI Threshold exceeded: ${trigger.config.kpi}=\${avgValue} ${trigger.config.operator || '>'} ${trigger.config.threshold}\`);
          await executeActions();
        }
      }
    } catch (err) {
      logger.error('Error checking KPI threshold', err);
    }
  }, ${this.intervalToMs(trigger.config.checkInterval || '5m')});

  return checkInterval;
}`;

      default:
        return `function setupTrigger() {
  logger.info('Event-based trigger configured: ${trigger.config.eventType}');
  const eventListener = new EventListener('${trigger.config.eventType}');
  eventListener.on('trigger', async () => {
    logger.info('Event triggered, executing actions');
    await executeActions();
  });
  return eventListener;
}`;
    }
  }

  /**
   * Generate actions code
   */
  private static generateActionsCode(actions: WorkflowAction[]): string {
    const actionCodes = actions.map((action, idx) => {
      switch (action.type) {
        case 'alert': {
          const severity = action.config.severity || 'high';
          const message = action.config.message || '';
          const recipients = action.config.recipients || 'ops-team@telecom.local';
          const channel = action.config.channel || 'email';
          return `  // Action ${idx + 1}: Send alert
  alert_service.send_alert(
    severity='${severity}',
    message='${message}',
    recipients='${recipients}',
    notification_channel='${channel}'
  )`;
        }

        case 'analyze': {
          const analysisType = action.config.analysisType || 'full';
          const scope = action.config.scope || 'network';
          const depth = action.config.depth || 'standard';
          const autoRemediate = String(action.config.autoRemediate || false).toLowerCase();
          return `  // Action ${idx + 1}: Run analysis
  analysis_result = analysis_service.trigger_analysis(
    analysis_type='${analysisType}',
    scope='${scope}',
    depth='${depth}',
    auto_remediate=${autoRemediate}
  )
  logger.info(f"Analysis triggered: {analysis_result['job_id']}")`;
        }

        case 'provision': {
          const siteName = action.config.siteName || '';
          const region = action.config.region || '';
          const cellCount = action.config.cellCount || 3;
          const technology = action.config.technology || '4G/5G';
          const bandwidth = action.config.bandwidth || 100;
          return `  // Action ${idx + 1}: Provision site
  provisioning_response = provisioning_service.create_site(
    site_name='${siteName}',
    region='${region}',
    cell_count=${cellCount},
    technology='${technology}',
    bandwidth_mbps=${bandwidth}
  )
  logger.info(f"Provisioning job created: {provisioning_response['job_id']}")`;
        }

        default: {
          const actionType = action.type;
          return `  // Action ${idx + 1}: ${actionType}
  logger.info('Executing action: ${actionType}')`;
        }
      }
    });

    return `async function executeActions() {
${actionCodes.join('\n')}
}`;
  }

  /**
   * Convert interval string to milliseconds
   */
  private static intervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)([smh])$/);
    if (!match) return 300000; // Default 5 minutes
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      default: return 300000;
    }
  }
}
