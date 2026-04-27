/**
 * Conversation Memory Service
 * Manages short-term memory, context derivation, and progressive app building for AppGen
 */

import { ConversationSessionModel } from '../models/conversation-session.model.js';
import { logger } from '../utils/logger.js';

export interface ConversationContext {
  threadId: string;
  phase: ConversationPhase;
  lastUpdateTime: number;
  messageCount: number;
  extractedEntities: ExtractedEntities;
  workflowDraft: WorkflowDraft;
  confidenceScore: number;
  summary: string;
}

export type ConversationPhase = 'intake' | 'clarification' | 'refinement' | 'ready_to_build' | 'completed';

export interface ExtractedEntities {
  kpis: KPIEntity[];
  parameters: ParameterEntity[];
  thresholds: ThresholdEntity[];
  actions: ActionEntity[];
  conditions: ConditionEntity[];
  scope: ScopeEntity | null;
  technology: string | null;
  problem: string | null;
}

export interface KPIEntity {
  name: string;
  operator?: 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ';
  threshold?: number;
  unit?: string;
  confidence: number;
}

export interface ParameterEntity {
  name: string;
  moClass?: string;
  suggestedValue?: string | number;
  confidence: number;
}

export interface ThresholdEntity {
  type: 'kpi' | 'parameter';
  name: string;
  value: number;
  operator: 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ';
  unit?: string;
  confidence: number;
}

export interface ActionEntity {
  type: 'parameter_change' | 'ticket_escalation' | 'notification' | 'workflow';
  target: string;
  value?: string | number;
  confidence: number;
}

export interface ConditionEntity {
  logic: 'AND' | 'OR';
  components: string[];
  confidence: number;
}

export interface ScopeEntity {
  type: 'site' | 'sector' | 'cell' | 'network';
  filter?: string;
  confidence: number;
}

export interface WorkflowDraft {
  version: number;
  condition: WorkflowCondition | null;
  actions: WorkflowAction[];
  completeness: number; // 0-100
  gaps: string[];
}

export interface WorkflowCondition {
  join: 'AND' | 'OR';
  kpis: { name: string; operator: string; threshold: number; unit?: string }[];
}

export interface WorkflowAction {
  type: string;
  target: string;
  value?: string | number;
  scope?: { type: string; filter?: string };
}

export class ConversationMemoryService {
  /**
   * Build conversation context from thread history
   */
  static async buildContext(threadId: string): Promise<ConversationContext> {
    const session = await ConversationSessionModel.getSession(threadId);
    if (!session) {
      throw new Error(`Session not found: ${threadId}`);
    }

    const messages = await ConversationSessionModel.getMessages(threadId, false);
    const slots = await ConversationSessionModel.getSlots(threadId);
    const decisions = await this.getDecisions(threadId);

    const extractedEntities = this.extractEntitiesFromMessages(messages);
    const workflowDraft = this.buildWorkflowDraft(slots, extractedEntities, decisions);
    const phase = this.determinePhase(messages.length, slots, extractedEntities, workflowDraft);
    const confidenceScore = this.calculateConfidence(extractedEntities, workflowDraft);
    const summary = this.generateSummary(extractedEntities, workflowDraft);

    return {
      threadId,
      phase,
      lastUpdateTime: Date.now(),
      messageCount: messages.length,
      extractedEntities,
      workflowDraft,
      confidenceScore,
      summary,
    };
  }

  /**
   * Extract entities (KPIs, parameters, thresholds, actions) from conversation
   */
  private static extractEntitiesFromMessages(messages: Array<{ role: string; content: string }>): ExtractedEntities {
    const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const fullText = userMessages.join(' ');

    return {
      kpis: this.extractKPIs(fullText),
      parameters: this.extractParameters(fullText),
      thresholds: this.extractThresholds(fullText),
      actions: this.extractActions(fullText),
      conditions: this.extractConditions(fullText),
      scope: this.extractScope(fullText),
      technology: this.extractTechnology(fullText),
      problem: this.extractProblem(fullText),
    };
  }

