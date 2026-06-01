/**
 * FollowupChips — conversation-builder version of the chat suggestion chips.
 *
 * Two kinds of chips:
 *   - Fire-and-forget — clicking sends `chip.prompt` directly to the composer.
 *   - Conversation builder — clicking expands an inline mini-form that asks
 *     one or more questions (single / multi / free text). On submit the
 *     answers are merged into the chip's `prompt` template via {{slot}}
 *     substitution and `{{#slot}}…{{/slot}}` blocks for optional fragments.
 *
 * Pattern inspired by the AppGen agent's ClarificationCard but lighter — each
 * chip owns its own form, so the user expands only the one they care about.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Check, Send, X, Plus } from 'lucide-react';
import { emitChip } from '../../../utils/uiBlocks';

// ─── Types (must match backend) ─────────────────────────────────────────────

export type FollowupQuestionMode = 'single' | 'multi' | 'free';

export interface FollowupQuestionOption {
  key: string;
  label: string;
  description?: string;
}

export interface FollowupQuestion {
  id: string;
  text: string;
  mode: FollowupQuestionMode;
  options?: FollowupQuestionOption[];
  allowFreeText?: boolean;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface FollowupChip {
  label: string;
  description?: string;
  prompt: string;
  needs?: FollowupQuestion[];
  intent?: string;
}

// ─── Template substitution ──────────────────────────────────────────────────

/**
 * Render `prompt` with slot values. Supports:
 *   - `{{slot}}` — literal substitution
 *   - `{{#slot}}…{{/slot}}` — conditional block; the inner text is only kept
 *     when `slot` has a non-empty value (and its own {{slot}} expands inside).
 *
 * Multi-select answers are joined with `, ` for display.
 */
function renderPrompt(template: string, answers: Record<string, string | string[]>): string {
  const get = (key: string): string => {
    const v = answers[key];
    if (Array.isArray(v)) return v.filter(Boolean).join(', ');
    return v ? String(v) : '';
  };

  // Conditional blocks first
  let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, slot, body) => {
    return get(slot) ? body : '';
  });
  // Literal slots
  out = out.replace(/\{\{(\w+)\}\}/g, (_, slot) => get(slot));
  // Tidy double spaces / trailing punctuation produced by empty blocks
  return out.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

// ─── Inline form ────────────────────────────────────────────────────────────

