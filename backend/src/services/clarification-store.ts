/**
 * In-memory clarification store.
 *
 * When the agent calls `ask_clarification`, the tool:
 *   1. Emits a `clarification` SSE event with a UUID
 *   2. Calls registerClarification(id, question) which returns a Promise
 *   3. The Promise suspends the tool execution until the user answers
 *
 * The frontend's ClarificationCard renders the question, the user picks an
 * answer, and the card POSTs to /api/agent/v3/clarify which calls
 * answerClarification(id, answer) — this resolves the suspended Promise,
 * unblocking the orchestrator so it can continue.
 *
 * Timeouts: 5 minutes. After that the Promise is rejected (the orchestrator
 * treats the tool as failed and surfaces an error message).
 */

const CLARIFICATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PendingClarification {
  question: string;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const store = new Map<string, PendingClarification>();

/**
 * Register a new pending clarification. Returns a Promise that resolves
 * when the user answers (via answerClarification) or rejects on timeout.
 */
export function registerClarification(id: string, question: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (store.has(id)) {
        store.delete(id);
        reject(new Error(`Clarification "${id}" timed out after 5 minutes`));
      }
    }, CLARIFICATION_TIMEOUT_MS);

    store.set(id, { question, resolve, reject, timer });
  });
}

/**
 * Resolve a pending clarification with the user's answer.
 * Returns true if a pending clarification was found and resolved.
 */
export function answerClarification(id: string, answer: string): boolean {
  const pending = store.get(id);
  if (!pending) return false;
  clearTimeout(pending.timer);
  store.delete(id);
  pending.resolve(answer);
  return true;
}

/** For diagnostics: how many clarifications are currently pending. */
export function pendingCount(): number {
  return store.size;
}
