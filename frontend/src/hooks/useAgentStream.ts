/**
 * useAgentStream — SSE consumer for the /api/agent/v3/stream endpoint.
 *
 * Connects to the backend's Server-Sent Events stream and dispatches incoming
 * events into local state slices the chat UI can render:
 *
 *   - tokens         → final assistant text (appended as it streams)
 *   - activityItems  → tool calls with start/done status (AgentActivityCard)
 *   - uiBlocks       → rendered inline as data tables / charts arrive
 *   - uiCommands     → forwarded to the caller for map/KPI dispatch
 *   - clarification  → ClarificationCard render trigger
 *   - done           → stream complete
 *   - error          → display error, close stream
 *
 * Also handles:
 *   - stall detection (30 s without an event → mark as stalled)
 *   - cancellation via AbortController
 *   - clarification answer flow (POST /v3/clarify)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SseEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown>; callId: string }
  | { type: 'tool_end'; callId: string; summary: string; hasUiBlock: boolean }
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
  | { type: 'progress'; elapsedMs: number; message: string };

export interface ActivityItem {
  callId: string;
  name: string;
  argsSummary: string;
  status: 'pending' | 'done' | 'error';
  summary?: string;
  /** Unix ms when this tool call started — used for elapsed-time display. */
  startedAt: number;
  /** Unix ms when this tool call finished — set on tool_end. */
  endedAt?: number;
}

export interface ClarificationState {
  id: string;
  question: string;
  options?: string[];
  kind: 'radio' | 'checkbox' | 'text' | 'skip';
}

export interface AgentStreamPayload {
  threadId?: string;
  message: string;
  currentView?: string;
}

/** Final accumulated values returned by start() — safe to read after await. */
export interface AgentStreamFinalResult {
  tokens: string;
  uiBlocks: Record<string, unknown>[];
  uiCommands: Record<string, unknown>[];
  error: string | null;
}