  /**
   * Extract KPI mentions from text
   */
  private static extractKPIs(text: string): KPIEntity[] {
    const kpiPatterns = [
      { name: 'PRB', pattern: /PRB|packet request buffer|request buffer/gi },
      { name: 'DATA_DROP_RATE', pattern: /data\s+drop\s+rate|drop\s+rate|DDR/gi },
      { name: 'THPT', pattern: /throughput|THPT|bandwidth/gi },
      { name: 'DATA_ACC_RATE', pattern: /data\s+accessibility|accessibility|acc\s+rate|DAR/gi },
      { name: 'NS_ESO_AVAIL', pattern: /NS\s+ESO|availability|avail/gi },
      { name: 'PDCP_MB', pattern: /PDCP|mobile backhaul/gi },
      { name: 'POOR_QUAL_RATE', pattern: /poor\s+quality|quality\s+rate|PQR/gi },
      { name: 'VCDR', pattern: /voice\s+call|call\s+drop|VCDR|voice\s+drop/gi },
      { name: 'VOLTE_ANS_TCALLS', pattern: /VoLTE|voice|answer|call|VOLTE/gi },
      { name: 'VRAN', pattern: /vRAN|virtual\s+RAN|VRAN/gi },
    ];

    const kpis: KPIEntity[] = [];
    const seen = new Set<string>();

    for (const { name, pattern } of kpiPatterns) {
      if (pattern.test(text) && !seen.has(name)) {
        seen.add(name);
        kpis.push({
          name,
          confidence: 0.9,
        });
      }
    }

    return kpis;
  }

  /**
   * Extract parameter mentions
   */
  private static extractParameters(text: string): ParameterEntity[] {
    const paramPatterns = [
      { name: 'qRxLevMin', pattern: /qRxLevMin|qrxlevmin/gi },
      { name: 'servCellConfig', pattern: /servCellConfig|serving\s+cell/gi },
      { name: 'RS_EPRE', pattern: /RS_EPRE|reference\s+signal/gi },
      { name: 'CSFB', pattern: /CSFB|circuit\s+switch/gi },
      { name: 'RAU', pattern: /RAU|random\s+access/gi },
    ];

    const params: ParameterEntity[] = [];
    const seen = new Set<string>();

    for (const { name, pattern } of paramPatterns) {
      if (pattern.test(text) && !seen.has(name)) {
        seen.add(name);
        params.push({
          name,
          confidence: 0.85,
        });
      }
    }

    return params;
  }

  /**
   * Extract threshold values
   */
  private static extractThresholds(text: string): ThresholdEntity[] {
    const thresholds: ThresholdEntity[] = [];

    // Pattern: "KPI > 80" or "when X exceeds Y"
    const thresholdPattern = /(\w+)\s*(?:>|<|>=|<=|=|exceeds|drops below|is greater than|is less than)\s*(\d+\.?\d*)/gi;
    let match;

    const regex = new RegExp(thresholdPattern);
    while ((match = regex.exec(text)) !== null) {
      const [, name, value] = match;
      thresholds.push({
        type: 'kpi',
        name: name.toUpperCase(),
        value: parseFloat(value),
        operator: this.inferOperator(match[0]),
        confidence: 0.75,
      });
    }

    return thresholds;
  }

  /**
   * Extract action intentions
   */
  private static extractActions(text: string): ActionEntity[] {
    const actionPatterns = [
      { type: 'parameter_change', pattern: /increase|decrease|set|change|adjust|modify|tune/gi },
      { type: 'ticket_escalation', pattern: /escalate|ticket|alert|notify|raise|create\s+ticket/gi },
      { type: 'notification', pattern: /notify|alert|send|message|inform/gi },
    ];

    const actions: ActionEntity[] = [];

    for (const { type, pattern } of actionPatterns) {
      if (pattern.test(text)) {
        actions.push({
          type: type as 'parameter_change' | 'ticket_escalation' | 'notification',
          target: '',
          confidence: 0.7,
        });
      }
    }

    return actions;
  }

  /**
   * Extract logical conditions
   */
  private static extractConditions(text: string): ConditionEntity[] {
    const conditions: ConditionEntity[] = [];

    if (/(and|both|plus)/gi.test(text)) {
      conditions.push({
        logic: 'AND',
        components: [],
        confidence: 0.8,
      });
    }

    if (/(or|either|any)/gi.test(text)) {
      conditions.push({
        logic: 'OR',
        components: [],
        confidence: 0.8,
      });
    }

    return conditions;
  }

  /**
   * Extract scope information
   */
  private static extractScope(text: string): ScopeEntity | null {
    const scopePatterns = [
      { type: 'site', pattern: /site|location|station/gi },
      { type: 'sector', pattern: /sector|cell|carrier|band/gi },
      { type: 'cell', pattern: /cell|carrier|RRH|RU/gi },
      { type: 'network', pattern: /network|region|area/gi },
    ];

    for (const { type, pattern } of scopePatterns) {
      if (pattern.test(text)) {
        return {
          type: type as 'site' | 'sector' | 'cell' | 'network',
          confidence: 0.75,
        };
      }
    }

    return null;
  }

  /**
   * Extract technology context
   */
  private static extractTechnology(text: string): string | null {
    const techs = ['5G', '4G', 'LTE', 'NR', 'NSA', 'SA'];
    for (const tech of techs) {
      if (new RegExp(tech, 'i').test(text)) {
        return tech;
      }
    }
    return null;
  }

