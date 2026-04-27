import { ParameterKPIMapperService } from './parameter-kpi-mapper.service.js';
import { AppGenCatalogService } from './appgen-catalog.service.js';
import { AppSettingsService } from './app-settings.service.js';
import { ConversationSessionModel } from '../models/conversation-session.model.js';
import { RappPackagerService } from './rapp-packager.service.js';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { openai } from '../config/openai.js';
import type {
  BuilderArtifact,
  BuilderChannel,
  BuilderChatResponse,
  BuilderSlot,
  BuilderState,
  ClarificationPayload,
  ClarificationQuestion,
  DisambiguationOption,
  DisambiguationPayload,
  SlotStatus,
} from '../types/conversational-builder.js';

type SlotKey =
  | 'app_kind'
  | 'runtime_target'
  | 'oem'
  | 'intent_category'
  | 'problem_description'
  | 'technology'
  | 'kpi'
  | 'operator'
  | 'threshold_value'
  | 'threshold_unit'
  | 'parameter_name'
  | 'mo_class'
  | 'action_type'
  | 'action_value'
  | 'scope'
  | 'granularity'
  | 'target_platform';

const DEFAULT_SLOT_DEFS: Array<{ key: SlotKey; label: string; required: boolean; defaultValue?: string | number }> = [
  { key: 'app_kind', label: 'App Kind', required: false },
  { key: 'runtime_target', label: 'Runtime Target', required: false },
  { key: 'oem', label: 'OEM Support', required: false },
  { key: 'intent_category', label: 'Intent Category', required: false },
  { key: 'problem_description', label: 'Problem Description', required: false },
  { key: 'technology', label: 'Technology', required: false },
  { key: 'kpi', label: 'KPI', required: true },
  { key: 'operator', label: 'Operator', required: true },
  { key: 'threshold_value', label: 'Threshold', required: true },
  { key: 'threshold_unit', label: 'Threshold Unit', required: false, defaultValue: '%' },
  { key: 'parameter_name', label: 'Parameter', required: true },
  { key: 'mo_class', label: 'Managed Object', required: true },
  { key: 'action_type', label: 'Action Type', required: false, defaultValue: 'set' },
  { key: 'action_value', label: 'Action Value', required: true },
  { key: 'scope', label: 'Scope', required: false },
  { key: 'granularity', label: 'Granularity', required: false },
  { key: 'target_platform', label: 'Target Platform', required: false },
];

const BUSINESS_INTAKE_SLOTS: SlotKey[] = ['app_kind', 'runtime_target', 'oem', 'intent_category', 'problem_description'];

interface SlotValueRecord {
  status: SlotStatus;
  value: string | number | null;
  canonicalValue?: string;
  unit?: string;
  valueJson?: Record<string, unknown>;
}

interface ChatInput {
  threadId?: string;
  message: string;
  channel: BuilderChannel;
  userId?: string;
}

const OPENAI_BUILDER_MODEL = process.env.OPENAI_BUILDER_MODEL || process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini';

interface LogicKPICondition {
  name: string;
  operator: '>' | '>=' | '<' | '<=';
  threshold: number;
  unit?: string;
}

interface LogicAction {
  parameter: string;
  mo_class?: string;
  action_type: 'increase' | 'decrease' | 'set';
  value: number;
}

interface StructuredLogic {
  intent?: string;
  technology?: string;
  scope?: string;
  granularity?: string;
  target_platform?: string;
  condition_join?: 'AND' | 'OR';
  kpis: LogicKPICondition[];
  actions: LogicAction[];
}

export class ConversationalBuilderService {
  static async listSessionsByUser(userId: string, limit: number = 20): Promise<Array<{ threadId: string; channel: BuilderChannel; status: string; conversationPhase?: string; updatedAt: string }>> {
    const sessions = await ConversationSessionModel.listByUser(userId, limit);
    return sessions.map((s) => ({
      threadId: s.threadId,
      channel: s.channel,
      status: s.status,
      conversationPhase: s.conversationPhase,
      updatedAt: s.updatedAt,
    }));
  }

  static async chat(input: ChatInput): Promise<BuilderChatResponse> {
    const session = await ConversationSessionModel.getOrCreateSession(input.threadId, input.channel, input.userId);
    const threadId = session.threadId;
    const message = input.message.trim();

    await ConversationSessionModel.appendMessage(threadId, 'user', message);

    if (!message) {
      throw new Error('Message is required');
    }

    const slots = await this.loadSlotState(threadId);
    const pendingDisambiguation = this.getPendingDisambiguation(slots);

    if (pendingDisambiguation) {
      const disambiguationResult = await this.resolveDisambiguationChoice(message, pendingDisambiguation, slots, threadId);
      if (disambiguationResult !== null) {
        await ConversationSessionModel.appendMessage(threadId, 'assistant', disambiguationResult);
      } else {
        // User provided refinement text instead of picking an existing option.
        // Continue normal extraction flow on the same turn.
        await this.extractAndApplySlots(message, slots, threadId);
        const historyAfterUser = await ConversationSessionModel.getMessages(threadId);
        await this.applyStructuredLogicFromHistory(threadId, slots, historyAfterUser);
      }
    } else {
      await this.extractAndApplySlots(message, slots, threadId);
      const historyAfterUser = await ConversationSessionModel.getMessages(threadId);
      await this.applyStructuredLogicFromHistory(threadId, slots, historyAfterUser);
    }

    const refreshedSlots = await this.loadSlotState(threadId);
    const disambiguation = this.buildDisambiguation(refreshedSlots);
    const pendingSlots = this.computePendingSlots(refreshedSlots);
    const canGenerate = pendingSlots.length === 0 && !disambiguation;
    await ConversationSessionModel.setCanGenerate(threadId, canGenerate);

    const history = await ConversationSessionModel.getMessages(threadId);

    // Trigger conversation summarization if needed (non-blocking)
    if (history.length > 30) {
      this.summarizeConversation(threadId, history).catch((err) => {
        logger.warn('Failed to summarize conversation', { threadId, error: err });
      });
    }

    const assistantMessage = await this.buildAssistantMessage(
      refreshedSlots,
      pendingSlots,
      disambiguation,
      canGenerate,
      history
    );
    await ConversationSessionModel.appendMessage(threadId, 'assistant', assistantMessage);

    const state = await this.buildState(threadId, input.channel, refreshedSlots, disambiguation, canGenerate);

    // Generate structured clarification payload for pending slots
    let clarification: ClarificationPayload | null = null;
    if (!canGenerate && !disambiguation && pendingSlots.length > 0) {
      const clarificationResult = await this.generateStructuredClarification(refreshedSlots, pendingSlots);
      if (clarificationResult) {
        clarification = clarificationResult;
      }
    }

    return {
      threadId,
      assistantMessage,
      state,
      pendingSlots,
      canGenerate,
      disambiguation,
      artifacts: state.artifacts,
      clarification,
    };
  }

  static async getState(threadId: string): Promise<BuilderState | null> {
    const session = await ConversationSessionModel.getSession(threadId);
    if (!session) return null;
    const slots = await this.loadSlotState(threadId);
    const disambiguation = this.buildDisambiguation(slots);
    const pendingSlots = this.computePendingSlots(slots);
    return this.buildState(threadId, session.channel, slots, disambiguation, session.canGenerate);
  }

  static async generate(threadId: string): Promise<{ workflowJson: Record<string, unknown>; eiapCode: string; state: BuilderState }> {
    const session = await ConversationSessionModel.getSession(threadId);
    if (!session) throw new Error('Thread not found');

    const slots = await this.loadSlotState(threadId);
    const disambiguation = this.buildDisambiguation(slots);
    const pendingSlots = this.computePendingSlots(slots);
    if (pendingSlots.length > 0 || disambiguation) {
      throw new Error('Missing required slots or unresolved disambiguation');
    }

    const history = await ConversationSessionModel.getMessages(threadId);
    const logic = await this.extractStructuredLogicFromHistory(history, slots);
    const workflowJson = this.buildWorkflowJson(threadId, slots, logic || undefined);

    // Try LLM-driven generation first, fall back to deterministic if LLM fails
    let eiap = await this.generateCodeWithLLM(threadId, slots, logic || undefined);
    if (!eiap) {
      eiap = this.buildDeterministicEiapCode(threadId, slots, logic || undefined);
    }
    const eiapCode = eiap.code;

    const workflowArtifact: BuilderArtifact = {
      type: 'workflow_json',
      status: 'validated',
      metadata: { workflowJson },
    };
    const codeArtifact: BuilderArtifact = {
      type: 'eiap_code',
      status: 'validated',
      metadata: { codeLength: eiapCode.length, appName: eiap.appName },
    };
    await ConversationSessionModel.upsertArtifact(threadId, workflowArtifact);
    await ConversationSessionModel.upsertArtifact(threadId, codeArtifact);
    await ConversationSessionModel.addDecision(threadId, 'generate', {
      workflowNodes: (workflowJson.nodes as Array<unknown>).length,
      codeLength: eiapCode.length,
    });
    await ConversationSessionModel.setStatus(threadId, 'completed');

    const updatedState = await this.getState(threadId);
    if (!updatedState) throw new Error('State unavailable after generation');
    updatedState.workflowJson = workflowJson;
    updatedState.eiapCode = eiapCode;
    return { workflowJson, eiapCode, state: updatedState };
  }

  static async packageRapp(threadId: string): Promise<{ packageId: string; packagePath: string; archivePath: string; validation: any }> {
    const state = await this.getState(threadId);
    if (!state) throw new Error('Thread not found');

    const slots = await this.loadSlotState(threadId);
    const history = await ConversationSessionModel.getMessages(threadId);
    const logic = await this.extractStructuredLogicFromHistory(history, slots);
    const workflowJson = this.buildWorkflowJson(threadId, slots, logic || undefined);

    // Try LLM-driven generation first, fall back to deterministic if LLM fails
    let eiap = await this.generateCodeWithLLM(threadId, slots, logic || undefined);
    if (!eiap) {
      eiap = this.buildDeterministicEiapCode(threadId, slots, logic || undefined);
    }

    const packageResult = await RappPackagerService.createPackage({
      threadId,
      appName: eiap.appName,
      eiapCode: eiap.code,
      workflowJson,
      targetPlatform: String(this.getSlotValue(slots, 'target_platform') || 'ERICSSON_EIAP'),
    });

    await ConversationSessionModel.upsertArtifact(threadId, {
      type: 'rapp_package',
      status: packageResult.validation.valid ? 'validated' : 'failed',
      filePath: packageResult.archivePath,
      metadata: {
        packageId: packageResult.packageId,
        packagePath: packageResult.packagePath,
        checks: packageResult.validation.checks,
        errors: packageResult.validation.errors,
      },
    });
    await ConversationSessionModel.addDecision(threadId, 'package_rapp', {
      packageId: packageResult.packageId,
      valid: packageResult.validation.valid,
    });

    return packageResult;
  }

  static async reset(threadId: string): Promise<void> {
    await ConversationSessionModel.resetThread(threadId);
  }