export interface UseAgentStreamResult {
  tokens: string;
  activityItems: ActivityItem[];
  uiBlocks: Record<string, unknown>[];
  uiCommands: Record<string, unknown>[];
  clarification: ClarificationState | null;
  done: boolean;
  stalled: boolean;
  /** Latest progress message from the backend heartbeat — shown while streaming. */
  progressMessage: string | null;
  error: string | null;
  isStreaming: boolean;
  /** Resolves with the accumulated final values — always up-to-date regardless of React closure. */
  start: (payload: AgentStreamPayload) => Promise<AgentStreamFinalResult>;
  cancel: () => void;
  answerClarification: (id: string, answer: string) => Promise<void>;
  reset: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

// 120 s without ANY event (including progress heartbeats) before showing stall.
// RCA and deep-analysis flows can take 1–2 minutes; the backend sends a progress
// event every 20 s which resets this clock.
const STALL_THRESHOLD_MS = 120_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 3);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const val =
        typeof v === 'string'
          ? v.length > 30
            ? v.slice(0, 28) + '…'
            : v
          : Array.isArray(v)
          ? `[${v.length}]`
          : typeof v === 'object'
          ? '{…}'
          : String(v);
      return `${k}=${val}`;
    })
    .join(', ');
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAgentStream(): UseAgentStreamResult {
  const [tokens, setTokens] = useState('');
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [uiBlocks, setUiBlocks] = useState<Record<string, unknown>[]>([]);
  const [uiCommands, setUiCommands] = useState<Record<string, unknown>[]>([]);
  const [clarification, setClarification] = useState<ClarificationState | null>(null);
  const [done, setDone] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastEventAt = useRef<number>(Date.now());
  const stallTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setTokens('');
    setActivityItems([]);
    setUiBlocks([]);
    setUiCommands([]);
    setClarification(null);
    setDone(false);
    setStalled(false);
    setProgressMessage(null);
    setError(null);
    setIsStreaming(false);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (stallTimerRef.current) {
      clearInterval(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setIsStreaming(false);
  }, []);


  const start = useCallback(
    async (payload: AgentStreamPayload): Promise<AgentStreamFinalResult> => {
      reset();
      setIsStreaming(true);

      // ── Local accumulators ─────────────────────────────────────────────────
      // React state updates are batched and asynchronous, so the caller cannot
      // safely read agentStream.tokens / .uiBlocks after `await start()` —
      // the closure would still see the previous render's values.
      // We therefore collect the final values in plain local variables and
      // return them from the Promise so callers always get up-to-date data.
      let accTokens = '';
      let accBlocks: Record<string, unknown>[] = [];
      let accCommands: Record<string, unknown>[] = [];
      let accError: string | null = null;

      const ac = new AbortController();
      abortRef.current = ac;
      lastEventAt.current = Date.now();

      // Stall detection: poll every 5 s, mark stalled if no event for 30 s.
      stallTimerRef.current = setInterval(() => {
        if (Date.now() - lastEventAt.current > STALL_THRESHOLD_MS) {
          setStalled(true);
        }
      }, 5_000);

      const handleEvent = (e: SseEvent) => {
        lastEventAt.current = Date.now();
        setStalled(false);

        switch (e.type) {
          case 'tool_start':
            setActivityItems((prev) => [
              ...prev,
              {
                callId: e.callId,
                name: e.name,
                argsSummary: summarizeArgs(e.args),
                status: 'pending',
                startedAt: Date.now(),
              },
            ]);
            // Clear progress message when a new tool kicks off — looks snappier.
            setProgressMessage(null);
            break;
          case 'tool_end':
            setActivityItems((prev) =>
              prev.map((it) =>
                it.callId === e.callId
                  ? {
                      ...it,
                      status: e.summary.startsWith('error:') ? 'error' : 'done',
                      summary: e.summary,
                      endedAt: Date.now(),
                    }
                  : it,
              ),
            );
            break;
          case 'token':
            accTokens += e.delta;
            setTokens((prev) => prev + e.delta);
            setProgressMessage(null); // answer is streaming — hide progress label
            break;
          case 'block':
            accBlocks = [...accBlocks, e.block];
            setUiBlocks((prev) => [...prev, e.block]);
            break;
          case 'command':
            accCommands = [...accCommands, e.command];
            setUiCommands((prev) => [...prev, e.command]);
            break;
          case 'clarification':
            setClarification({ id: e.id, question: e.question, options: e.options, kind: e.kind });
            break;
          case 'progress':
            // Progress heartbeat — update the message and suppress stall indicator.
            setProgressMessage(e.message);
            setStalled(false);
            break;
          case 'done':
            if (e.fullText && !accTokens) {
              accTokens = e.fullText;
              setTokens(e.fullText);
            }
            setProgressMessage(null);
            setDone(true);
            setIsStreaming(false);
            if (stallTimerRef.current) { clearInterval(stallTimerRef.current); stallTimerRef.current = null; }
            break;
          case 'error':
            accError = e.message;
            setError(e.message);
            setProgressMessage(null);
            setIsStreaming(false);
            if (stallTimerRef.current) { clearInterval(stallTimerRef.current); stallTimerRef.current = null; }
            break;
          case 'thinking':
          default:
            break;
        }
      };

      try {
        const token = localStorage.getItem('naavik_token');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch('/api/agent/v3/stream', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          // Stale/invalid JWT — clear token and reload so the login screen appears.
          if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('naavik_token');
            window.location.href = '/';
            return { tokens: accTokens, uiBlocks: accBlocks, uiCommands: accCommands, error: 'Session expired' };
          }
          const msg = `Stream failed: HTTP ${res.status}`;
          accError = msg;
          setError(msg);
          setIsStreaming(false);
          return { tokens: accTokens, uiBlocks: accBlocks, uiCommands: accCommands, error: accError };
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Read SSE lines. Each event is `data: <json>\n\n`. Comments start
        // with `:` (used for our 15 s heartbeat) and are ignored.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            const dataLines: string[] = [];
            for (const line of rawEvent.split('\n')) {
              if (line.startsWith(':')) continue;
              if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
            }
            if (dataLines.length === 0) continue;
            try {
              handleEvent(JSON.parse(dataLines.join('\n')) as SseEvent);
            } catch (parseErr) {
              // eslint-disable-next-line no-console
              console.warn('[useAgentStream] failed to parse SSE event', parseErr, dataLines);
            }
          }
        }

        // Stream ended without explicit done event — treat as done.
        setIsStreaming(false);
        setDone(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = `Stream error: ${(err as Error).message}`;
          accError = msg;
          setError(msg);
        }
        setIsStreaming(false);
      } finally {
        if (stallTimerRef.current) { clearInterval(stallTimerRef.current); stallTimerRef.current = null; }
        abortRef.current = null;
      }

      return { tokens: accTokens, uiBlocks: accBlocks, uiCommands: accCommands, error: accError };
    },
    [reset],
  );

  const answerClarification = useCallback(
    async (id: string, answer: string) => {
      // Optimistically clear the card so the user sees immediate feedback.
      setClarification(null);
      try {
        const token = localStorage.getItem('naavik_token');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) headers.Authorization = `Bearer ${token}`;
        await fetch('/api/agent/v3/clarify', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id, answer }),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[useAgentStream] clarify POST failed', err);
      }
    },
    [],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (stallTimerRef.current) clearInterval(stallTimerRef.current);
    };
  }, []);

  return {
    tokens,
    activityItems,
    uiBlocks,
    uiCommands,
    clarification,
    done,
    stalled,
    progressMessage,
    error,
    isStreaming,
    start,
    cancel,
    answerClarification,
    reset,
  };
}
