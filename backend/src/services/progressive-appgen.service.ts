/**
 * Progressive AppGen Service
 * Helps build apps incrementally as the conversation evolves
 */

import { ConversationMemoryService, ConversationContext, ExtractedEntities } from './conversation-memory.service.js';
import { ConversationSessionModel } from '../models/conversation-session.model.js';
import { logger } from '../utils/logger.js';

export interface ProgressiveAppState {
  progress: number; // 0-100
  currentPhase: string;
  completedSteps: string[];
  nextStep: string;
  suggestions: AppSuggestion[];
  previewWorkflow: any;
  readyToBuild: boolean;
}

export interface AppSuggestion {
  id: string;
  type: 'clarify' | 'suggest' | 'refine' | 'next_step';
  title: string;
  description: string;
  suggestedValue?: string | number;
  relatedEntities: string[];
  priority: 'high' | 'medium' | 'low';
}

export class ProgressiveAppGenService {
  /**
   * Get current app build state
   */
  static async getAppState(threadId: string): Promise<ProgressiveAppState> {
    const context = await ConversationMemoryService.buildContext(threadId);
    const suggestions = this.generateSuggestions(context);
    const previewWorkflow = this.buildPreviewWorkflow(context);

    return {
      progress: context.workflowDraft.completeness,
      currentPhase: context.phase,
      completedSteps: this.getCompletedSteps(context),
      nextStep: this.getNextStep(context),
      suggestions,
      previewWorkflow,
      readyToBuild: context.workflowDraft.gaps.length === 0,
    };
  }

  /**
   * Generate contextual suggestions based on conversation
   */
  private static generateSuggestions(context: ConversationContext): AppSuggestion[] {
    const suggestions: AppSuggestion[] = [];
    const { extractedEntities: entities, workflowDraft: workflow } = context;

    // Clarification suggestions
    if (entities.kpis.length === 0) {
      suggestions.push({
        id: 'clarify_kpi',
        type: 'clarify',
        title: 'Define the KPI to Monitor',
        description: 'Which KPI should trigger the action? (e.g., PRB > 80%, Data Drop Rate > 5%)',
        relatedEntities: ['kpi'],
        priority: 'high',
      });
    } else if (!entities.thresholds.some((t) => t.type === 'kpi')) {
      suggestions.push({
        id: 'clarify_threshold',
        type: 'clarify',
        title: 'Set the Threshold Value',
        description: `At what value should "${entities.kpis[0].name}" trigger the action?`,
        suggestedValue: 80,
        relatedEntities: ['kpi', 'threshold'],
        priority: 'high',
      });
    }

    if (entities.parameters.length === 0 && entities.actions.some((a) => a.type === 'parameter_change')) {
      suggestions.push({
        id: 'clarify_parameter',
        type: 'clarify',
        title: 'Select Target Parameter',
        description: 'Which parameter should be adjusted? (e.g., qRxLevMin, servCellConfig)',
        relatedEntities: ['parameter'],
        priority: 'high',
      });
    }

    // Suggestion improvements
    if (entities.kpis.length > 0 && entities.parameters.length === 0) {
      suggestions.push({
        id: 'suggest_action',
        type: 'suggest',
        title: 'Suggested Action',
        description: 'Based on the KPI, we suggest adjusting "qRxLevMin" to improve coverage.',
        suggestedValue: '-135',
        relatedEntities: ['parameter', 'kpi'],
        priority: 'medium',
      });
    }

    // Refinement suggestions
    if (entities.conditions.length === 0 && entities.kpis.length > 1) {
      suggestions.push({
        id: 'refine_logic',
        type: 'refine',
        title: 'Refine Logic',
        description: 'Do all KPI conditions need to be met (AND), or just one (OR)?',
        relatedEntities: ['condition'],
        priority: 'medium',
      });
    }

    if (!entities.scope) {
      suggestions.push({
        id: 'define_scope',
        type: 'refine',
        title: 'Define Scope',
        description: 'Should this apply to all sites, specific cells, or a filtered set?',
        relatedEntities: ['scope'],
        priority: 'medium',
      });
    }

    // Next steps when close to ready
    if (workflow.gaps.length <= 2) {
      suggestions.push({
        id: 'next_validation',
        type: 'next_step',
        title: 'Ready for Review',
        description: `You're almost there! Review the workflow and authorize build. Missing: ${workflow.gaps.join(', ')}`,
        relatedEntities: [],
        priority: 'high',
      });
    }

    return suggestions.sort((a, b) => {
      const priorityMap = { high: 0, medium: 1, low: 2 };
      return priorityMap[a.priority] - priorityMap[b.priority];
    });
  }