  private static async extractAndApplySlots(
    message: string,
    slots: Map<SlotKey, SlotValueRecord>,
    threadId: string
  ): Promise<void> {
    const lower = message.toLowerCase();
    const editLogicToken = lower.match(/^__edit_logic__:(kpi|parameter_mo|action|scope)$/);
    const editLogicNatural =
      /\b(edit|refine|modify|update)\b.*\bkpi\b/.test(lower)
        ? 'kpi'
        : /\b(edit|refine|modify|update)\b.*\b(parameter|mo|managed object)\b/.test(lower)
          ? 'parameter_mo'
          : /\b(edit|refine|modify|update)\b.*\baction\b/.test(lower)
            ? 'action'
            : /\b(edit|refine|modify|update)\b.*\b(scope|granularity)\b/.test(lower)
              ? 'scope'
              : null;
    const editTarget = editLogicToken?.[1] || editLogicNatural;
    if (editTarget) {
      const target = editTarget;
      if (target === 'kpi') {
        await this.setSlot(threadId, 'kpi', 'missing', null, null);
        await this.setSlot(threadId, 'operator', 'missing', null, null);
        await this.setSlot(threadId, 'threshold_value', 'missing', null, null);
        await this.setSlot(threadId, 'threshold_unit', 'missing', null, null);
        slots.set('kpi', { status: 'missing', value: null });
        slots.set('operator', { status: 'missing', value: null });
        slots.set('threshold_value', { status: 'missing', value: null });
        slots.set('threshold_unit', { status: 'missing', value: null });
      } else if (target === 'parameter_mo') {
        await this.setSlot(threadId, 'parameter_name', 'missing', null, null);
        await this.setSlot(threadId, 'mo_class', 'missing', null, null);
        slots.set('parameter_name', { status: 'missing', value: null });
        slots.set('mo_class', { status: 'missing', value: null });
      } else if (target === 'action') {
        await this.setSlot(threadId, 'action_type', 'missing', null, null);
        await this.setSlot(threadId, 'action_value', 'missing', null, null);
        slots.set('action_type', { status: 'missing', value: null });
        slots.set('action_value', { status: 'missing', value: null });
      } else if (target === 'scope') {
        await this.setSlot(threadId, 'scope', 'missing', null, null);
        await this.setSlot(threadId, 'granularity', 'missing', null, null);
        slots.set('scope', { status: 'missing', value: null });
        slots.set('granularity', { status: 'missing', value: null });
      }
      return;
    }
    let pendingSlots = this.computePendingSlots(slots);

    const policy = await AppSettingsService.getAppGenPolicy();
    if (policy.ericssonOnly) {
      if (!slots.get('app_kind')?.value) {
        await this.setSlot(threadId, 'app_kind', 'confirmed', 'rApp', 'rApp');
        slots.set('app_kind', { status: 'confirmed', value: 'rApp', canonicalValue: 'rApp' });
      }
      if (!slots.get('oem')?.value) {
        await this.setSlot(threadId, 'oem', 'confirmed', 'Ericsson', 'Ericsson');
        slots.set('oem', { status: 'confirmed', value: 'Ericsson', canonicalValue: 'Ericsson' });
      }
      if (!slots.get('runtime_target')?.value) {
        await this.setSlot(threadId, 'runtime_target', 'confirmed', 'EIAP', 'EIAP');
        slots.set('runtime_target', { status: 'confirmed', value: 'EIAP', canonicalValue: 'EIAP' });
      }
      if (!slots.get('target_platform')?.value) {
        await this.setSlot(threadId, 'target_platform', 'confirmed', 'ERICSSON_EIAP', 'ERICSSON_EIAP');
        slots.set('target_platform', { status: 'confirmed', value: 'ERICSSON_EIAP', canonicalValue: 'ERICSSON_EIAP' });
      }
      pendingSlots = this.computePendingSlots(slots);
    }
    const preferredPending = this.getPreferredPendingSlot(pendingSlots) as SlotKey | undefined;

    if (pendingSlots.includes('app_kind')) {
      if (/rapp|r-app/.test(lower)) {
        await this.setSlot(threadId, 'app_kind', 'confirmed', 'rApp', 'rApp');
        slots.set('app_kind', { status: 'confirmed', value: 'rApp', canonicalValue: 'rApp' });
      } else if (/workflow|flow/.test(lower)) {
        await this.setSlot(threadId, 'app_kind', 'confirmed', 'workflow', 'workflow');
        slots.set('app_kind', { status: 'confirmed', value: 'workflow', canonicalValue: 'workflow' });
      } else if (/applet/.test(lower)) {
        await this.setSlot(threadId, 'app_kind', 'confirmed', 'applet', 'applet');
        slots.set('app_kind', { status: 'confirmed', value: 'applet', canonicalValue: 'applet' });
      }
    }

    if (pendingSlots.includes('runtime_target') && !policy.ericssonOnly) {
      if (/eiap|enm|ericsson/.test(lower)) {
        await this.setSlot(threadId, 'runtime_target', 'confirmed', 'EIAP', 'EIAP');
        slots.set('runtime_target', { status: 'confirmed', value: 'EIAP', canonicalValue: 'EIAP' });
      } else if (/smo/.test(lower)) {
        await this.setSlot(threadId, 'runtime_target', 'confirmed', 'SMO', 'SMO');
        slots.set('runtime_target', { status: 'confirmed', value: 'SMO', canonicalValue: 'SMO' });
      }
    }

    if (pendingSlots.includes('oem') && !policy.ericssonOnly) {
      if (/ericsson/.test(lower)) {
        await this.setSlot(threadId, 'oem', 'confirmed', 'Ericsson', 'Ericsson');
        slots.set('oem', { status: 'confirmed', value: 'Ericsson', canonicalValue: 'Ericsson' });
      } else if (/nokia/.test(lower)) {
        await this.setSlot(threadId, 'oem', 'confirmed', 'Nokia', 'Nokia');
        slots.set('oem', { status: 'confirmed', value: 'Nokia', canonicalValue: 'Nokia' });
      } else if (/samsung/.test(lower)) {
        await this.setSlot(threadId, 'oem', 'confirmed', 'Samsung', 'Samsung');
        slots.set('oem', { status: 'confirmed', value: 'Samsung', canonicalValue: 'Samsung' });
      } else if (/multi|both|all/.test(lower)) {
        await this.setSlot(threadId, 'oem', 'confirmed', 'Multi-OEM', 'Multi-OEM');
        slots.set('oem', { status: 'confirmed', value: 'Multi-OEM', canonicalValue: 'Multi-OEM' });
      }
    }

    if (pendingSlots.includes('intent_category')) {
      if (/capacity|congestion|prb|throughput|tput|traffic/.test(lower)) {
        await this.setSlot(threadId, 'intent_category', 'confirmed', 'Capacity Optimization', 'Capacity Optimization');
        slots.set('intent_category', { status: 'confirmed', value: 'Capacity Optimization', canonicalValue: 'Capacity Optimization' });
      } else if (/mobility|handover/.test(lower)) {
        await this.setSlot(threadId, 'intent_category', 'confirmed', 'Mobility Optimization', 'Mobility Optimization');
        slots.set('intent_category', { status: 'confirmed', value: 'Mobility Optimization', canonicalValue: 'Mobility Optimization' });
      } else if (/rf|coverage|shape/.test(lower)) {
        await this.setSlot(threadId, 'intent_category', 'confirmed', 'RF Shaping', 'RF Shaping');
        slots.set('intent_category', { status: 'confirmed', value: 'RF Shaping', canonicalValue: 'RF Shaping' });
      } else if (/anomaly/.test(lower)) {
        await this.setSlot(threadId, 'intent_category', 'confirmed', 'Anomaly Detection', 'Anomaly Detection');
        slots.set('intent_category', { status: 'confirmed', value: 'Anomaly Detection', canonicalValue: 'Anomaly Detection' });
      } else if (/root cause|rca/.test(lower)) {
        await this.setSlot(threadId, 'intent_category', 'confirmed', 'Root Cause Analysis', 'Root Cause Analysis');
        slots.set('intent_category', { status: 'confirmed', value: 'Root Cause Analysis', canonicalValue: 'Root Cause Analysis' });
      }
    }

    if (pendingSlots.includes('problem_description') && lower.length > 8 && !/^(\d+|>|>=|<|<=)$/.test(lower.trim())) {
      await this.setSlot(threadId, 'problem_description', 'confirmed', message.trim(), message.trim());
      slots.set('problem_description', { status: 'confirmed', value: message.trim(), canonicalValue: message.trim() });
    }

    // Slot-aware direct answer handling to avoid repeated loops on short replies like "90".
    if (pendingSlots.includes('threshold_value')) {
      const numeric = lower.match(/^(\d+(?:\.\d+)?)\s*%?$/);
      if (numeric) {
        const thresholdValue = Number(numeric[1]);
        if (!Number.isNaN(thresholdValue)) {
          await this.setSlot(threadId, 'threshold_value', 'confirmed', String(thresholdValue), String(thresholdValue));
          slots.set('threshold_value', { status: 'confirmed', value: thresholdValue, canonicalValue: String(thresholdValue) });
          await this.setSlot(threadId, 'threshold_unit', 'confirmed', '%', '%', '%');
          slots.set('threshold_unit', { status: 'confirmed', value: '%', canonicalValue: '%', unit: '%' });
        }
      }
    }

    if (pendingSlots.includes('action_value')) {
      const numeric = lower.match(/^(\d+(?:\.\d+)?)$/);
      if (numeric) {
        const actionValue = Number(numeric[1]);
        if (!Number.isNaN(actionValue)) {
          await this.setSlot(threadId, 'action_value', 'confirmed', String(actionValue), String(actionValue));
          slots.set('action_value', { status: 'confirmed', value: actionValue, canonicalValue: String(actionValue) });
        }
      }
    }

    if (pendingSlots.includes('operator')) {
      const opRaw = lower.trim();
      const explicitOperator =
        opRaw === '>' || opRaw === '>=' || opRaw === '<' || opRaw === '<='
          ? opRaw
          : null;
      if (explicitOperator) {
        const normalized = this.normalizeOperator(explicitOperator);
        await this.setSlot(threadId, 'operator', 'confirmed', normalized, normalized);
        slots.set('operator', { status: 'confirmed', value: normalized, canonicalValue: normalized });
      }
    }

    // Managed Object class (explicit MO input should not be treated as parameter input).
    const normalizedMoClass = this.extractMoClassHint(message, lower);
    if (normalizedMoClass) {
      await this.setSlot(threadId, 'mo_class', 'confirmed', normalizedMoClass, normalizedMoClass);
      slots.set('mo_class', { status: 'confirmed', value: normalizedMoClass, canonicalValue: normalizedMoClass });
    }

    // Technology
    if (/\b4g\b|eutran|eutrancell/.test(lower)) {
      await this.setSlot(threadId, 'technology', 'confirmed', '4G', '4G');
      slots.set('technology', { status: 'confirmed', value: '4G', canonicalValue: '4G' });
    }

    // KPI resolution (dynamic + typo tolerant). Attempt only when KPI step is active or user explicitly provided KPI-like input.
    const kpiHint = this.extractKpiHint(lower);
    const shouldResolveKpi = Boolean(kpiHint) || preferredPending === 'kpi';
    if (shouldResolveKpi) {
      const kpiInput = kpiHint || message;
      const resolvedKpi = await ParameterKPIMapperService.resolveKPI(kpiInput);
      const kpiCandidates = resolvedKpi.matches
        .map((m) => m.kpi?.db_counter_name || m.kpi?.metric)
        .filter((v): v is string => Boolean(v))
        .slice(0, 10);

      const explicitlyProvidedKpi = kpiCandidates.find((name) =>
        this.userExplicitlyProvidedValue(message, lower, name)
      );

      if (explicitlyProvidedKpi) {
        await this.setSlot(threadId, 'kpi', 'confirmed', explicitlyProvidedKpi, explicitlyProvidedKpi);
        slots.set('kpi', { status: 'confirmed', value: explicitlyProvidedKpi, canonicalValue: explicitlyProvidedKpi });
      } else if (kpiCandidates.length > 0) {
        const options: DisambiguationOption[] = kpiCandidates.map((name, idx) => ({
          id: `kpi-opt-${idx + 1}`,
          type: 'kpi',
          displayLabel: name,
          canonicalName: name,
          confidence: resolvedKpi.matches[idx]?.confidence,
        }));
        await this.setSlot(threadId, 'kpi', 'ambiguous', null, null, undefined, { options });
        slots.set('kpi', { status: 'ambiguous', value: null, valueJson: { options } });
      } else if (preferredPending === 'kpi') {
        const options = await this.getDynamicKpiOptions(slots, message);
        if (options.length > 0) {
          await this.setSlot(threadId, 'kpi', 'ambiguous', null, null, undefined, { options });
          slots.set('kpi', { status: 'ambiguous', value: null, valueJson: { options } });
        }
      }

      if (/prb|util|rate|percent|%/.test(lower)) {
        await this.setSlot(threadId, 'threshold_unit', 'confirmed', '%', '%', '%');
        slots.set('threshold_unit', { status: 'confirmed', value: '%', canonicalValue: '%', unit: '%' });
      }
    }

    // Comparator/operator
    const operatorMatch = lower.match(/(>=|<=|>|<|at least|or higher|above|below|greater than|less than)/);
    if (operatorMatch) {
      const operator = this.normalizeOperator(operatorMatch[1]);
      await this.setSlot(threadId, 'operator', 'confirmed', operator, operator);
      slots.set('operator', { status: 'confirmed', value: operator, canonicalValue: operator });
    }

    // Threshold numeric value - prioritize numbers that come AFTER a comparison operator
    // First try to find operator + number pattern (>=90, >90, etc.)
    let thresholdMatch = lower.match(/(>=|<=|>|<)\s*(\d+(?:\.\d+)?)\s*%?/);
    if (!thresholdMatch) {
      // Fallback: try text-based operators (at least 90, greater than 90, etc.)
      thresholdMatch = lower.match(/(?:at least|or higher|above|below|greater than|less than)\s+(\d+(?:\.\d+)?)/);
      if (thresholdMatch) {
        thresholdMatch = [thresholdMatch[0], thresholdMatch[1], thresholdMatch[1]]; // Normalize to [full, op, num]
      }
    }
    if (thresholdMatch && /prb|util|threshold|>=|<=|>|</.test(lower)) {
      const thresholdValue = Number(thresholdMatch[2]);
      if (!Number.isNaN(thresholdValue)) {
        await this.setSlot(threadId, 'threshold_value', 'confirmed', String(thresholdValue), String(thresholdValue));
        slots.set('threshold_value', { status: 'confirmed', value: thresholdValue, canonicalValue: String(thresholdValue) });
      }
    }

    if (pendingSlots.includes('threshold_unit') || !slots.get('threshold_unit')?.value) {
      if (/mbps|mb\/s|m bps|throughput|tput/.test(lower)) {
        await this.setSlot(threadId, 'threshold_unit', 'confirmed', 'Mbps', 'Mbps', 'Mbps');
        slots.set('threshold_unit', { status: 'confirmed', value: 'Mbps', canonicalValue: 'Mbps', unit: 'Mbps' });
      } else if (/%|percent|percentage/.test(lower)) {
        await this.setSlot(threadId, 'threshold_unit', 'confirmed', '%', '%', '%');
        slots.set('threshold_unit', { status: 'confirmed', value: '%', canonicalValue: '%', unit: '%' });
      }
    }

    // Parameter resolution (dynamic + typo tolerant) with explicit selection when ambiguous.
    // Only resolve when parameter step is active or user explicitly provided a parameter-like token.
    const parameterHint = this.extractParameterHint(lower);
    const likelyParameterInput = this.isLikelyParameterInput(message, lower);
    const shouldResolveParameter =
      Boolean(parameterHint) || (preferredPending === 'parameter_name' && likelyParameterInput);
    if (shouldResolveParameter && !normalizedMoClass) {
      const parameterInput = parameterHint || message;
      const resolved = await ParameterKPIMapperService.resolveParameter(parameterInput);
      const selectedMo = String(this.getSlotValue(slots, 'mo_class') || '').toLowerCase();
      const moFilteredMatches = selectedMo
        ? resolved.matches.filter((m) => String(m.parameter?.mo_class || '').toLowerCase() === selectedMo)
        : resolved.matches;
      const effectiveMatches = moFilteredMatches.length > 0 ? moFilteredMatches : resolved.matches;
      const parameterCandidates = effectiveMatches
        .map((m) => m.parameter?.parameter_name)
        .filter((v): v is string => Boolean(v))
        .slice(0, 10);

      const explicitlyProvidedParam = parameterCandidates.find((name) =>
        this.userExplicitlyProvidedValue(message, lower, name)
      );

      if (explicitlyProvidedParam) {
        const canonicalParamName = explicitlyProvidedParam;
        await this.setSlot(threadId, 'parameter_name', 'confirmed', canonicalParamName, canonicalParamName);
        slots.set('parameter_name', { status: 'confirmed', value: canonicalParamName, canonicalValue: canonicalParamName });

        const moCandidates = await this.getMOCandidatesForParameter(canonicalParamName);
        if (moCandidates.length === 1) {
          await this.setSlot(threadId, 'mo_class', 'confirmed', moCandidates[0].moClass, moCandidates[0].moClass);
          slots.set('mo_class', { status: 'confirmed', value: moCandidates[0].moClass, canonicalValue: moCandidates[0].moClass });
        } else if (moCandidates.length > 1) {
          const options: DisambiguationOption[] = moCandidates.map((c, idx) => ({
            id: `mo-opt-${idx + 1}`,
            type: 'mo_parameter',
            displayLabel: `${c.moClass}.${canonicalParamName}`,
            canonicalName: canonicalParamName,
            moClass: c.moClass,
            confidence: c.confidence,
            metadata: { parameterName: canonicalParamName },
          }));
          await this.setSlot(threadId, 'mo_class', 'ambiguous', null, null, undefined, { options });
          slots.set('mo_class', { status: 'ambiguous', value: null, valueJson: { options } });
        }
      } else if (parameterCandidates.length > 0) {
        const options: DisambiguationOption[] = parameterCandidates.map((name, idx) => ({
          id: `param-opt-${idx + 1}`,
          type: 'parameter',
          displayLabel: name,
          canonicalName: name,
          confidence: effectiveMatches[idx]?.confidence,
        }));
        await this.setSlot(threadId, 'parameter_name', 'ambiguous', null, null, undefined, { options });
        slots.set('parameter_name', { status: 'ambiguous', value: null, valueJson: { options } });
      } else if (preferredPending === 'parameter_name' && parameterHint) {
        const options = await this.getDynamicParameterOptions(slots, message);
        if (options.length > 0) {
          await this.setSlot(threadId, 'parameter_name', 'ambiguous', null, null, undefined, { options });
          slots.set('parameter_name', { status: 'ambiguous', value: null, valueJson: { options } });
        }
      }
    }

    // Action type
    const actionType = this.extractActionType(lower);
    if (actionType) {
      await this.setSlot(threadId, 'action_type', 'confirmed', actionType, actionType);
      slots.set('action_type', { status: 'confirmed', value: actionType, canonicalValue: actionType });
    }

    // Action value
    const actionValue = this.extractActionValue(lower);
    if (actionValue !== null) {
      await this.setSlot(threadId, 'action_value', 'confirmed', String(actionValue), String(actionValue));
      slots.set('action_value', { status: 'confirmed', value: actionValue, canonicalValue: String(actionValue) });
    }

    // Scope
    if (/any|all|cells|cell/.test(lower)) {
      const scope = /all/.test(lower) ? 'all 4G cells meeting threshold' : 'any 4G cell meeting threshold';
      await this.setSlot(threadId, 'scope', 'confirmed', scope, scope);
      slots.set('scope', { status: 'confirmed', value: scope, canonicalValue: scope });
    }

    // Granularity
    if (/hourly/.test(lower)) {
      await this.setSlot(threadId, 'granularity', 'confirmed', 'hourly', 'hourly');
      slots.set('granularity', { status: 'confirmed', value: 'hourly', canonicalValue: 'hourly' });
    } else if (/daily/.test(lower)) {
      await this.setSlot(threadId, 'granularity', 'confirmed', 'daily', 'daily');
      slots.set('granularity', { status: 'confirmed', value: 'daily', canonicalValue: 'daily' });
    }

    // Target platform
    if (/ericsson|enm|eiap/.test(lower)) {
      await this.setSlot(threadId, 'target_platform', 'confirmed', 'ERICSSON_EIAP', 'ERICSSON_EIAP');
      slots.set('target_platform', { status: 'confirmed', value: 'ERICSSON_EIAP', canonicalValue: 'ERICSSON_EIAP' });
    } else if (pendingSlots.includes('target_platform')) {
      const runtimeTarget = String(this.getSlotValue(slots, 'runtime_target') || '');
      if (runtimeTarget.toUpperCase() === 'EIAP') {
        await this.setSlot(threadId, 'target_platform', 'confirmed', 'ERICSSON_EIAP', 'ERICSSON_EIAP');
        slots.set('target_platform', { status: 'confirmed', value: 'ERICSSON_EIAP', canonicalValue: 'ERICSSON_EIAP' });
      }
    }

    // No auto-defaulting here; force intent-first, user-confirmed slot collection.
  }

