/**
 * DocsSearchModal — Cmd+K full-text search over the documentation corpus.
 *
 * Calls POST /api/docs/search and renders ranked sections with highlighted
 * snippets. Selecting a result navigates to that section.
 */
import { useEffect, useRef, useState } from 'react';
import { Search, ArrowRight, X, Loader2 } from 'lucide-react';
import api from '../../services/api';

export interface DocsSearchHit {
  pageId: string;
  pageTitle: string;
  group: string;
  sectionId: string;
  sectionTitle: string;
  score: number;
  snippet: string;
}

interface DocsSearchModalProps {
  open: boolean;
  onClose: () => void;
  onPick: (pageId: string, sectionId: string) => void;
}

export default function DocsSearchModal({ open, onClose, onPick }: DocsSearchModalProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<DocsSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  // Focus input on open + reset state on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery('');
      setHits([]);
      setActiveIdx(0);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const resp = await api.post<{ success: boolean; data: { results: DocsSearchHit[] } }>(
          '/docs/search',
          { query: q, limit: 8 },
        );
        if (id !== requestId.current) return; // stale
        setHits(resp?.data?.results ?? []);
        setActiveIdx(0);
      } catch {
        if (id === requestId.current) setHits([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && hits[activeIdx]) {
        e.preventDefault();
        const h = hits[activeIdx];
        onPick(h.pageId, h.sectionId);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hits, activeIdx, onPick, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] overflow-hidden rounded-xl border border-border bg-cream-bg shadow-2xl dark:border-pulse-border dark:bg-pulse-surface"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 dark:border-pulse-border">
          <Search className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={2} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the documentation…"
            className="flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" strokeWidth={2} />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-cream-surface hover:text-text-primary dark:hover:bg-pulse-surface-light dark:hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[55vh] overflow-y-auto scrollbar-thin">
          {!query.trim() ? (
            <p className="px-4 py-8 text-center text-[13px] text-text-muted">
              Type to search every section of the documentation. Use ↑ ↓ to navigate, ↵ to open.
            </p>
          ) : !loading && !hits.length ? (
            <p className="px-4 py-8 text-center text-[13px] text-text-muted">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={`${h.pageId}/${h.sectionId}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => {
                      onPick(h.pageId, h.sectionId);
                      onClose();
                    }}
                    className={`flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 dark:border-pulse-border/60 ${
                      i === activeIdx
                        ? 'bg-indigo-500/8 dark:bg-indigo-400/10'
                        : 'hover:bg-cream-surface dark:hover:bg-pulse-surface-light'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                          {h.group} · {h.pageTitle}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[14px] font-medium text-text-primary">
                        <HighlightedText text={h.sectionTitle} query={query} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-text-secondary">
                        <HighlightedText text={h.snippet} query={query} />
                      </p>
                    </div>
                    <ArrowRight
                      className={`mt-1 h-4 w-4 shrink-0 transition-colors ${
                        i === activeIdx
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'text-text-muted'
                      }`}
                      strokeWidth={2}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-cream-surface px-4 py-2 text-[11px] text-text-muted dark:border-pulse-border dark:bg-pulse-bg">
          <div className="flex items-center gap-3">
            <KbdHint k="↑↓" label="navigate" />
            <KbdHint k="↵" label="open" />
            <KbdHint k="esc" label="close" />
          </div>
          <span>{hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : ' '}</span>
        </div>
      </div>
    </div>
  );
}

function KbdHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-border bg-cream-bg px-1.5 py-0.5 font-mono text-[10px] text-text-primary dark:border-pulse-border dark:bg-pulse-surface">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

/** Inline highlighter that bolds substrings of `text` matching any token from `query`. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (!tokens.length) return <>{text}</>;
  // Build a regex that matches any token; preserve original casing in output
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark
            key={i}
            className="rounded bg-indigo-500/20 px-0.5 text-text-primary dark:bg-indigo-400/25 dark:text-text-primary"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
