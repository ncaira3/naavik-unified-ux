export type BuilderScenarioType = 'prb_qrxlevmin_v1';
export type SlotStatus = 'missing' | 'resolved' | 'ambiguous' | 'confirmed';
export type BuilderChannel = 'appstore' | 'main_chat';
export type AppGenAgentChannel = 'home_build' | 'appgen_chat';

export interface BuilderSlot {
  key: string;
  label: string;
  status: SlotStatus;
  value?: string | number | boolean | null;
  canonicalValue?: string;
  unit?: string;
  required: boolean;
}

export interface DisambiguationOption {
  id: string;
  type: 'parameter' | 'kpi' | 'mo_parameter';
  displayLabel: string;
  canonicalName: string;
  moClass?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface DisambiguationPayload {
  type: 'parameter' | 'kpi' | 'mo_parameter';
  slotKey: string;
  prompt: string;
  options: DisambiguationOption[];
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  selectionMode: 'single_choice' | 'multi_choice' | 'free_text';
  options?: { key: string; value: string }[];
  allowFreeText?: boolean;
  allowSkip?: boolean;
  placeholder?: string;
}

export interface ClarificationPayload {
  questions: ClarificationQuestion[];
}

export interface BuilderArtifact {
  type: 'workflow_json' | 'eiap_code' | 'rapp_package';
  status: 'created' | 'validated' | 'failed';
  filePath?: string;
  metadata?: Record<string, unknown>;
}

export interface BuilderState {
  threadId: string;
  scenarioType: BuilderScenarioType;
  channel: BuilderChannel;
  status: 'active' | 'completed' | 'reset' | 'archived';
  canGenerate: boolean;
  slots: BuilderSlot[];
  pendingSlots: string[];
  disambiguation?: DisambiguationPayload | null;
  artifacts?: BuilderArtifact[];
  workflowJson?: Record<string, unknown>;
  eiapCode?: string;
  conversationPhase?: 'intake' | 'spec_draft' | 'spec_review' | 'approved' | 'generating' | 'completed';
  conversationSummary?: string | null;
}

export interface BuilderChatResponse {
  threadId: string;
  assistantMessage: string;
  state: BuilderState;
  pendingSlots: string[];
  canGenerate: boolean;
  disambiguation?: DisambiguationPayload | null;
  artifacts?: BuilderArtifact[];
  clarification?: ClarificationPayload | null;
}

export interface AppGenChoice {
  id: string;
  label: string;
  value: string;
  confidence?: number;
  action?: 'chat' | 'authorize_generate' | 'refine';
}

export interface AppGenAgentChatResponse extends BuilderChatResponse {
  channel: AppGenAgentChannel;
  choices?: AppGenChoice[];
  authorizationToken?: string;
  clarification?: ClarificationPayload | null;
}