  private static async resolveDisambiguationChoice(
    message: string,
    disambiguation: DisambiguationPayload,
    slots: Map<SlotKey, SlotValueRecord>,
    threadId: string
  ): Promise<string | null> {
    const normalized = message.trim().toLowerCase();
    const options = disambiguation.options;
    let selected: DisambiguationOption | undefined;

    const byIndex = normalized.match(/^(\d+)$/);
    if (byIndex) {
      const idx = Number(byIndex[1]) - 1;
      selected = options[idx];
    } else {
      selected = options.find((option) => option.displayLabel.toLowerCase() === normalized);
      if (!selected) {
        selected = options.find((option) => normalized.includes(option.displayLabel.toLowerCase()));
      }
    }

    if (!selected) {
      if (disambiguation.slotKey === 'parameter_name') {
        const refined = message.trim();
        const looksLikeRefinement = refined.length >= 2 && !/^\d+$/.test(refined);
        if (looksLikeRefinement) {
          await this.setSlot(threadId, 'parameter_name', 'missing', null, null);
          slots.set('parameter_name', { status: 'missing', value: null });
          return null;
        }
      }
      return `I still need a specific selection. Choose one option by number or exact label:\n${options
        .map((opt, i) => `${i + 1}. ${opt.displayLabel}`)
        .join('\n')}`;
    }

    if (disambiguation.slotKey === 'kpi') {
      await this.setSlot(threadId, 'kpi', 'confirmed', selected.canonicalName, selected.canonicalName);
      slots.set('kpi', { status: 'confirmed', value: selected.canonicalName, canonicalValue: selected.canonicalName });
    } else if (disambiguation.slotKey === 'parameter_name') {
      await this.setSlot(threadId, 'parameter_name', 'confirmed', selected.canonicalName, selected.canonicalName);
      slots.set('parameter_name', { status: 'confirmed', value: selected.canonicalName, canonicalValue: selected.canonicalName });
      const moCandidates = await this.getMOCandidatesForParameter(selected.canonicalName);
      if (moCandidates.length === 1) {
        await this.setSlot(threadId, 'mo_class', 'confirmed', moCandidates[0].moClass, moCandidates[0].moClass);
        slots.set('mo_class', { status: 'confirmed', value: moCandidates[0].moClass, canonicalValue: moCandidates[0].moClass });
      } else if (moCandidates.length > 1) {
        const options: DisambiguationOption[] = moCandidates.map((c, idx) => ({
          id: `mo-opt-${idx + 1}`,
          type: 'mo_parameter',
          displayLabel: `${c.moClass}.${selected.canonicalName}`,
          canonicalName: selected.canonicalName,
          moClass: c.moClass,
          confidence: c.confidence,
          metadata: { parameterName: selected.canonicalName },
        }));
        await this.setSlot(threadId, 'mo_class', 'ambiguous', null, null, undefined, { options });
        slots.set('mo_class', { status: 'ambiguous', value: null, valueJson: { options } });
      }
    } else {
      await this.setSlot(threadId, 'mo_class', 'confirmed', selected.moClass || '', selected.moClass || '');
      slots.set('mo_class', { status: 'confirmed', value: selected.moClass || '', canonicalValue: selected.moClass || '' });
    }
    await ConversationSessionModel.addDecision(threadId, 'mo_parameter_selection', {
      selected: selected.displayLabel,
      slotKey: disambiguation.slotKey,
    });
    return `Confirmed. I will use **${selected.displayLabel}** for generation.`;
  }

