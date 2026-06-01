/**
 * Shared SSE event type union for the /api/agent/v3/stream endpoint.
 *
 * The frontend useAgentStream hook reads these events and drives the chat UI:
 *   - tool_start / tool_end  → AgentActivityCard items
 *   - token                  → streamed text appended to the message bubble
 *   - block                  → uiBlock rendered inline as it arrives
 *   - command                → dispatched to MapDataContext / KPI panel
 *   - clarification          → ClarificationCard shown to the user
 *   - done                   → stream closed, final cleanup
 *   - error                  → display error message, close stream
 */

export type SseEvent =
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_start';
      name: string;
      args: Record<string, unknown>;
      callId: string;
    }
  | {
      type: 'tool_end';
      callId: string;
      summary: string;
      hasUiBlock: boolean;
    }
  | { type: 'token'; delta: string }
  | { type: 'block'; block: Record<string, unknown> }
  | { type: 'command'; command: Record<string, unknown> }
  | {
      type: 'clarification';
      id: string;
      question: string;
      options?: string[];
      kind: 'radio' | 'checkbox' | 'text' | 'skip';
    }
  | { type: 'done'; fullText: string; trace: unknown[] }
  | { type: 'error'; message: string }
  /** Periodic heartbeat visible to the frontend — keeps stall detection at bay
   *  and lets the UI show elapsed time during slow multi-step analyses. */
  | { type: 'progress'; elapsedMs: number; message: string };
