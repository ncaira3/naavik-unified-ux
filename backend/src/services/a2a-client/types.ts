/**
 * A2A (Agent-to-Agent) client types.
 *
 * Naavik consumes other agents that expose the A2A protocol — they publish
 * an Agent Card at `<base>/.well-known/agent.json` and accept JSON-RPC at
 * `<base>/a2a/v1` (or whatever URL the card advertises). Each remote agent
 * exposes a list of `Skill`s, which are coarser than MCP tools — typically
 * one skill represents a whole workflow.
 *
 * We persist enough config to (re)discover the agent and call its skills,
 * and the discovered Agent Card itself for offline reasoning.
 */

export interface A2AAgentConfig {
  id: string;                         // uuid
  name: string;                       // short alias, e.g. "appgen", "att-ops"
  description?: string;
  /** Base URL — we hit `${url}/.well-known/agent.json` for discovery. */
  url: string;
  authMethod: 'none' | 'bearer' | 'oauth2_client_credentials';
  /** Reference into SecretProvider when authMethod requires a token. */
  secretRef?: string | null;
  /** Streams the agent's skills should be advertised on. Empty = all. */
  exposeToStreams?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Faithful subset of the A2A Agent Card spec (Google A2A v1, Apr 2025). */
export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  version?: string;
  provider?: { organization?: string; url?: string };
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: { schemes: string[] };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills: AgentSkill[];
}

export interface AgentSkill {
  id: string;                         // canonical id, e.g. "investigate-site"
  name: string;                       // human-readable
  description?: string;
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  /** Optional JSON Schema for the skill's input — when omitted we pass a
   * free-text "input" string param to the LLM. */
  inputSchema?: Record<string, any>;
}

export interface A2AHealth {
  agentId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastDiscoveredAt?: string;
  lastError?: string;
  /** Last fetched Agent Card — useful for UI / debugging. */
  card?: AgentCard;
}

/** A2A task response shape. */
export interface A2ATaskMessagePart {
  type: 'text' | 'data' | 'file';
  text?: string;
  data?: any;
  file?: { name?: string; mimeType?: string; bytes?: string };
}

export interface A2ATaskArtifact {
  name?: string;
  parts: A2ATaskMessagePart[];
}

export interface A2ATask {
  id: string;
  status: { state: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled' };
  artifacts?: A2ATaskArtifact[];
  /** Last assistant message — surfaced as `llmText` when no artifacts attached. */
  message?: { parts: A2ATaskMessagePart[] };
}