  private static async loadSlotState(threadId: string): Promise<Map<SlotKey, SlotValueRecord>> {
    const slotRows = await ConversationSessionModel.getSlots(threadId);
    const slotMap = new Map<SlotKey, SlotValueRecord>();
    for (const row of slotRows) {
      slotMap.set(row.slotKey as SlotKey, {
        status: row.slotStatus,
        value: row.valueText ? this.parsePossiblyNumeric(row.valueText) : null,
        canonicalValue: row.valueText || undefined,
        unit: row.slotKey === 'threshold_unit' ? '%' : undefined,
        valueJson: row.valueJson || undefined,
      });
    }
    return slotMap;
  }

  private static computePendingSlots(slots: Map<SlotKey, SlotValueRecord>): string[] {
    return DEFAULT_SLOT_DEFS
      .filter((slot) => slot.required)
      .filter((slot) => {
        const current = slots.get(slot.key);
        if (!current) return true;
        if (current.status === 'ambiguous' || current.status === 'missing') return true;
        return current.value === null || current.value === '';
      })
      .map((slot) => slot.key);
  }

  private static buildDisambiguation(slots: Map<SlotKey, SlotValueRecord>): DisambiguationPayload | null {
    const parameterSlot = slots.get('parameter_name');
    if (parameterSlot && parameterSlot.status === 'ambiguous') {
      const options = ((parameterSlot.valueJson?.options as DisambiguationOption[]) || []).map((o) => ({
        ...o,
        type: 'parameter' as const,
      }));
      if (options.length > 0) {
        return {
          type: 'parameter',
          slotKey: 'parameter_name',
          prompt: 'I found multiple parameter matches. Select one option (or type a more specific parameter name to refine):',
          options,
        };
      }
    }

    const kpiSlot = slots.get('kpi');
    if (kpiSlot && kpiSlot.status === 'ambiguous') {
      const options = ((kpiSlot.valueJson?.options as DisambiguationOption[]) || []).map((o) => ({
        ...o,
        type: 'kpi' as const,
      }));
      if (options.length > 0) {
        return {
          type: 'kpi',
          slotKey: 'kpi',
          prompt: 'Select the KPI to use:',
          options,
        };
      }
    }

    const moSlot = slots.get('mo_class');
    if (!moSlot || moSlot.status !== 'ambiguous') return null;
    const options = ((moSlot.valueJson?.options as DisambiguationOption[]) || []).map((o) => ({
      ...o,
      type: 'mo_parameter' as const,
    }));
    if (options.length === 0) return null;
    return {
      type: 'mo_parameter',
      slotKey: 'mo_class',
      prompt: 'Select the exact ManagedObject + parameter combination:',
      options,
    };
  }

  private static async buildAssistantMessage(
    slots: Map<SlotKey, SlotValueRecord>,
    pendingSlots: string[],
    disambiguation: DisambiguationPayload | null,
    canGenerate: boolean,
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>
  ): Promise<string> {
    if (disambiguation) {
      return `${disambiguation.prompt}\n${disambiguation.options.map((o, i) => `${i + 1}. ${o.displayLabel}`).join('\n')}`;
    }

    const latestUser = [...history].reverse().find((m) => m.role === 'user')?.content.toLowerCase() || '';
    const addKpiIntent = /(add|also|another).*(kpi|condition)/.test(latestUser);

    if (addKpiIntent) {
      return 'Add the next KPI condition in one line: <KPI name> <operator> <threshold>. Example: RRC_FAILURE_RATE >= 3. Say AND/OR to combine conditions.';
    }

    const intentMissing =
      !this.getSlotValue(slots, 'intent_category') && !this.getSlotValue(slots, 'problem_description');
    const coreResolved = this.countResolvedCoreSlots(slots);
    if (intentMissing && coreResolved === 0) {
      const discovery = await this.generateIntentDiscoveryFollowup(slots, history);
      if (discovery) return discovery;
    }

    if (canGenerate) {
      if (/(refine|edit|modify|change inputs?|update logic|what parameters?|what kpis?)/.test(latestUser)) {
        return 'What would you like to update before generation? You can change parameter, MO, action type/value, KPI condition(s), operator, threshold, scope, or runtime target.';
      }
      const threshold = this.getSlotValue(slots, 'threshold_value');
      const operator = this.getSlotValue(slots, 'operator');
      const parameter = this.getSlotValue(slots, 'parameter_name');
      const mo = this.getSlotValue(slots, 'mo_class');
      const kpi = this.getSlotValue(slots, 'kpi');
      const unit = String(this.getSlotValue(slots, 'threshold_unit') || '');
      const actionType = this.getSlotValue(slots, 'action_type');
      const actionValue = this.getSlotValue(slots, 'action_value');
      return `All required inputs are captured. I am ready to generate the app.\nCondition: ${String(kpi)} ${String(operator)} ${String(threshold)}${unit}\nAction: ${String(actionType)} ${String(mo)}.${String(parameter)} ${String(actionValue)}\nYou can add another KPI condition, refine inputs, or click Authorize Build.`;
    }

    const contextual = await this.generateContextualFollowup(slots, pendingSlots, history);
    if (contextual) return contextual;

    const next = this.getPreferredPendingSlot(pendingSlots);
    switch (next) {
      default:
        if (latestUser && /(hi|hello|help|what can i do|start)/.test(latestUser)) {
          return 'Describe the app objective in one sentence, then I will guide you through parameter, MO, action value, and trigger conditions.';
        }
        return `Please provide the next required detail: ${next || pendingSlots.join(', ')}.`;
    }
  }

  private static async generateStructuredClarification(
    slots: Map<SlotKey, SlotValueRecord>,
    pendingSlots: string[]
  ): Promise<{ questions: ClarificationQuestion[] } | null> {
    if (pendingSlots.length === 0) return null;

    try {
      const questions: ClarificationQuestion[] = [];

      // Helper to get resolved KPI names
      const resolvedKpis = ['Throughput', 'Latency', 'Jitter', 'Packet Loss', 'Availability'];

      // Helper to get resolved parameter names
      const resolvedParameters = ['PDCP_MB', 'THPT', 'NS_ESO_AVAIL', 'VCDR_ACC_RATE', 'VRAN_ACC_RATE'];

      // Helper to get MO classes
      const moClasses = ['MeContext', 'ManagedElement', 'Sector', 'EUtranCellFDD'];

      const priorityOrder = ['parameter_name', 'mo_class', 'action_type', 'action_value', 'kpi', 'operator', 'threshold_value'];
      const orderedPending = pendingSlots.sort((a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b));

      for (const slotKey of orderedPending) {
        let question: ClarificationQuestion | null = null;

        if (slotKey === 'kpi') {
          question = {
            id: 'kpi',
            text: 'Which KPI would you like to monitor?',
            selectionMode: 'single_choice',
            options: resolvedKpis.map((kpi) => ({ key: kpi.toLowerCase(), value: kpi })),
          };
        } else if (slotKey === 'operator') {
          question = {
            id: 'operator',
            text: 'What comparison operator? (e.g., greater than, less than)',
            selectionMode: 'single_choice',
            options: [
              { key: '>', value: 'Greater than (>)' },
              { key: '<', value: 'Less than (<)' },
              { key: '>=', value: 'Greater or equal (>=)' },
              { key: '<=', value: 'Less or equal (<=)' },
              { key: '==', value: 'Equal (==)' },
            ],
          };
        } else if (slotKey === 'threshold_value') {
          question = {
            id: 'threshold_value',
            text: 'What is the threshold value?',
            selectionMode: 'free_text',
            allowFreeText: true,
            placeholder: 'e.g., 80',
          };
        } else if (slotKey === 'parameter_name') {
          question = {
            id: 'parameter_name',
            text: 'Which parameter should trigger this condition?',
            selectionMode: 'single_choice',
            options: resolvedParameters.map((param) => ({ key: param, value: param })),
          };
        } else if (slotKey === 'mo_class') {
          question = {
            id: 'mo_class',
            text: 'Which MO class applies to this automation?',
            selectionMode: 'single_choice',
            options: moClasses.map((mo) => ({ key: mo, value: mo })),
          };
        } else if (slotKey === 'action_type') {
          question = {
            id: 'action_type',
            text: 'What action should be triggered?',
            selectionMode: 'single_choice',
            options: [
              { key: 'LOG', value: 'Log event' },
              { key: 'ALERT', value: 'Send alert' },
              { key: 'EXECUTE', value: 'Execute command' },
            ],
          };
        } else if (slotKey === 'action_value') {
          question = {
            id: 'action_value',
            text: 'Provide the action details/target value.',
            selectionMode: 'free_text',
            allowFreeText: true,
            placeholder: 'e.g., admin@example.com, SystemA',
          };
        }

        if (question) {
          questions.push(question);
        }
      }

      return questions.length > 0 ? { questions } : null;
    } catch (error) {
      logger.warn('Structured clarification generation failed', error);
      return null;
    }
  }

