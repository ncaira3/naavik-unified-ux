/**
 * ClarificationCard — renders an inline Q&A prompt when the agent calls the
 * `ask_clarification` tool.
 *
 * Visual style follows the rest of the chat (indigo accents, dark/light mode
 * aware via Tailwind). Four kinds:
 *
 *   - radio    → 2–6 option chips, pick one
 *   - checkbox → 2–6 option chips, pick multiple
 *   - text     → free-text textarea
 *   - skip     → only a "Skip / not sure" button
 */
import { useState } from 'react';
import { HelpCircle, Check, X } from 'lucide-react';
import type { ClarificationState } from '../../hooks/useAgentStream';

interface Props {
  clarification: ClarificationState;
  onAnswer: (id: string, answer: string) => void | Promise<void>;
}

export default function ClarificationCard({ clarification, onAnswer }: Props) {
  const { id, question, options = [], kind } = clarification;
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (answer: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(id, answer);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => handleSubmit('(skipped — proceed with best guess)');

  return (
    <div className="my-3 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm dark:border-indigo-700/50 dark:from-indigo-950/40 dark:to-slate-900/60">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-300">
          <HelpCircle className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
            Quick question
          </div>
          <div className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
            {question}
          </div>

          {/* Radio: single-select chips */}
          {kind === 'radio' && options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSubmit(opt)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/50 dark:hover:text-indigo-200"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {/* Checkbox: multi-select with submit button */}
          {kind === 'checkbox' && options.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {options.map((opt) => {
                const checked = selected.includes(opt);
                return (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-indigo-900/30"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, opt] : prev.filter((x) => x !== opt),
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {opt}
                  </label>
                );
              })}
              <button
                type="button"
                disabled={submitting || selected.length === 0}
                onClick={() => handleSubmit(selected.join(', '))}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Submit
              </button>
            </div>
          )}

          {/* Text: free-text input */}
          {kind === 'text' && (
            <div className="mt-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={submitting}
                rows={2}
                placeholder="Type your answer…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
              />
              <button
                type="button"
                disabled={submitting || !text.trim()}
                onClick={() => handleSubmit(text.trim())}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Send answer
              </button>
            </div>
          )}

          {/* Skip-only or skip button on every kind */}
          <div className="mt-3 flex">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSkip}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <X className="h-3 w-3" />
              Skip — use best guess
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
