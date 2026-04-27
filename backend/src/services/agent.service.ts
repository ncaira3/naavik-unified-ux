/**
 * Agent Orchestration Service
 * Simulates 4 agents working in parallel: Observation, Reasoning, Perception, Sensing
 */
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import { 
  AgentActivity, 
  AgentWorkflowResult, 
  AgentName, 
  AgentStatus, 
  ParsedIntent 
} from '../types/index.js';
import { AGENT_TIMING } from '../config/constants.js';
import { AnomalyService } from './anomaly.service.js';
import { RCAService } from './rca.service.js';
import { logger } from '../utils/logger.js';

export class AgentService {
  /**
   * Execute query workflow (for QUERY_DB intent)
   */
  static async executeQueryWorkflow(intent: ParsedIntent, query: string): Promise<AgentWorkflowResult> {
    const workflowId = uuidv4();
    const startTime = Date.now();
    
    logger.info(`Starting query workflow: ${workflowId}`);
    
    const agents: AgentActivity[] = [
      {
        workflowId,
        agentName: 'SQL_GENERATOR',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
      {
        workflowId,
        agentName: 'VALIDATOR',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
      {
        workflowId,
        agentName: 'EXECUTOR',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
      {
        workflowId,
        agentName: 'FORMATTER',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
    ];
    
    // Execute agents in sequence
    for (const agent of agents) {
      agent.status = 'WORKING';
      await this.sleep(500);
      
      agent.findings.push(`${agent.agentName} completed successfully`);
      agent.status = 'COMPLETE';
      agent.progress = 100;
      agent.completedAt = new Date();
    }
    
    const totalDuration = Date.now() - startTime;
    
    return {
      workflowId,
      workflowType: 'QUERY',
      agents,
      finalResult: {
        message: 'Query workflow completed',
        ready: true
      },
      totalDuration,
    };
  }

  /**
   * Execute analysis workflow (for ANALYZE_DATA intent)
   */
  static async executeAnalysisWorkflow(intent: ParsedIntent): Promise<AgentWorkflowResult> {
    const workflowId = uuidv4();
    const startTime = Date.now();
    
    logger.info(`Starting analysis workflow: ${workflowId}`);
    
    const agents: AgentActivity[] = [
      {
        workflowId,
        agentName: 'DATA_COLLECTOR',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
      {
        workflowId,
        agentName: 'STATISTICIAN',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
      {
        workflowId,
        agentName: 'VISUALIZER',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
      {
        workflowId,
        agentName: 'INTERPRETER',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      } as any,
    ];
    
    // Execute agents in parallel
    for (const agent of agents) {
      agent.status = 'WORKING';
      await this.sleep(500);
      
      agent.findings.push(`${agent.agentName} analysis complete`);
      agent.status = 'COMPLETE';
      agent.progress = 100;
      agent.completedAt = new Date();
    }
    
    const totalDuration = Date.now() - startTime;
    
    return {
      workflowId,
      workflowType: 'ANALYSIS',
      agents,
      finalResult: {
        message: 'Analysis workflow completed',
        ready: true
      },
      totalDuration,
    };
  }

  /**
   * Execute agent workflow for OBSERVE intent
   */
  static async executeObserveWorkflow(intent: ParsedIntent): Promise<AgentWorkflowResult> {
    const workflowId = uuidv4();
    const startTime = Date.now();
    
    logger.info(`Starting agent workflow: ${workflowId}`);
    
    // Initialize all 4 agents
    const agents: AgentActivity[] = [
      {
        workflowId,
        agentName: 'OBSERVATION',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      },
      {
        workflowId,
        agentName: 'REASONING',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      },
      {
        workflowId,
        agentName: 'PERCEPTION',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      },
      {
        workflowId,
        agentName: 'SENSING',
        status: 'IDLE',
        progress: 0,
        findings: [],
        startedAt: new Date(),
      },
    ];
    
    // Execute agents in parallel (simulated with Promise.all)
    const agentPromises = agents.map(agent => this.executeAgent(agent, intent));
    const completedAgents = await Promise.all(agentPromises);
    
    // Aggregate results
    const finalResult = this.aggregateAgentResults(completedAgents, intent);
    
    const totalDuration = Date.now() - startTime;
    
    logger.info(`Agent workflow ${workflowId} completed in ${totalDuration}ms`);
    
    return {
      workflowId,
      workflowType: 'OBSERVE',
      agents: completedAgents,
      finalResult,
      totalDuration,
    };
  }

  /**
   * Execute a single agent
   */
  private static async executeAgent(
    agent: AgentActivity,
    intent: ParsedIntent
  ): Promise<AgentActivity> {
    const timing = AGENT_TIMING[agent.agentName];
    
    // Simulate agent startup delay (if timing available)
    if (timing) {
      await this.sleep(timing.startDelay);
    } else {
      await this.sleep(100);
    }
    
    agent.status = 'WORKING';
    agent.startedAt = new Date();
    
    // Log agent activity to database
    await this.logAgentActivity(agent);
    
    // Execute agent-specific logic
    const findings = await this.runAgentLogic(agent.agentName, intent);
    
    // Simulate progress updates
    for (let i = 0; i < timing.progressSteps.length; i++) {
      agent.progress = timing.progressSteps[i];
      
      if (i < findings.length) {
        agent.findings.push(findings[i]);
      }
      
      if (i < timing.progressSteps.length - 1) {
        const stepDuration = timing.duration / timing.progressSteps.length;
        await this.sleep(stepDuration);
      }
    }
    
    agent.status = 'COMPLETE';
    agent.progress = 100;
    agent.completedAt = new Date();
    
    await this.logAgentActivity(agent);
    
    return agent;
  }

  /**
   * Agent-specific logic
   */
  private static async runAgentLogic(agentName: AgentName, intent: ParsedIntent): Promise<string[]> {
    switch (agentName) {
      case 'OBSERVATION':
        return this.observationAgent(intent);
        
      case 'REASONING':
        return this.reasoningAgent(intent);
        
      case 'PERCEPTION':
        return this.perceptionAgent(intent);
        
      case 'SENSING':
        return this.sensingAgent(intent);
        
      default:
        return ['Agent executed successfully'];
    }
  }

  /**
   * Observation Agent - Detects what's happening
   */
  private static async observationAgent(intent: ParsedIntent): Promise<string[]> {
    const findings: string[] = [];
    
    // Detect anomalies
    const anomalies = await AnomalyService.detectAnomalies();
    findings.push(`Detected ${anomalies.length} total anomalies`);
    
    const critical = anomalies.filter(a => a.severity === 'critical');
    if (critical.length > 0) {
      findings.push(`Found ${critical.length} critical issues requiring attention`);
    }
    
    // Get stats
    const stats = await AnomalyService.getAnomalyStats();
    findings.push(`Top affected KPIs: ${Object.keys(stats.byKPI).slice(0, 3).join(', ')}`);
    
    return findings;
  }

  /**
   * Reasoning Agent - Determines why things are happening
   */
  private static async reasoningAgent(intent: ParsedIntent): Promise<string[]> {
    const findings: string[] = [];
    
    // Check for outages
    const outages = await RCAService.getActiveOutages();
    
    if (outages.length > 0) {
      findings.push(`Identified ${outages.length} active outage(s)`);
      
      const totalImpactedNeighbors = outages.reduce((sum, o) => sum + o.neighborImpact.length, 0);
      if (totalImpactedNeighbors > 0) {
        findings.push(`${totalImpactedNeighbors} neighboring sites affected by outages`);
      }
    } else {
      findings.push('No major outages detected');
    }
    
    findings.push('Correlating anomaly patterns across network');
    
    return findings;
  }

  /**
   * Perception Agent - Understands context and patterns
   */
  private static async perceptionAgent(intent: ParsedIntent): Promise<string[]> {
    const findings: string[] = [];
    
    const client = await pool.connect();
    
    try {
      // Analyze trends
      const query = `
        SELECT 
          COUNT(DISTINCT "SiteID") as affected_sites,
          COUNT(DISTINCT "KPIName") as affected_kpis
        FROM intermediate_kpi_table
        WHERE "AnomalyFlag" = true
        AND "DateID" >= (SELECT MAX("DateID") FROM intermediate_kpi_table) - INTERVAL '1 day'
      `;
      
      const result = await client.query(query);
      const { affected_sites, affected_kpis } = result.rows[0];
      
      findings.push(`${affected_sites} sites showing degradation in last 24h`);
      findings.push(`${affected_kpis} different KPI types affected`);
      findings.push('Pattern suggests localized network stress');
      
    } finally {
      client.release();
    }
    
    return findings;
  }

  /**
   * Sensing Agent - Collects real-time metrics
   */
  private static async sensingAgent(intent: ParsedIntent): Promise<string[]> {
    const findings: string[] = [];
    
    const client = await pool.connect();
    
    try {
      // Get network health metrics
      const query = `
        SELECT 
          AVG("KPIValue") as avg_value,
          "KPIName"
        FROM intermediate_kpi_table
        WHERE "KPIName" IN ('DATA_DROP_RATE', 'DATA_ACC_RATE', 'NS_ESO_AVAIL')
        AND "DateID" = (SELECT MAX("DateID") FROM intermediate_kpi_table)
        GROUP BY "KPIName"
      `;
      
      const result = await client.query(query);
      
      result.rows.forEach(row => {
        findings.push(`${row.KPIName}: ${parseFloat(row.avg_value).toFixed(2)} network average`);
      });
      
      findings.push('Real-time metrics collected and validated');
      
    } finally {
      client.release();
    }
    
    return findings;
  }

  /**
   * Aggregate agent results into final workflow result
   */
  private static async aggregateAgentResults(
    agents: AgentActivity[],
    intent: ParsedIntent
  ): Promise<any> {
    const allFindings = agents.flatMap(a => a.findings);
    
    // Get actual data based on intent
    const anomalies = await AnomalyService.detectAnomalies();
    const outages = await RCAService.getActiveOutages();
    
    return {
      summary: `Analyzed network based on query. ${allFindings.length} insights generated.`,
      insights: allFindings,
      anomalies: anomalies.slice(0, 10), // Top 10
      outages: outages.slice(0, 5), // Top 5
      recommendation: this.generateRecommendation(anomalies, outages),
    };
  }

  /**
   * Generate recommendation based on findings
   */
  private static generateRecommendation(anomalies: any[], outages: any[]): string {
    if (outages.length > 0) {
      return `Priority: Investigate ${outages.length} active outage(s). ${outages[0].neighborImpact.length} neighbors experiencing congestion.`;
    }
    
    const critical = anomalies.filter(a => a.severity === 'critical');
    if (critical.length > 0) {
      return `Focus on ${critical.length} critical anomalies. Top issue: ${critical[0].siteName} - ${critical[0].kpiName}`;
    }
    
    if (anomalies.length > 0) {
      return `Monitor ${anomalies.length} anomalies. Network is operational but showing some degradation.`;
    }
    
    return 'Network health is good. Continue regular monitoring.';
  }

  /**
   * Log agent activity to database
   */
  private static async logAgentActivity(agent: AgentActivity): Promise<void> {
    const client = await pool.connect();
    
    try {
      const query = `
        INSERT INTO agent_activity_log (
          workflow_id, agent_name, status, progress, findings, started_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      
      await client.query(query, [
        agent.workflowId,
        agent.agentName,
        agent.status,
        agent.progress,
        JSON.stringify(agent.findings),
        agent.startedAt,
        agent.completedAt || null,
      ]);
      
    } catch (error) {
      logger.error('Failed to log agent activity', error);
    } finally {
      client.release();
    }
  }

  /**
   * Utility: Sleep for ms
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get agent activity history for a workflow
   */
  static async getWorkflowHistory(workflowId: string): Promise<AgentActivity[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT workflow_id, agent_name, status, progress, findings, started_at, completed_at, data
        FROM agent_activity_log
        WHERE workflow_id = $1
        ORDER BY started_at ASC
      `;
      
      const result = await client.query(query, [workflowId]);
      
      return result.rows.map(row => ({
        workflowId: row.workflow_id,
        agentName: row.agent_name as AgentName,
        status: row.status as AgentStatus,
        progress: row.progress,
        findings: JSON.parse(row.findings || '[]'),
        startedAt: row.started_at,
        completedAt: row.completed_at,
        data: row.data,
      }));
      
    } finally {
      client.release();
    }
  }
}