  private static async generateContextualFollowup(
    slots: Map<SlotKey, SlotValueRecord>,
    pendingSlots: string[],
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>
  ): Promise<string | null> {
    const hasOpenAI = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    if (!hasOpenAI) return null;

    try {
      const policy = await AppSettingsService.getAppGenPolicy();
      const resolved = DEFAULT_SLOT_DEFS.map((def) => ({
        key: def.key,
        value: slots.get(def.key)?.value ?? null,
        status: slots.get(def.key)?.status ?? 'missing',
      }));
      const recent = this.buildConversationWindow(history, 50, 8);

      const policyLine = policy.ericssonOnly
        ? 'Policy: Ericsson-only mode. Ask only EIAP/rApp relevant questions; do not ask non-Ericsson OEM or SMO questions.'
        : `Policy: Enabled OEMs are ${policy.enabledOems.join(', ')}.`;
      const systemPrompt = `You are a telecom app-building assistant.
Ask exactly ONE concise contextual follow-up question.
Rules:
- Do not repeat the previous assistant question wording.
- Ask for the highest-priority missing slot only.
- Prioritize this order unless already resolved: parameter_name -> mo_class -> action_type -> action_value -> kpi -> operator -> threshold_value.
- Avoid generic OEM/platform/technology questions unless the user explicitly asks to change them.
- Keep it under 28 words.
- Plain sentence only.
- ${policyLine}`;

      const contextMessage = `Resolved slots: ${JSON.stringify(resolved)}
Pending slots: ${JSON.stringify(pendingSlots)}
Generate one contextual follow-up question.`;

      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...recent,
        { role: 'user', content: contextMessage },
      ];

      return this.generateQuestionWithMessages(messages, 80);
    } catch (error) {
      logger.warn('Contextual follow-up generation failed, using deterministic fallback', error);
      return null;
    }
  }

  private static async generateIntentDiscoveryFollowup(
    slots: Map<SlotKey, SlotValueRecord>,
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>
  ): Promise<string | null> {
    const hasOpenAI = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    if (!hasOpenAI) return null;

    const resolved = DEFAULT_SLOT_DEFS.map((def) => ({
      key: def.key,
      value: slots.get(def.key)?.value ?? null,
      status: slots.get(def.key)?.status ?? 'missing',
    }));
    const recent = this.buildConversationWindow(history, 50, 8);

    const policy = await AppSettingsService.getAppGenPolicy();
    const policyLine = policy.ericssonOnly
      ? 'Policy: Ericsson-only mode. Ask only EIAP/rApp relevant questions.'
      : `Policy: Enabled OEMs are ${policy.enabledOems.join(', ')}.`;
    const systemPrompt = `You are a telecom app-building assistant.
User intent is still unclear.
Ask exactly ONE discovery question to identify the desired automation outcome before technical slots.
Keep under 24 words, plain sentence.
${policyLine}`;
    const contextMessage = `Resolved slots: ${JSON.stringify(resolved)}
Ask one intent-first question.`;

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...recent,
      { role: 'user', content: contextMessage },
    ];

    return this.generateQuestionWithMessages(messages, 60);
  }

  private static async generateQuestionWithMessages(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    maxTokens: number
  ): Promise<string | null> {
    const models = [OPENAI_BUILDER_MODEL, 'gpt-4.1-mini', 'gpt-4'];
    for (const model of models) {
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages,
          temperature: 0.2,
          max_tokens: maxTokens,
        });
        const text = completion.choices[0]?.message?.content?.trim();
        if (text) return text;
      } catch (error) {
        logger.warn('OpenAI question generation failed for model', { model, error });
      }
    }
    return null;
  }

  private static async extractStructuredLogicFromHistory(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>,
    slots: Map<SlotKey, SlotValueRecord>
  ): Promise<StructuredLogic | null> {
    const hasOpenAI = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    if (!hasOpenAI) return null;

    const recent = this.buildConversationWindow(history, 50, 8);
    const currentSlots = DEFAULT_SLOT_DEFS.map((def) => ({
      key: def.key,
      value: slots.get(def.key)?.value ?? null,
      status: slots.get(def.key)?.status ?? 'missing',
    }));

    const systemPrompt = `Extract structured telecom automation logic from conversation.
Return JSON only.
Schema:
{
  "intent": "string or null",
  "technology": "4G|5G|BOTH|null",
  "scope": "string or null",
  "granularity": "hourly|daily|null",
  "target_platform": "ERICSSON_EIAP|AIRA_NATIVE|NAAVIK_STORE|NOKIA_EDEN|null",
  "condition_join": "AND|OR",
  "kpis": [{"name":"canonical KPI name", "operator":">|>=|<|<=", "threshold": number, "unit":"%|ms|count|null"}],
  "actions": [{"parameter":"canonical parameter", "mo_class":"MO class or null", "action_type":"increase|decrease|set", "value": number}]
}
Rules:
- Use nearest canonical names.
- Keep arrays empty if unknown.
- No markdown.`;
    const contextMessage = `Current slots: ${JSON.stringify(currentSlots)}
Extract best-effort structured logic from the conversation above.`;

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...recent,
      { role: 'user', content: contextMessage },
    ];

    const models = [OPENAI_BUILDER_MODEL, 'gpt-4.1-mini', 'gpt-4'];
    for (const model of models) {
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages,
          temperature: 0.1,
          max_tokens: 500,
        });
        const text = completion.choices[0]?.message?.content?.trim();
        if (!text) continue;
        const parsed = this.parseJsonObjectFromText(text);
        const structured: StructuredLogic = {
          intent: parsed.intent || undefined,
          technology: parsed.technology || undefined,
          scope: parsed.scope || undefined,
          granularity: parsed.granularity || undefined,
          target_platform: parsed.target_platform || undefined,
          condition_join: parsed.condition_join === 'OR' ? 'OR' : 'AND',
          kpis: Array.isArray(parsed.kpis) ? parsed.kpis.filter(Boolean) : [],
          actions: Array.isArray(parsed.actions) ? parsed.actions.filter(Boolean) : [],
        };
        return structured;
      } catch (error) {
        logger.warn('Structured logic extraction failed for model', { model, error });
      }
    }
    return null;
  }

  private static async applyStructuredLogicFromHistory(
    threadId: string,
    slots: Map<SlotKey, SlotValueRecord>,
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>
  ): Promise<void> {
    const logic = await this.extractStructuredLogicFromHistory(history, slots);
    if (!logic) return;
    const userText = history
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' ');
    const userTextLower = userText.toLowerCase();

    const firstKpi = logic.kpis?.[0];
    if (firstKpi?.name && !slots.get('kpi')?.value && this.userExplicitlyProvidedValue(userText, userTextLower, String(firstKpi.name))) {
      await this.setSlot(threadId, 'kpi', 'confirmed', String(firstKpi.name), String(firstKpi.name));
      slots.set('kpi', { status: 'confirmed', value: String(firstKpi.name), canonicalValue: String(firstKpi.name) });
    }
    if (firstKpi?.operator && !slots.get('operator')?.value) {
      await this.setSlot(threadId, 'operator', 'confirmed', String(firstKpi.operator), String(firstKpi.operator));
      slots.set('operator', { status: 'confirmed', value: String(firstKpi.operator), canonicalValue: String(firstKpi.operator) });
    }
    if (Number.isFinite(firstKpi?.threshold) && !slots.get('threshold_value')?.value) {
      await this.setSlot(threadId, 'threshold_value', 'confirmed', String(firstKpi.threshold), String(firstKpi.threshold));
      slots.set('threshold_value', { status: 'confirmed', value: Number(firstKpi.threshold), canonicalValue: String(firstKpi.threshold) });
    }
    if ((firstKpi?.unit || '%') && !slots.get('threshold_unit')?.value) {
      const unit = String(firstKpi?.unit || '%');
      await this.setSlot(threadId, 'threshold_unit', 'confirmed', unit, unit, unit);
      slots.set('threshold_unit', { status: 'confirmed', value: unit, canonicalValue: unit, unit });
    }

    const firstAction = logic.actions?.[0];
    if (
      firstAction?.parameter &&
      !slots.get('parameter_name')?.value &&
      this.userExplicitlyProvidedValue(userText, userTextLower, String(firstAction.parameter))
    ) {
      const resolved = await ParameterKPIMapperService.resolveParameter(String(firstAction.parameter));
      const canonicalParamName = resolved.matches[0]?.parameter?.parameter_name || String(firstAction.parameter);
      await this.setSlot(threadId, 'parameter_name', 'confirmed', canonicalParamName, canonicalParamName);
      slots.set('parameter_name', { status: 'confirmed', value: canonicalParamName, canonicalValue: canonicalParamName });

      const moFromLogic = firstAction.mo_class ? String(firstAction.mo_class) : '';
      if (moFromLogic) {
        await this.setSlot(threadId, 'mo_class', 'confirmed', moFromLogic, moFromLogic);
        slots.set('mo_class', { status: 'confirmed', value: moFromLogic, canonicalValue: moFromLogic });
      } else if (!slots.get('mo_class')?.value) {
        const moCandidates = await this.getMOCandidatesForParameter(canonicalParamName);
        if (moCandidates.length === 1) {
          await this.setSlot(threadId, 'mo_class', 'confirmed', moCandidates[0].moClass, moCandidates[0].moClass);
          slots.set('mo_class', { status: 'confirmed', value: moCandidates[0].moClass, canonicalValue: moCandidates[0].moClass });
        }
      }
    }
    if (firstAction?.action_type && !slots.get('action_type')?.value) {
      await this.setSlot(threadId, 'action_type', 'confirmed', String(firstAction.action_type), String(firstAction.action_type));
      slots.set('action_type', { status: 'confirmed', value: String(firstAction.action_type), canonicalValue: String(firstAction.action_type) });
    }
    if (Number.isFinite(firstAction?.value) && !slots.get('action_value')?.value) {
      await this.setSlot(threadId, 'action_value', 'confirmed', String(firstAction.value), String(firstAction.value));
      slots.set('action_value', { status: 'confirmed', value: Number(firstAction.value), canonicalValue: String(firstAction.value) });
    }

    if (logic.scope && !slots.get('scope')?.value) {
      await this.setSlot(threadId, 'scope', 'confirmed', logic.scope, logic.scope);
      slots.set('scope', { status: 'confirmed', value: logic.scope, canonicalValue: logic.scope });
    }
    if (logic.technology && !slots.get('technology')?.value) {
      await this.setSlot(threadId, 'technology', 'confirmed', logic.technology, logic.technology);
      slots.set('technology', { status: 'confirmed', value: logic.technology, canonicalValue: logic.technology });
    }
    if (logic.granularity && !slots.get('granularity')?.value) {
      await this.setSlot(threadId, 'granularity', 'confirmed', logic.granularity, logic.granularity);
      slots.set('granularity', { status: 'confirmed', value: logic.granularity, canonicalValue: logic.granularity });
    }
    if (logic.target_platform && !slots.get('target_platform')?.value) {
      await this.setSlot(threadId, 'target_platform', 'confirmed', logic.target_platform, logic.target_platform);
      slots.set('target_platform', { status: 'confirmed', value: logic.target_platform, canonicalValue: logic.target_platform });
    }
  }

  private static countResolvedCoreSlots(slots: Map<SlotKey, SlotValueRecord>): number {
    const coreSlots: SlotKey[] = ['kpi', 'threshold_value', 'parameter_name', 'action_type'];
    return coreSlots.reduce((count, key) => {
      const slot = slots.get(key);
      if (!slot) return count;
      if (slot.status === 'missing' || slot.status === 'ambiguous') return count;
      if (slot.value === null || slot.value === '') return count;
      return count + 1;
    }, 0);
  }

  private static async getDynamicKpiOptions(
    slots: Map<SlotKey, SlotValueRecord>,
    queryText: string
  ): Promise<DisambiguationOption[]> {
    const intent = String(this.getSlotValue(slots, 'intent_category') || '').toLowerCase();
    const query = (queryText || '').trim();
    let candidates = await AppGenCatalogService.listKpis(10, query.length >= 3 ? query : undefined);
    if (candidates.length === 0) {
      candidates = await AppGenCatalogService.listKpis(120);
    }

    const prioritized = candidates
      .filter((c) => {
        const name = c.canonical.toLowerCase();
        if (intent.includes('capacity')) return /prb|util|tput|throughput|traffic|load/.test(name);
        if (intent.includes('mobility')) return /ho|handover|mobility/.test(name);
        if (intent.includes('rf')) return /rsrp|rsrq|sinr|qual|coverage/.test(name);
        if (intent.includes('anomaly')) return /drop|fail|avail|error|alarm/.test(name);
        if (intent.includes('root cause')) return /drop|fail|util|avail|error|alarm|latency/.test(name);
        return true;
      })
      .slice(0, 8);

    const selected = (prioritized.length > 0 ? prioritized : candidates.slice(0, 8)).slice(0, 8);
    return selected.map((c, idx) => ({
      id: `kpi-dyn-${idx + 1}`,
      type: 'kpi',
      displayLabel: c.canonical,
      canonicalName: c.canonical,
      confidence: c.confidence,
    }));
  }

  private static async getDynamicParameterOptions(
    slots: Map<SlotKey, SlotValueRecord>,
    queryText: string
  ): Promise<DisambiguationOption[]> {
    const intent = String(this.getSlotValue(slots, 'intent_category') || '').toLowerCase();
    const query = (queryText || '').trim();
    let candidates = await AppGenCatalogService.listParameters(20, query.length >= 2 ? query : undefined);
    if (candidates.length === 0) {
      candidates = await AppGenCatalogService.listParameters(400);
    }

    const prioritized = candidates
      .filter((c) => {
        const name = c.canonical.toLowerCase();
        if (intent.includes('capacity')) return /qrx|crs|power|load|tilt|offset|harq/.test(name);
        if (intent.includes('mobility')) return /a3|a5|handover|offset|hyst|ttt/.test(name);
        if (intent.includes('rf')) return /power|tilt|rsrp|rsrq|qual|qrx|crs/.test(name);
        if (intent.includes('anomaly')) return /retry|timer|max|thresh|offset/.test(name);
        if (intent.includes('root cause')) return /retry|timer|max|thresh|offset|qrx|power/.test(name);
        return true;
      })
      .slice(0, 20);

    const selected = (prioritized.length > 0 ? prioritized : candidates.slice(0, 20)).slice(0, 20);
    return selected.map((c, idx) => ({
      id: `param-dyn-${idx + 1}`,
      type: 'parameter',
      displayLabel: c.canonical,
      canonicalName: c.canonical,
      confidence: c.confidence,
    }));
  }

  private static getPreferredPendingSlot(pendingSlots: string[]): string {
    const preferredOrder = [
      'parameter_name',
      'mo_class',
      'action_type',
      'action_value',
      'kpi',
      'operator',
      'threshold_value',
      'threshold_unit',
      'scope',
      'technology',
      'granularity',
      'target_platform',
      'app_kind',
      'runtime_target',
      'oem',
      'intent_category',
      'problem_description',
    ];
    const engineeringOrder = [
      'parameter_name',
      'mo_class',
      'action_type',
      'action_value',
      'kpi',
      'operator',
      'threshold_value',
      'technology',
    ];
    for (const key of engineeringOrder) {
      if (pendingSlots.includes(key)) return key;
    }
    for (const key of preferredOrder) {
      if (pendingSlots.includes(key)) return key;
    }
    return pendingSlots[0];
  }

  private static buildWorkflowJson(threadId: string, slots: Map<SlotKey, SlotValueRecord>, logic?: StructuredLogic): Record<string, unknown> {
    const kpi = String(logic?.kpis?.[0]?.name || this.getSlotValue(slots, 'kpi') || 'AVG_DL_PRB_UTIL');
    const operator = String(logic?.kpis?.[0]?.operator || this.getSlotValue(slots, 'operator') || '>=');
    const threshold = Number(logic?.kpis?.[0]?.threshold ?? this.getSlotValue(slots, 'threshold_value') ?? 90);
    const parameter = String(logic?.actions?.[0]?.parameter || this.getSlotValue(slots, 'parameter_name') || 'qRxLevMin');
    const moClass = String(logic?.actions?.[0]?.mo_class || this.getSlotValue(slots, 'mo_class') || 'EUtranCellFDD');
    const actionType = String(logic?.actions?.[0]?.action_type || this.getSlotValue(slots, 'action_type') || 'increase');
    const actionValue = Number(logic?.actions?.[0]?.value ?? this.getSlotValue(slots, 'action_value') ?? 1);
    const scope = String(this.getSlotValue(slots, 'scope') || 'any 4G cell meeting threshold');
    const granularity = String(this.getSlotValue(slots, 'granularity') || 'hourly');

    return {
      version: 'v1',
      scenarioType: 'prb_qrxlevmin_v1',
      threadId,
      nodes: [
        { id: 'start', type: 'start', label: 'Start', data: { scenarioType: 'prb_qrxlevmin_v1' } },
        {
          id: 'condition',
          type: 'condition',
          label: logic?.kpis?.length && logic.kpis.length > 1
            ? `IF ${logic.kpis.map((c) => `${c.name} ${c.operator} ${c.threshold}${c.unit || ''}`).join(` ${logic.condition_join || 'AND'} `)}`
            : `IF ${kpi} ${operator} ${threshold}%`,
          data: {
            technology: '4G',
            kpi,
            operator,
            threshold,
            unit: '%',
            granularity,
          },
        },
        {
          id: 'selection',
          type: 'selection',
          label: `Select cells (${scope})`,
          data: {
            technology: '4G',
            scope,
            criteria: `${kpi} ${operator} ${threshold}%`,
          },
        },
        {
          id: 'action',
          type: 'action',
          label: logic?.actions?.length && logic.actions.length > 1
            ? logic.actions.map((a) => `${a.action_type} ${a.mo_class || moClass}.${a.parameter} by/to ${a.value}`).join(', ')
            : `${actionType} ${moClass}.${parameter} by ${actionValue}`,
          data: {
            moClass,
            parameter,
            actionType,
            actionValue,
            safeMode: true,
          },
        },
        { id: 'end', type: 'end', label: 'End', data: { outcome: 'workflow + code generated' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'condition' },
        { id: 'e2', source: 'condition', target: 'selection', label: 'true' },
        { id: 'e3', source: 'selection', target: 'action' },
        { id: 'e4', source: 'action', target: 'end' },
      ],
      metadata: {
        appContext: {
          appKind: this.getSlotValue(slots, 'app_kind'),
          runtimeTarget: this.getSlotValue(slots, 'runtime_target'),
          oem: this.getSlotValue(slots, 'oem'),
          intentCategory: this.getSlotValue(slots, 'intent_category'),
          problemDescription: this.getSlotValue(slots, 'problem_description'),
        },
        canonical: {
          kpi: logic?.kpis?.length ? logic.kpis : kpi,
          parameter,
          moClass,
          threshold,
          unit: '%',
          granularity,
        },
      },
    };
  }

  private static buildGenerationPrompt(slots: Map<SlotKey, SlotValueRecord>): string {
    const kpi = String(this.getSlotValue(slots, 'kpi') || 'AVG_DL_PRB_UTIL');
    const operator = String(this.getSlotValue(slots, 'operator') || '>=');
    const threshold = Number(this.getSlotValue(slots, 'threshold_value') || 90);
    const parameter = String(this.getSlotValue(slots, 'parameter_name') || 'qRxLevMin');
    const moClass = String(this.getSlotValue(slots, 'mo_class') || 'EUtranCellFDD');
    const actionType = String(this.getSlotValue(slots, 'action_type') || 'increase');
    const actionValue = Number(this.getSlotValue(slots, 'action_value') || 1);
    const scope = String(this.getSlotValue(slots, 'scope') || 'any 4G cell meeting threshold');
    const granularity = String(this.getSlotValue(slots, 'granularity') || 'hourly');
    const target = String(this.getSlotValue(slots, 'target_platform') || 'ERICSSON_EIAP');

    return [
      'Generate telecom-hardened EIAP Python code with safety mode enabled (generate-only, no live execution).',
      `Use technology: 4G.`,
      `Monitor KPI ${kpi} at ${granularity} granularity.`,
      `Condition: ${kpi} ${operator} ${threshold}% on ${scope}.`,
      `Action: ${actionType} ${moClass}.${parameter} by ${actionValue}.`,
      `Target platform: ${target}.`,
      'Include KPI retrieval block, cell filtering logic, guarded parameter mutation block, and report payload.',
    ].join(' ');
  }

  private static async generateCodeWithLLM(
    threadId: string,
    slots: Map<SlotKey, SlotValueRecord>,
    logic?: StructuredLogic
  ): Promise<{ code: string; appName: string } | null> {
    const hasOpenAI = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    if (!hasOpenAI) return null;

    try {
      const kpi = String(logic?.kpis?.[0]?.name || this.getSlotValue(slots, 'kpi') || 'Throughput');
      const operator = String(logic?.kpis?.[0]?.operator || this.getSlotValue(slots, 'operator') || '>=');
      const threshold = String(logic?.kpis?.[0]?.threshold || this.getSlotValue(slots, 'threshold_value') || '80');
      const parameter = String(logic?.actions?.[0]?.parameter || this.getSlotValue(slots, 'parameter_name') || 'qRxLevMin');
      const moClass = String(logic?.actions?.[0]?.mo_class || this.getSlotValue(slots, 'mo_class') || 'EUtranCellFDD');
      const actionType = String(logic?.actions?.[0]?.action_type || this.getSlotValue(slots, 'action_type') || 'increase');
      const actionValue = String(logic?.actions?.[0]?.value || this.getSlotValue(slots, 'action_value') || '1');
      const appName = `builder_${threadId.replace(/-/g, '').slice(0, 10)}`;

      const systemPrompt = `You are an expert telecom automation engineer.
Generate a production-ready Python EIAP (Ericsson IoT Application Platform) rApp script.
The script should:
1. Include proper imports, logging, and error handling
2. Query KPI conditions via data adapters
3. Execute parameterized actions when conditions are met
4. Include docstrings and inline comments
5. Be compatible with EIAP runtime environment
6. Include a main class with execute() method`;

      const userPrompt = `Generate a Python EIAP rApp with these specifications:
- App Name: ${appName}
- Condition: ${kpi} ${operator} ${threshold}
- Action: ${actionType} ${moClass}.${parameter} by ${actionValue}

The script should follow EIAP patterns with DataAdapter, R1ServiceClient, and proper exception handling.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const generatedCode = completion.choices[0]?.message?.content?.trim();
      if (generatedCode) {
        return { code: generatedCode, appName };
      }
    } catch (error) {
      logger.warn('LLM code generation failed, will fall back to deterministic', error);
    }

    return null;
  }

  private static buildDeterministicEiapCode(
    threadId: string,
    slots: Map<SlotKey, SlotValueRecord>,
    logic?: StructuredLogic
  ): { code: string; appName: string } {
    const conditions = logic?.kpis?.length
      ? logic.kpis
      : [{
          name: String(this.getSlotValue(slots, 'kpi') || 'AVG_DL_PRB_UTIL'),
          operator: String(this.getSlotValue(slots, 'operator') || '>=') as '>' | '>=' | '<' | '<=',
          threshold: Number(this.getSlotValue(slots, 'threshold_value') || 90),
          unit: String(this.getSlotValue(slots, 'threshold_unit') || '%'),
        }];
    const actions = logic?.actions?.length
      ? logic.actions
      : [{
          parameter: String(this.getSlotValue(slots, 'parameter_name') || 'qRxLevMin'),
          mo_class: String(this.getSlotValue(slots, 'mo_class') || 'EUtranCellFDD'),
          action_type: String(this.getSlotValue(slots, 'action_type') || 'increase') as 'increase' | 'decrease' | 'set',
          value: Number(this.getSlotValue(slots, 'action_value') || 1),
        }];
    const kpi = conditions[0].name;
    const operator = conditions[0].operator;
    const threshold = Number(conditions[0].threshold);
    const parameter = actions[0].parameter;
    const moClass = String(actions[0].mo_class || this.getSlotValue(slots, 'mo_class') || 'EUtranCellFDD');
    const actionType = actions[0].action_type;
    const actionValue = Number(actions[0].value);
    const scope = String(this.getSlotValue(slots, 'scope') || 'any 4G cell meeting threshold');
    const granularity = String(this.getSlotValue(slots, 'granularity') || 'hourly');
    const appName = `builder_${threadId.replace(/-/g, '').slice(0, 10)}`;
    const joinOp = logic?.condition_join === 'OR' ? 'or' : 'and';
    const conditionExpr = conditions
      .map((c, i) => {
        const opExpr = c.operator === '>=' ? '>=' : c.operator === '>' ? '>' : c.operator === '<=' ? '<=' : '<';
        return `(kpi_${i} is not None and kpi_${i} ${opExpr} ${Number(c.threshold)})`;
      })
      .join(` ${joinOp} `);
    const actionLines = actions.map((a, i) => {
      const mo = a.mo_class || moClass;
      const expr =
        a.action_type === 'set'
          ? `${Number(a.value)}`
          : a.action_type === 'decrease'
            ? `current_value_${i} - ${Number(a.value)}`
            : `current_value_${i} + ${Number(a.value)}`;
      const desc =
        a.action_type === 'set'
          ? `set ${mo}.${a.parameter} to ${Number(a.value)}`
          : `${a.action_type} ${mo}.${a.parameter} by ${Number(a.value)}`;
      return [
        `                    current_value_${i} = self.data_adapter.get(cm_id, "${mo}", "${a.parameter}")`,
        `                    if current_value_${i} is not None:`,
        `                        new_value_${i} = ${expr}`,
        `                        self.data_adapter.update(cm_id, "${mo}", "${a.parameter}", new_value_${i})`,
        `                        self.report[cm_id]["action_${i + 1}"] = "${desc}"`,
        `                        self.report[cm_id]["from_${i + 1}"] = current_value_${i}`,
        `                        self.report[cm_id]["to_${i + 1}"] = new_value_${i}`,
      ].join('\n');
    }).join('\n');

    const intentCategory = String(this.getSlotValue(slots, 'intent_category') || 'optimization');
    const runtimeTarget = String(this.getSlotValue(slots, 'runtime_target') || 'EIAP');
    const targetPlatform = String(this.getSlotValue(slots, 'target_platform') || 'ERICSSON_EIAP');
    const conditionsJson = JSON.stringify(conditions.map((c) => ({ name: c.name, op: c.operator, threshold: c.threshold })));
    const actionsJson = JSON.stringify(actions.map((a) => ({ param: a.parameter, mo: a.mo_class || moClass, type: a.action_type, val: a.value })));

    const code = `"""
rApp: ${appName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by Naavik AppGen – Conversational Builder V1
thread_id   : ${threadId}
intent      : ${intentCategory}
runtime     : ${runtimeTarget}
platform    : ${targetPlatform}

KPI Conditions:
${conditions.map((c) => `  • ${c.name} ${c.operator} ${c.threshold}${c.unit || ''}`).join('\n')}

Parameter Actions:
${actions.map((a) => `  • ${a.action_type} ${a.mo_class || moClass}.${a.parameter} by ${a.value}`).join('\n')}

Scope       : ${scope}
Granularity : ${granularity}
Generated   : ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

# ── Imports ──────────────────────────────────────────────────────────
from adaptors.eiap.eiap_adaptor import EIAPAdaptor as DataAdapter
from adaptors.eiap.r1_interface import R1ServiceClient
import json
import logging
import os
import sys
from datetime import datetime, timezone
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

# ── Logging ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("${appName}")

# ── Constants ────────────────────────────────────────────────────────
APP_NAME = "${appName}"
APP_VERSION = "1.0.0"
TARGET_PLATFORM = "${targetPlatform}"
GRANULARITY = "${granularity}"
SCOPE_DESCRIPTION = "${scope}"

KPI_CONDITIONS = ${conditionsJson}
PARAMETER_ACTIONS = ${actionsJson}

R1_ENTITY_ENDPOINT = (
    "/domains/RAN/entity-types/${moClass}/entities"
    "?targetFilter=/sourceIds;/attributes"
)
R1_CM_NOTIFICATION_TOPIC = "/domains/RAN/cm-notifications"

MAX_CELLS_PER_BATCH = 500
DRY_RUN = os.environ.get("RAPP_DRY_RUN", "false").lower() == "true"
ROLLBACK_ON_FAILURE = True


# ── Helper utilities ─────────────────────────────────────────────────
def _safe_float(value: Any) -> Optional[float]:
    """Convert a value to float, returning None on failure."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _evaluate_condition(
    kpi_values: Dict[str, Optional[float]],
    conditions: List[Dict],
    join: str = "${joinOp}",
) -> bool:
    """Evaluate a set of KPI conditions with the given join operator."""
    results = []
    for cond in conditions:
        val = kpi_values.get(cond["name"])
        if val is None:
            results.append(False)
            continue
        op = cond["op"]
        thr = float(cond["threshold"])
        if op == ">=":
            results.append(val >= thr)
        elif op == ">":
            results.append(val > thr)
        elif op == "<=":
            results.append(val <= thr)
        elif op == "<":
            results.append(val < thr)
        else:
            results.append(False)
    if join == "or":
        return any(results)
    return all(results)


# ══════════════════════════════════════════════════════════════════════
#  Main rApp class
# ══════════════════════════════════════════════════════════════════════
class ${appName}:
    """
    Naavik-generated rApp for automated RAN parameter optimisation.
    Connects to the R1 interface via EIAPAdaptor, evaluates KPI
    conditions per cell, and applies parameter mutations when
    thresholds are breached.
    """

    def __init__(self, dry_run: bool = DRY_RUN):
        logger.info("Initialising %s v%s  (dry_run=%s)", APP_NAME, APP_VERSION, dry_run)
        self.data_adapter = DataAdapter()
        self.r1_client = R1ServiceClient()
        self.report: Dict[str, Dict[str, Any]] = defaultdict(dict)
        self.rollback_log: List[Dict[str, Any]] = []
        self.app_name = APP_NAME
        self.dry_run = dry_run
        self._actions_taken = 0
        self._cells_evaluated = 0
        self._errors = 0

    # ── Cell discovery ───────────────────────────────────────────────
    def _discover_cells(self) -> List[str]:
        """Fetch CM handle IDs from the R1 interface."""
        logger.info("Discovering cells via R1 endpoint: %s", R1_ENTITY_ENDPOINT)
        cm_ids = self.data_adapter.get_cm_handle_ids(R1_ENTITY_ENDPOINT)
        logger.info("Discovered %d cells in scope", len(cm_ids))
        return cm_ids

    # ── KPI retrieval ────────────────────────────────────────────────
    def _fetch_kpis(self, cm_id: str) -> Dict[str, Optional[float]]:
        """Retrieve all configured KPIs for a single cell."""
        kpi_values: Dict[str, Optional[float]] = {}
        for cond in KPI_CONDITIONS:
            raw = self.data_adapter.get(cm_id, "kpi", cond["name"])
            kpi_values[cond["name"]] = _safe_float(raw)
        return kpi_values

    # ── Parameter mutation ───────────────────────────────────────────
    def _apply_actions(
        self, cm_id: str, kpi_snapshot: Dict[str, Optional[float]]
    ) -> Tuple[bool, List[Dict[str, Any]]]:
        """
        Apply configured parameter actions to a cell.
        Returns (success, list_of_changes).
        """
        changes: List[Dict[str, Any]] = []

        for idx, act in enumerate(PARAMETER_ACTIONS):
            mo_class = act["mo"]
            param = act["param"]
            action_type = act["type"]
            delta = float(act["val"])

            current_raw = self.data_adapter.get(cm_id, mo_class, param)
            current_value = _safe_float(current_raw)
            if current_value is None:
                logger.warning(
                    "Cell %s: could not read %s.%s – skipping action %d",
                    cm_id, mo_class, param, idx,
                )
                continue

            if action_type == "set":
                new_value = delta
            elif action_type == "decrease":
                new_value = current_value - delta
            else:
                new_value = current_value + delta

            change_record = {
                "cm_id": cm_id,
                "mo_class": mo_class,
                "parameter": param,
                "action": action_type,
                "from": current_value,
                "to": new_value,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            if self.dry_run:
                logger.info(
                    "[DRY-RUN] Cell %s: would %s %s.%s  %.2f → %.2f",
                    cm_id, action_type, mo_class, param, current_value, new_value,
                )
                change_record["dry_run"] = True
            else:
                self.data_adapter.update(cm_id, mo_class, param, new_value)
                logger.info(
                    "Cell %s: %s %s.%s  %.2f → %.2f",
                    cm_id, action_type, mo_class, param, current_value, new_value,
                )

            changes.append(change_record)
            self.rollback_log.append(change_record)

        return len(changes) > 0, changes

    # ── Rollback ─────────────────────────────────────────────────────
    def _rollback(self):
        """Revert all parameter changes made during this execution."""
        if self.dry_run:
            logger.info("[DRY-RUN] Rollback skipped.")
            return
        logger.warning("Rolling back %d parameter changes...", len(self.rollback_log))
        for entry in reversed(self.rollback_log):
            try:
                self.data_adapter.update(
                    entry["cm_id"],
                    entry["mo_class"],
                    entry["parameter"],
                    entry["from"],
                )
                logger.info(
                    "Rolled back %s.%s on %s → %.2f",
                    entry["mo_class"], entry["parameter"], entry["cm_id"], entry["from"],
                )
            except Exception as rollback_err:
                logger.error("Rollback failed for %s: %s", entry["cm_id"], rollback_err)

    # ── Main execution loop ──────────────────────────────────────────
    def execute(self) -> Dict[str, Any]:
        """
        Run the optimisation loop:
          1. Discover cells from R1 interface
          2. Evaluate KPI conditions per cell
          3. Apply parameter mutations where thresholds breached
          4. Build execution report
        """
        logger.info("═" * 60)
        logger.info("  Execution started: %s", APP_NAME)
        logger.info("  Scope: %s | Granularity: %s", SCOPE_DESCRIPTION, GRANULARITY)
        logger.info("═" * 60)

        start_ts = datetime.now(timezone.utc)
        cm_ids = self._discover_cells()

        for batch_start in range(0, len(cm_ids), MAX_CELLS_PER_BATCH):
            batch = cm_ids[batch_start : batch_start + MAX_CELLS_PER_BATCH]
            logger.info(
                "Processing batch %d–%d of %d cells",
                batch_start + 1,
                min(batch_start + len(batch), len(cm_ids)),
                len(cm_ids),
            )

            for cm_id in batch:
                self._cells_evaluated += 1
                try:
                    kpi_values = self._fetch_kpis(cm_id)
                    breached = _evaluate_condition(kpi_values, KPI_CONDITIONS)

                    if breached:
                        success, changes = self._apply_actions(cm_id, kpi_values)
                        if success:
                            self._actions_taken += 1
                        self.report[cm_id] = {
                            "status": "action_applied" if success else "action_skipped",
                            "kpi_snapshot": kpi_values,
                            "changes": changes,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                    else:
                        self.report[cm_id] = {
                            "status": "no_action",
                            "kpi_snapshot": kpi_values,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }

                except Exception as cell_err:
                    self._errors += 1
                    logger.error("Error processing cell %s: %s", cm_id, cell_err)
                    self.report[cm_id] = {"status": "error", "error": str(cell_err)}

                    if ROLLBACK_ON_FAILURE and self._errors > len(cm_ids) * 0.1:
                        logger.critical(
                            "Error rate exceeded 10%% – triggering rollback."
                        )
                        self._rollback()
                        break

        end_ts = datetime.now(timezone.utc)
        elapsed = (end_ts - start_ts).total_seconds()

        summary = {
            "app_name": self.app_name,
            "app_version": APP_VERSION,
            "target_platform": TARGET_PLATFORM,
            "execution_start": start_ts.isoformat(),
            "execution_end": end_ts.isoformat(),
            "elapsed_seconds": round(elapsed, 2),
            "cells_evaluated": self._cells_evaluated,
            "actions_taken": self._actions_taken,
            "errors": self._errors,
            "dry_run": self.dry_run,
            "kpi_conditions": KPI_CONDITIONS,
            "parameter_actions": PARAMETER_ACTIONS,
            "scope": SCOPE_DESCRIPTION,
            "granularity": GRANULARITY,
            "details": dict(self.report),
        }

        logger.info("═" * 60)
        logger.info("  Execution complete: %d actions on %d cells (%.1fs)",
                     self._actions_taken, self._cells_evaluated, elapsed)
        logger.info("═" * 60)

        return summary


# ── Entry point ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="${appName} – Naavik rApp")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    parser.add_argument("--output", type=str, default=None, help="Write report JSON to file")
    args = parser.parse_args()

    app = ${appName}(dry_run=args.dry_run or DRY_RUN)
    result = app.execute()

    report_json = json.dumps(result, indent=2, default=str)
    if args.output:
        with open(args.output, "w") as f:
            f.write(report_json)
        logger.info("Report written to %s", args.output)
    else:
        print(report_json)
`;
    return { code, appName };
  }

  private static async buildState(
    threadId: string,
    channel: BuilderChannel,
    slots: Map<SlotKey, SlotValueRecord>,
    disambiguation: DisambiguationPayload | null,
    canGenerate: boolean
  ): Promise<BuilderState> {
    const pendingSlots = this.computePendingSlots(slots);
    const artifacts = await ConversationSessionModel.getArtifacts(threadId);
    const slotItems: BuilderSlot[] = DEFAULT_SLOT_DEFS.map((def) => {
      const value = slots.get(def.key);
      return {
        key: def.key,
        label: def.label,
        required: def.required,
        status: value?.status || 'missing',
        value: value?.value ?? null,
        canonicalValue: value?.canonicalValue,
        unit: value?.unit,
      };
    });

    return {
      threadId,
      scenarioType: 'prb_qrxlevmin_v1',
      channel,
      status: canGenerate ? 'completed' : 'active',
      canGenerate,
      slots: slotItems,
      pendingSlots,
      disambiguation,
      artifacts,
    };
  }

  private static getPendingDisambiguation(slots: Map<SlotKey, SlotValueRecord>): DisambiguationPayload | null {
    return this.buildDisambiguation(slots);
  }

  private static extractParameterHint(lower: string): string | null {
    const genericTokens = new Set([
      'parameter',
      'param',
      'value',
      'threshold',
      'kpi',
      'metric',
      'condition',
      'conditions',
      'change',
      'set',
      'increase',
      'decrease',
      'update',
      'modify',
      'adjust',
    ]);

    if (lower.includes('qrxlevmin') || lower.includes('qrx lev min')) return 'qRxLevMin';
    if (lower.includes('administrativestate') || lower.includes('administrative state')) return 'administrativeState';
    if (lower.includes('parameter') || lower.includes('param')) {
      const match = lower.match(/(?:parameter|param)\s+([a-z][a-z0-9_]+)/);
      if (match && !genericTokens.has(match[1])) return match[1];
    }
    const actionParamMatch = lower.match(/(?:change|set|increase|decrease|adjust|modify)\s+([a-z][a-z0-9_]+)/);
    if (actionParamMatch && !genericTokens.has(actionParamMatch[1])) return actionParamMatch[1];
    const singleToken = lower.trim().match(/^([a-z][a-z0-9_]{2,})$/);
    if (singleToken && !genericTokens.has(singleToken[1])) return singleToken[1];
    return null;
  }

  private static isLikelyParameterInput(message: string, lower: string): boolean {
    const text = String(message || '').trim();
    if (!text) return false;
    if (text.length < 2) return false;
    if (/^\d+$/.test(text)) return false;

    const genericOnly = /^(parameter|param|value|threshold|condition|kpi|metric|change|set|increase|decrease|update|modify|adjust)$/i;
    if (genericOnly.test(text)) return false;
    if (this.extractMoClassHint(text, lower)) return false;

    if (/([a-z]+[A-Z][a-zA-Z0-9]*)|([a-zA-Z]+_[a-zA-Z0-9_]+)|([a-z]{3,}\d{1,})/.test(text)) return true;
    if (/(parameter|param)\s+[a-z]/.test(lower)) return true;
    if (/(change|set|increase|decrease|adjust|modify)\s+[a-z]/.test(lower)) return true;
    if (/^[a-z][a-z0-9_]{2,}$/i.test(text)) return true;
    return false;
  }

  private static extractMoClassHint(message: string, lower: string): string | null {
    const raw = String(message || '').trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) return null;
    if (/(^|[^a-z0-9])(eutrancellfdd|eutrancell)([^a-z0-9]|$)/.test(` ${lower} `) || normalized === 'eutrancellfdd' || normalized === 'eutrancell') {
      return 'EUtranCellFDD';
    }
    if (/(^|[^a-z0-9])(eutrancelltdd)([^a-z0-9]|$)/.test(` ${lower} `) || normalized === 'eutrancelltdd') {
      return 'EUtranCellTDD';
    }
    if (/(^|[^a-z0-9])(nrcelldu|nrcellcu|nrcell)([^a-z0-9]|$)/.test(` ${lower} `)) {
      if (normalized.includes('nrcelldu')) return 'NRCellDU';
      if (normalized.includes('nrcellcu')) return 'NRCellCU';
      return 'NRCellDU';
    }
    return null;
  }

  private static extractKpiHint(lower: string): string | null {
    if (lower.includes('prb') || lower.includes('util')) return 'AVG_DL_PRB_UTIL';
    if (lower.includes('rrc')) return 'RRC_FAILURE_RATE';
    if (lower.includes('drop')) return 'DATA_DROP_RATE';
    if (lower.includes('throughput') || lower.includes('tput')) return 'DL_DRB_TPUT';
    const metricMatch = lower.match(/(?:kpi|metric)\s+([a-z][a-z0-9_ ]{2,})/);
    if (metricMatch) return metricMatch[1].trim();
    return null;
  }

  private static extractActionType(lower: string): 'increase' | 'decrease' | 'set' | null {
    if (lower.includes('increase')) return 'increase';
    if (lower.includes('decrease')) return 'decrease';
    if (lower.includes('set')) return 'set';
    return null;
  }

  private static extractActionValue(lower: string): number | null {
    const incMatch = lower.match(/increase(?:\s+by)?\s+(\d+(?:\.\d+)?)/);
    if (incMatch) return Number(incMatch[1]);
    const decMatch = lower.match(/decrease(?:\s+by)?\s+(\d+(?:\.\d+)?)/);
    if (decMatch) return Number(decMatch[1]);
    const setMatch = lower.match(/set(?:\s+to)?\s+(\d+(?:\.\d+)?)/);
    if (setMatch) return Number(setMatch[1]);
    return null;
  }

  private static normalizeOperator(value: string): string {
    switch (value) {
      case 'at least':
      case 'or higher':
      case 'above':
      case 'greater than':
      case '>':
        return value === '>' ? '>' : '>=';
      case 'below':
      case 'less than':
      case '<':
        return '<';
      case '<=':
      case '>=':
        return value;
      default:
        return '>=';
    }
  }

  private static parseJsonObjectFromText(content: string): Record<string, any> {
    const text = String(content || '').trim();
    if (!text) throw new Error('Empty model response');
    try {
      return JSON.parse(text);
    } catch {
      const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fencedMatch?.[1]) {
        return JSON.parse(fencedMatch[1]);
      }
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch?.[0]) {
        return JSON.parse(objectMatch[0]);
      }
      throw new Error('Unable to parse JSON object');
    }
  }

  private static async setSlot(
    threadId: string,
    key: SlotKey,
    status: SlotStatus,
    valueText?: string | null,
    canonicalValue?: string | null,
    unit?: string,
    extraJson?: Record<string, unknown>
  ): Promise<void> {
    const valueJson = {
      canonicalValue: canonicalValue || undefined,
      unit: unit || undefined,
      ...(extraJson || {}),
    };
    await ConversationSessionModel.upsertSlot(
      threadId,
      key,
      status,
      valueText ?? null,
      Object.keys(valueJson).length > 0 ? valueJson : null
    );
  }

  private static getSlotValue(slots: Map<SlotKey, SlotValueRecord>, key: SlotKey): string | number | null {
    return slots.get(key)?.value ?? null;
  }

  private static parsePossiblyNumeric(value: string): string | number {
    const num = Number(value);
    return Number.isFinite(num) && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? num : value;
  }

  private static async summarizeConversation(
    threadId: string,
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>
  ): Promise<void> {
    const hasOpenAI = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    if (!hasOpenAI) return;

    // Only summarize if more than 30 messages
    if (history.length <= 30) return;

    try {
      const headMessages = history.slice(0, 30);
      const systemPrompt = `Summarize this conversation in 2-3 sentences, focusing on:
- The user's automation intent (what they want to automate)
- Key decisions made (KPI choice, parameters, actions)
- Current state (what's been resolved, what's pending)`;

      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...headMessages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
        { role: 'user', content: 'Summarize the conversation so far.' },
      ];

      const models = [OPENAI_BUILDER_MODEL, 'gpt-4.1-mini', 'gpt-4'];
      for (const model of models) {
        try {
          const completion = await openai.chat.completions.create({
            model,
            messages,
            temperature: 0.3,
            max_tokens: 150,
          });
          const summary = completion.choices[0]?.message?.content?.trim();
          if (summary) {
            // Store summary and archive the messages
            await ConversationSessionModel.setConversationSummary(threadId, summary);
            const cutoffTime = headMessages[headMessages.length - 1]?.createdAt || new Date().toISOString();
            await ConversationSessionModel.archiveMessagesUpTo(threadId, cutoffTime);
            logger.info('Conversation summarized', { threadId, summaryLength: summary.length });
            return;
          }
        } catch (error) {
          logger.warn('Summarization failed for model', { model, error });
        }
      }
    } catch (error) {
      logger.warn('Conversation summarization failed', { threadId, error });
    }
  }

  private static buildConversationWindow(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; createdAt: string }>,
    maxTurns: number = 50,
    headTurns: number = 8
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const normalized = history.map((m) => ({ role: m.role, content: m.content }));
    if (normalized.length <= maxTurns) return normalized;

    const safeHead = Math.max(0, Math.min(headTurns, maxTurns - 1));
    const head = normalized.slice(0, safeHead);
    const tailCount = Math.max(0, maxTurns - head.length);
    const tail = normalized.slice(-tailCount);
    const combined = [...head, ...tail];

    // Remove overlaps when conversation is shorter than head+tail.
    const dedup: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    const seen = new Set<string>();
    for (const item of combined) {
      const key = `${item.role}::${item.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(item);
    }
    return dedup.slice(-maxTurns);
  }

  private static userExplicitlyProvidedValue(message: string, lower: string, canonical: string): boolean {
    const canonicalLower = canonical.toLowerCase();
    if (lower.includes(canonicalLower)) return true;

    const normalizedMessage = message
      .toLowerCase()
      .replace(/[_\-]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const normalizedCanonical = canonical
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalizedMessage.includes(normalizedCanonical);
  }

  private static async getMOCandidatesForParameter(parameterName: string): Promise<Array<{ moClass: string; confidence: number }>> {
    try {
      const result = await pool.query(
        `
        SELECT mo_class, MAX(conf) as confidence
        FROM (
          SELECT COALESCE(mo_class, 'UNKNOWN') as mo_class, 0.9::float AS conf
          FROM parameter_table
          WHERE LOWER(parameter_name) = LOWER($1)
          UNION ALL
          SELECT COALESCE(mo_class, 'UNKNOWN') as mo_class, 0.8::float AS conf
          FROM ericsson_parameters
          WHERE LOWER(parameter_name) = LOWER($1)
        ) q
        GROUP BY mo_class
        ORDER BY confidence DESC, mo_class ASC
        `,
        [parameterName]
      );

      if (result.rows.length === 0) {
        // Fallback to default MO class for v1 scenario.
        return [{ moClass: 'EUtranCellFDD', confidence: 0.5 }];
      }

      const MO_CLASS_REMAP: Record<string, string> = {
        'NeighborRelation': 'EUtranCellRelation',
        'neighborRelation': 'EUtranCellRelation',
        'neighborrelation': 'EUtranCellRelation',
      };
      return result.rows.map((row) => ({
        moClass: MO_CLASS_REMAP[row.mo_class] || row.mo_class,
        confidence: Number(row.confidence),
      }));
    } catch (error) {
      logger.warn('Failed to fetch MO candidates, using fallback', { parameterName, error });
      return [{ moClass: 'EUtranCellFDD', confidence: 0.5 }];
    }
  }
}