  /**
   * Extract problem statement
   */
  private static extractProblem(text: string): string | null {
    // Look for problem keywords
    const problemKeywords = ['problem', 'issue', 'concern', 'need', 'want', 'improve', 'optimize', 'reduce', 'increase'];
    for (const keyword of problemKeywords) {
      const regex = new RegExp(`${keyword}[^.!?]*[.!?]`, 'i');
      const match = text.match(regex);
      if (match) {
        return match[0].substring(0, 150);
      }
    }

    return text.length > 0 ? text.substring(0, 150) : null;
  }

  /**
   * Build workflow draft from extracted entities
   */
  private static buildWorkflowDraft(slots: any[], entities: ExtractedEntities, decisions: any[]): WorkflowDraft {
    const gaps: string[] = [];
    const actions: WorkflowAction[] = [];

    // Build condition if KPIs present
    let condition: WorkflowCondition | null = null;
    if (entities.kpis.length > 0) {
      condition = {
        join: entities.conditions.length > 0 ? entities.conditions[0].logic : 'AND',
        kpis: entities.kpis.map((kpi) => ({
          name: kpi.name,
          operator: kpi.operator || 'GT',
          threshold: kpi.threshold || 80,
          unit: kpi.unit,
        })),
      };
    } else {
      gaps.push('KPI condition');
    }

    // Build actions if parameters or action entities present
    if (entities.parameters.length > 0) {
      actions.push({
        type: 'parameter_change',
        target: entities.parameters[0].name,
        value: entities.parameters[0].suggestedValue,
        scope: entities.scope || undefined,
      });
    } else if (entities.actions.some((a) => a.type === 'parameter_change')) {
      gaps.push('Target parameter');
    }

    if (entities.actions.some((a) => a.type === 'ticket_escalation')) {
      actions.push({
        type: 'ticket_escalation',
        target: 'INCIDENT',
      });
    }

    // Calculate completeness
    const totalSlots = 6; // estimate of required slots
    const filledSlots = (condition ? 1 : 0) + (actions.length > 0 ? 1 : 0) + (entities.scope ? 1 : 0);
    const completeness = Math.min(100, Math.round((filledSlots / totalSlots) * 100));

    return {
      version: 1,
      condition,
      actions,
      completeness,
      gaps,
    };
  }

  /**
   * Determine conversation phase
   */
  private static determinePhase(
    messageCount: number,
    slots: any[],
    entities: ExtractedEntities,
    workflow: WorkflowDraft
  ): ConversationPhase {
    if (workflow.gaps.length === 0) return 'ready_to_build';
    if (workflow.gaps.length <= 2 && messageCount >= 4) return 'refinement';
    if (entities.kpis.length > 0 || entities.parameters.length > 0) return 'clarification';
    return 'intake';
  }

  /**
   * Calculate confidence score (0-1)
   */
  private static calculateConfidence(entities: ExtractedEntities, workflow: WorkflowDraft): number {
    const entityScore = (entities.kpis.length > 0 ? 0.2 : 0) + (entities.parameters.length > 0 ? 0.2 : 0) + (entities.actions.length > 0 ? 0.2 : 0);
    const workflowScore = workflow.completeness / 100;
    return Math.round((entityScore * 0.4 + workflowScore * 0.6) * 100) / 100;
  }

  /**
   * Generate contextual summary
   */
  private static generateSummary(entities: ExtractedEntities, workflow: WorkflowDraft): string {
    const parts: string[] = [];

    if (entities.problem) {
      parts.push(`**Problem**: ${entities.problem}`);
    }

    if (entities.kpis.length > 0) {
      parts.push(`**KPIs**: ${entities.kpis.map((k) => k.name).join(', ')}`);
    }

    if (entities.parameters.length > 0) {
      parts.push(`**Parameters**: ${entities.parameters.map((p) => p.name).join(', ')}`);
    }

    if (workflow.gaps.length > 0) {
      parts.push(`**Needs**: ${workflow.gaps.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Infer comparison operator from text
   */
  private static inferOperator(text: string): 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ' {
    if (/>=/i.test(text)) return 'GTE';
    if (/>/i.test(text)) return 'GT';
    if (/<=/i.test(text)) return 'LTE';
    if (/<(?!=)/i.test(text)) return 'LT';
    return 'EQ';
  }

  /**
   * Get decisions from database (stub)
   */
  private static async getDecisions(threadId: string): Promise<any[]> {
    // This would fetch from the database
    return [];
  }

  /**
   * Save context to session summary
   */
  static async saveContext(context: ConversationContext): Promise<void> {
    await ConversationSessionModel.setConversationSummary(context.threadId, context.summary);
    await ConversationSessionModel.setConversationPhase(context.threadId, context.phase);
  }
}
