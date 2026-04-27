import { randomUUID } from 'crypto';
import { ConversationalBuilderService } from './conversational-builder.service.js';
import { AppSettingsService } from './app-settings.service.js';
import type {
  AppGenAgentChannel,
  AppGenAgentChatResponse,
  AppGenChoice,
  BuilderState,
} from '../types/conversational-builder.js';

interface ChatInput {
  threadId?: string;
  message: string;
  channel: AppGenAgentChannel;
}

interface AuthorizationRecord {
  token: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 1000 * 60 * 30;

export class AppGenUnifiedAgentService {
  private static authTokens = new Map<string, AuthorizationRecord>();

  static async chat(input: ChatInput): Promise<AppGenAgentChatResponse> {
    const mappedChannel = this.mapChannel(input.channel);
    const response = await ConversationalBuilderService.chat({
      threadId: input.threadId,
      message: input.message,
      channel: mappedChannel,
    });

    const policy = await AppSettingsService.getAppGenPolicy();
    const choices = this.buildChoices(response.state, policy.enabledOems, policy.ericssonOnly);
    let authorizationToken: string | undefined;
    if (response.canGenerate) {
      authorizationToken = this.issueAuthorizationToken(response.threadId);
    } else {
      this.authTokens.delete(response.threadId);
    }

    return {
      ...response,
      channel: input.channel,
      choices,
      authorizationToken,
    };
  }

  static async getState(threadId: string, channel: AppGenAgentChannel): Promise<BuilderState | null> {
    const state = await ConversationalBuilderService.getState(threadId);
    if (!state) return null;
    return {
      ...state,
      channel: this.mapChannel(channel),
    };
  }

  static async generate(threadId: string, authorizationToken: string): Promise<{ workflowJson: Record<string, unknown>; eiapCode: string; state: BuilderState }> {
    this.requireValidAuthorizationToken(threadId, authorizationToken);
    const result = await ConversationalBuilderService.generate(threadId);
    this.authTokens.delete(threadId);
    return result;
  }

  static async packageRapp(threadId: string): Promise<{ packageId: string; packagePath: string; archivePath: string; validation: any }> {
    return ConversationalBuilderService.packageRapp(threadId);
  }

  static async reset(threadId: string): Promise<void> {
    this.authTokens.delete(threadId);
    await ConversationalBuilderService.reset(threadId);
  }

  private static mapChannel(channel: AppGenAgentChannel): 'appstore' | 'main_chat' {
    return channel === 'home_build' ? 'main_chat' : 'appstore';
  }

  private static buildChoices(state: BuilderState, enabledOems: string[], ericssonOnly: boolean): AppGenChoice[] {
    if (state.canGenerate) {
      return [
        { id: 'edit-kpi', label: 'Edit KPI Condition', value: '__edit_logic__:kpi', action: 'refine' },
        { id: 'edit-parameter', label: 'Edit Parameter + MO', value: '__edit_logic__:parameter_mo', action: 'refine' },
        { id: 'edit-action', label: 'Edit Action', value: '__edit_logic__:action', action: 'refine' },
        { id: 'edit-scope', label: 'Edit Scope', value: '__edit_logic__:scope', action: 'refine' },
        { id: 'add-kpi-condition', label: 'Add KPI Condition', value: '__add_kpi_condition__', action: 'chat' },
        { id: 'refine-inputs', label: 'Refine Inputs', value: '__refine_inputs__', action: 'refine' },
        { id: 'authorize-build', label: 'Authorize Build', value: '__authorize_build__', action: 'authorize_generate' },
      ];
    }

    if (state.disambiguation?.options?.length) {
      return state.disambiguation.options.map((option, idx) => ({
        id: option.id,
        label: option.displayLabel,
        value: String(idx + 1),
        confidence: option.confidence,
        action: 'chat',
      }));
    }

    // Intake questions are LLM-driven; do not inject static slot chips.
    // Keep only disambiguation and explicit build-gate chips.
    void enabledOems;
    void ericssonOnly;
    return [];
  }

  private static issueAuthorizationToken(threadId: string): string {
    const token = randomUUID();
    this.authTokens.set(threadId, {
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return token;
  }

  private static requireValidAuthorizationToken(threadId: string, token: string): void {
    const record = this.authTokens.get(threadId);
    if (!record || record.token !== token) {
      throw new Error('Build authorization token is invalid. Re-authorize build before generation.');
    }
    if (Date.now() > record.expiresAt) {
      this.authTokens.delete(threadId);
      throw new Error('Build authorization token expired. Re-authorize build before generation.');
    }
  }
}