  /**
   * Get list of completed steps
   */
  private static getCompletedSteps(context: ConversationContext): string[] {
    const steps: string[] = [];

    if (context.extractedEntities.problem) {
      steps.push('Problem Identified');
    }

    if (context.extractedEntities.kpis.length > 0) {
      steps.push('KPI Selected');
    }

    if (context.extractedEntities.thresholds.length > 0) {
      steps.push('Threshold Defined');
    }

    if (context.extractedEntities.parameters.length > 0) {
      steps.push('Action Parameter Selected');
    }

    if (context.extractedEntities.scope) {
      steps.push('Scope Defined');
    }

    if (context.workflowDraft.actions.length > 0) {
      steps.push('Workflow Action Ready');
    }

    return steps;
  }

  /**
   * Get next recommended step
   */
  private static getNextStep(context: ConversationContext): string {
    const { extractedEntities: entities, workflowDraft: workflow, phase } = context;

    if (phase === 'ready_to_build') {
      return 'Review and authorize build';
    }

    if (workflow.gaps.includes('KPI condition')) {
      return 'Define the KPI condition that triggers the automation';
    }

    if (workflow.gaps.includes('Target parameter')) {
      return 'Select which parameter to adjust';
    }

    if (entities.parameters.length > 0 && !entities.thresholds.some((t) => t.type === 'kpi')) {
      return 'Set the threshold value for the KPI';
    }

    if (entities.scope === null) {
      return 'Optionally define the scope (sites, cells, etc.)';
    }

    return 'Refine and finalize the workflow';
  }

  /**
   * Build a preview of the workflow structure
   */
  private static buildPreviewWorkflow(context: ConversationContext): any {
    const { workflowDraft: draft } = context;

    return {
      version: draft.version,
      name: this.generateWorkflowName(context),
      description: this.generateWorkflowDescription(context),
      condition: draft.condition
        ? {
            type: 'kpi_threshold',
            logic: draft.condition.join,
            rules: draft.condition.kpis.map((kpi) => ({
              kpi: kpi.name,
              operator: kpi.operator,
              threshold: kpi.threshold,
              unit: kpi.unit,
            })),
          }
        : null,
      actions: draft.actions.map((action) => ({
        type: action.type,
        target: action.target,
        value: action.value,
        scope: action.scope,
      })),
      status: context.workflowDraft.gaps.length === 0 ? 'ready_to_build' : 'in_progress',
      completeness: draft.completeness,
      gaps: draft.gaps,
    };
  }

  /**
   * Generate workflow name from context
   */
  private static generateWorkflowName(context: ConversationContext): string {
    const { extractedEntities: entities } = context;

    if (entities.kpis.length > 0 && entities.parameters.length > 0) {
      return `${entities.kpis[0].name} → ${entities.parameters[0].name}`;
    } else if (entities.kpis.length > 0) {
      return `Respond to ${entities.kpis[0].name}`;
    }

    return 'Network Automation Workflow';
  }

  /**
   * Generate workflow description
   */
  private static generateWorkflowDescription(context: ConversationContext): string {
    const { extractedEntities: entities } = context;
    const parts: string[] = [];

    if (entities.problem) {
      parts.push(`Addresses: ${entities.problem}`);
    }

    if (entities.kpis.length > 0 && entities.parameters.length > 0) {
      parts.push(`When ${entities.kpis[0].name} exceeds threshold, adjust ${entities.parameters[0].name}`);
    }

    return parts.join('. ') || 'Automated network response workflow';
  }

  /**
   * Generate suggestions for refining specific slot
   */
  static async refineSuggestions(threadId: string, slotType: string): Promise<AppSuggestion[]> {
    const context = await ConversationMemoryService.buildContext(threadId);
    const allSuggestions = this.generateSuggestions(context);
    return allSuggestions.filter((s) => s.relatedEntities.includes(slotType));
  }

  /**
   * Get contextual help text
   */
  static getHelpText(slotType: string): string {
    const helpTexts: Record<string, string> = {
      kpi: 'Select a Key Performance Indicator to monitor (e.g., PRB, Data Drop Rate, Throughput). This KPI value will be checked to trigger the automation.',
      threshold: 'Set the threshold value. When the KPI crosses this value, the action will be triggered.',
      parameter: 'Choose the network parameter to adjust. This will be modified when the condition is met.',
      operator: 'Select the comparison operator (>, <, >=, <=, =) to define when the threshold is crossed.',
      action: 'Define what should happen when the condition is met (e.g., adjust parameter value, escalate ticket).',
      scope: 'Optionally define the scope: which sites, cells, or sectors should this apply to?',
      condition_logic: 'If you have multiple KPI conditions, choose AND (all must be true) or OR (any can be true).',
    };

    return helpTexts[slotType] || 'Provide more information about this field.';
  }

  /**
   * Provide context-aware validation
   */
  static async validateProgressiveState(threadId: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const state = await this.getAppState(threadId);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (state.previewWorkflow.condition === null) {
      errors.push('KPI condition is required');
    }

    if (state.previewWorkflow.actions.length === 0) {
      errors.push('At least one action is required');
    }

    if (state.progress < 50) {
      warnings.push('Workflow is still in early stages. Continue refining to improve confidence.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