function FollowupForm({
  chip,
  onCancel,
  onSubmit,
}: {
  chip: FollowupChip;
  onCancel: () => void;
  onSubmit: (constructedPrompt: string) => void;
}) {
  const questions = chip.needs ?? [];

  // answers: question.id -> string | string[] | { freeText: string }
  const [singles, setSingles] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of questions) {
      if (q.mode === 'single' && q.defaultValue) init[q.id] = q.defaultValue;
      if (q.mode === 'free' && q.defaultValue) init[q.id] = q.defaultValue;
    }
    return init;
  });
  const [multis, setMultis] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of questions) if (q.mode === 'multi') init[q.id] = [];
    return init;
  });
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const toggleMulti = (qid: string, key: string) => {
    setMultis((prev) => {
      const cur = prev[qid] ?? [];
      return {
        ...prev,
        [qid]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
      };
    });
  };

  const isAnswered = (q: FollowupQuestion): boolean => {
    const required = q.required ?? (q.mode !== 'multi');
    if (!required) return true;
    if (q.mode === 'single') {
      return !!(singles[q.id] || (q.allowFreeText && freeText[q.id]?.trim()));
    }
    if (q.mode === 'free') {
      return !!(singles[q.id] || freeText[q.id]?.trim());
    }
    // multi
    return (multis[q.id]?.length ?? 0) > 0 || !!(q.allowFreeText && freeText[q.id]?.trim());
  };

  const allAnswered = questions.every(isAnswered);

  const handleSubmit = () => {
    if (!allAnswered) return;
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const free = (freeText[q.id] ?? '').trim();
      if (q.mode === 'single') {
        // Free text overrides a chosen option only if user explicitly typed something
        answers[q.id] = free || singles[q.id] || '';
      } else if (q.mode === 'free') {
        answers[q.id] = free || singles[q.id] || '';
      } else {
        // multi
        const picks = multis[q.id] ?? [];
        const combined = free ? [...picks, free] : picks;
        answers[q.id] = combined;
      }
    }
    onSubmit(renderPrompt(chip.prompt, answers));
  };

  return (
    <div className="mt-2 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 dark:border-indigo-400/30 dark:bg-indigo-400/5">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-700 dark:text-indigo-300">
            {chip.label}
          </p>
          {chip.description ? (
            <p className="text-[11.5px] text-text-secondary">{chip.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-text-muted hover:bg-cream-surface hover:text-text-primary dark:hover:bg-pulse-surface-light"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.id}>
            <p className="mb-1 text-[12px] font-medium text-text-primary">
              {q.text}
              {q.mode === 'multi' ? (
                <span className="ml-1.5 text-[10px] font-normal text-text-muted">multi-select</span>
              ) : null}
            </p>

            {/* Option pills */}
            {(q.options?.length ?? 0) > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {q.options!.map((opt) => {
                  const selected =
                    q.mode === 'multi'
                      ? multis[q.id]?.includes(opt.key)
                      : singles[q.id] === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        if (q.mode === 'multi') toggleMulti(q.id, opt.key);
                        else setSingles((p) => ({ ...p, [q.id]: opt.key }));
                      }}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-400/20 dark:text-indigo-200'
                          : 'border-border bg-cream-surface text-text-secondary hover:border-indigo-500/50 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface'
                      }`}
                      title={opt.description}
                    >
                      {selected ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Free-text input (always shown for `free` mode; opt-in for single/multi) */}
            {(q.mode === 'free' || q.allowFreeText) ? (
              <div className="mt-1.5">
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-cream-surface px-2 py-1.5 focus-within:border-indigo-500 dark:border-pulse-border dark:bg-pulse-surface dark:focus-within:border-indigo-400">
                  {q.mode !== 'free' && q.allowFreeText ? (
                    <Plus className="h-3 w-3 shrink-0 text-text-muted" strokeWidth={2} />
                  ) : null}
                  <input
                    type="text"
                    value={freeText[q.id] ?? ''}
                    onChange={(e) => setFreeText((p) => ({ ...p, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && allAnswered) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder={
                      q.mode === 'free'
                        ? q.placeholder
                        : `Custom ${q.id === 'kpiName' ? 'KPI' : 'value'}…`
                    }
                    className="flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-[11.5px] font-medium text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3 w-3" strokeWidth={2.4} />
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Wrapper ─────────────────────────────────────────────────────────────────

export default function FollowupChips({
  chips,
  prompt,
}: {
  chips: FollowupChip[];
  prompt?: string;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // De-duplicate by intent / label as a safety net
  const safeChips = useMemo(() => {
    const seen = new Set<string>();
    const out: FollowupChip[] = [];
    for (const c of chips) {
      const key = c.intent ?? c.label;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }, [chips]);

  const handleChipClick = (chip: FollowupChip, idx: number) => {
    if (chip.needs && chip.needs.length > 0) {
      setOpenIdx(openIdx === idx ? null : idx);
      return;
    }
    // Fire-and-forget: just send the literal prompt (template with no slots).
    emitChip(chip.prompt);
  };

  return (
    <div className="space-y-2">
      {prompt ? (
        <div className="text-[12px] text-text-secondary dark:text-slate-300">{prompt}</div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {safeChips.map((c, idx) => {
          const isOpen = openIdx === idx;
          const hasForm = !!(c.needs && c.needs.length > 0);
          return (
            <button
              key={`${c.intent ?? c.label}-${idx}`}
              type="button"
              onClick={() => handleChipClick(c, idx)}
              className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                isOpen
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-400/15 dark:text-indigo-200'
                  : 'border-border bg-cream-surface text-text-secondary hover:border-indigo-500/50 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface dark:text-slate-100'
              }`}
              title={c.description ?? c.prompt}
            >
              <span>{c.label}</span>
              {hasForm ? (
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  strokeWidth={2.4}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {openIdx != null && safeChips[openIdx]?.needs ? (
        <FollowupForm
          chip={safeChips[openIdx]}
          onCancel={() => setOpenIdx(null)}
          onSubmit={(constructed) => {
            setOpenIdx(null);
            emitChip(constructed);
          }}
        />
      ) : null}
    </div>
  );
}
