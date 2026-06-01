/**
 * DocsChatPanel — Right-side panel that lets the user ask questions of the
 * documentation. Calls POST /api/docs/chat and renders the grounded answer
 * along with clickable citations that jump to the cited section.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, X, Loader2, MessageSquare } from 'lucide-react';
import api from '../../services/api';

interface Citation {
  pageId: string;
  pageTitle: string;
  sectionId: string;
  sectionTitle: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

interface DocsChatPanelProps {
  open: boolean;
  onClose: () => void;
  onCitationClick: (pageId: string, sectionId: string) => void;
}

const STARTERS = [
  'What can Naavik AppGen do?',
  'How does the agent prevent hallucinated KPIs?',
  'Explain the local mirror strategy.',
  'How do I run a deep site investigation?',
  'What is the query cost gate?',
];

export default function DocsChatPanel({ open, onClose, onCitationClick }: DocsChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text?: string) => {
    const question = (text ?? draft).trim();
    if (!question || loading) return;

    const userMsg: Message = { role: 'user', content: question };
    setMessages((m) => [...m, userMsg]);
    setDraft('');
    setLoading(true);

    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const resp = await api.post<{
        success: boolean;
        data: { answer: string; citations: Citation[] };
      }>('/docs/chat', { question, history });
      const answer = resp?.data?.answer ?? 'No answer returned.';
      const citations = resp?.data?.citations ?? [];
      setMessages((m) => [...m, { role: 'assistant', content: answer, citations }]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'The docs assistant could not respond. ' +
            (err?.message ? `(${err.message})` : 'Please try again.'),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-cream-bg dark:border-pulse-border dark:bg-pulse-surface">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 dark:border-pulse-border">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-500/12 text-indigo-600 dark:bg-indigo-400/12 dark:text-indigo-300">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-text-primary">Ask the docs</p>
          <p className="truncate text-[11px] text-text-muted">
            Grounded in the documentation corpus.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-muted transition-colors hover:bg-cream-surface hover:text-text-primary dark:hover:bg-pulse-surface-light dark:hover:text-text-primary"
          aria-label="Close docs assistant"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
        {!messages.length ? (
          <div className="mt-4">
            <div className="mb-4 flex items-start gap-3">
              <MessageSquare
                className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400"
                strokeWidth={1.75}
              />
              <p className="text-[13px] leading-6 text-text-secondary">
                Ask anything about Naavik features, modules, or settings. Answers come from the
                documentation only — every claim links back to a section.
              </p>
            </div>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              Try one of these
            </p>
            <div className="space-y-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="block w-full rounded-md border border-border bg-cream-surface px-3 py-2 text-left text-[12.5px] text-text-secondary transition-all hover:border-indigo-500 hover:bg-indigo-500/5 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-bg dark:hover:border-indigo-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-4">
            {messages.map((m, i) => (
              <li key={i}>
                {m.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-500/12 px-3 py-2 text-[13px] leading-6 text-text-primary dark:bg-indigo-400/15">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <Sparkles
                      className="mt-1 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-[13px] leading-6 text-text-primary">
                        {renderAnswerWithCites(m.content, m.citations ?? [], onCitationClick)}
                      </p>
                      {m.citations?.length ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                            Sources
                          </p>
                          <ul className="flex flex-wrap gap-1.5">
                            {m.citations.map((c, j) => (
                              <li key={`${c.pageId}/${c.sectionId}/${j}`}>
                                <button
                                  type="button"
                                  onClick={() => onCitationClick(c.pageId, c.sectionId)}
                                  className="flex items-center gap-1 rounded-md border border-border bg-cream-surface px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-bg dark:hover:border-indigo-400"
                                  title={c.pageTitle}
                                >
                                  <span className="font-mono text-[10px] text-text-muted">
                                    [{j + 1}]
                                  </span>
                                  <span className="truncate max-w-[14ch]">{c.sectionTitle}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {loading ? (
              <li className="flex items-center gap-2 text-[12px] text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                Searching the documentation…
              </li>
            ) : null}
          </ol>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border px-3 py-3 dark:border-pulse-border">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-cream-surface px-2.5 py-1.5 focus-within:border-indigo-500 dark:border-pulse-border dark:bg-pulse-bg dark:focus-within:border-indigo-400">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask about any feature or module…"
            disabled={loading}
            className="flex-1 resize-none bg-transparent py-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={loading || !draft.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-500 text-white transition-all hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-400 dark:hover:bg-indigo-500"
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-text-muted">
          Answers are grounded in the documentation. Press Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </aside>
  );
}

/** Render answer text with bracketed citations like [1] rendered as a small clickable pill. */
function renderAnswerWithCites(
  text: string,
  citations: Citation[],
  onCitationClick: (pageId: string, sectionId: string) => void,
) {
  const parts: Array<string | { n: number }> = [];
  let lastIndex = 0;
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push({ n: Number(m[1]) });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <span key={i}>{p}</span>;
        const c = citations[p.n - 1];
        if (!c) return <span key={i}>[{p.n}]</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCitationClick(c.pageId, c.sectionId)}
            className="mx-0.5 inline-flex h-[18px] items-center rounded bg-indigo-500/15 px-1.5 align-baseline text-[10.5px] font-mono text-indigo-700 transition-colors hover:bg-indigo-500/25 dark:bg-indigo-400/20 dark:text-indigo-200 dark:hover:bg-indigo-400/30"
            title={`${c.pageTitle} → ${c.sectionTitle}`}
          >
            {p.n}
          </button>
        );
      })}
    </>
  );
}
