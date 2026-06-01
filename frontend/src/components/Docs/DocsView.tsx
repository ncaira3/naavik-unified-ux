/**
 * DocsView — three-pane documentation reader.
 *
 *   ┌────────────┬──────────────────────────────────┬──────────────┐
 *   │  Section   │           Page content            │  On this page │
 *   │  nav       │           (Markdown-style prose)  │  anchors      │
 *   └────────────┴──────────────────────────────────┴──────────────┘
 *
 * - Left pane lists every page grouped by `DOC_GROUPS`.
 * - Center pane renders the active page's sections vertically.
 * - Right pane mirrors the section headings of the active page.
 *
 * Section anchors are scroll-tracked via IntersectionObserver. URL hash is
 * updated on click so individual sections are shareable.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, BookOpen, ChevronRight, Sparkles, Command } from 'lucide-react';
import { DOC_GROUPS, DOC_PAGES, type DocPage } from './docsContent';
import DocsSearchModal from './DocsSearchModal';
import DocsChatPanel from './DocsChatPanel';

export default function DocsView() {
  const [activePageId, setActivePageId] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const [page] = window.location.hash.replace('#', '').split('/');
      if (DOC_PAGES.some((p) => p.id === page)) return page;
    }
    return DOC_PAGES[0].id;
  });
  const [query, setQuery] = useState('');
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Cmd+K / Ctrl+K opens global search anywhere inside the docs view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setChatOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activePage: DocPage = useMemo(
    () => DOC_PAGES.find((p) => p.id === activePageId) ?? DOC_PAGES[0],
    [activePageId],
  );

  // Filter pages by search query
  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOC_PAGES;
    return DOC_PAGES.filter((p) => {
      if (p.title.toLowerCase().includes(q)) return true;
      if (p.summary.toLowerCase().includes(q)) return true;
      return p.sections.some(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (typeof s.body === 'string' && s.body.toLowerCase().includes(q)),
      );
    });
  }, [query]);

  const pagesByGroup = useMemo(() => {
    const map: Record<string, DocPage[]> = {};
    for (const g of DOC_GROUPS) map[g.id] = [];
    for (const p of filteredPages) {
      if (!map[p.group]) map[p.group] = [];
      map[p.group].push(p);
    }
    return map;
  }, [filteredPages]);

  // Scroll content to top + clear hash when page changes
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    const hash = window.location.hash.replace('#', '');
    if (!hash || !hash.startsWith(activePageId + '/')) {
      // Defer to next tick so the new sections exist
      setActiveAnchor(activePage.sections[0]?.id ?? null);
    } else {
      const target = hash.split('/')[1];
      setActiveAnchor(target ?? activePage.sections[0]?.id ?? null);
      // Scroll to the target after the DOM updates
      requestAnimationFrame(() => {
        const el = document.getElementById(`section-${target}`);
        if (el) {
          contentScrollRef.current?.scrollTo({
            top: el.offsetTop - 24,
            behavior: 'auto',
          });
        }
      });
    }
  }, [activePageId, activePage]);

  // Track which section is most visible
  useEffect(() => {
    const root = contentScrollRef.current;
    if (!root) return;
    const observers: IntersectionObserver[] = [];
    const sectionEls = activePage.sections
      .map((s) => document.getElementById(`section-${s.id}`))
      .filter(Boolean) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the section whose top is closest to (but above) the viewport's top
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length) {
          const id = (visible[0].target as HTMLElement).id.replace('section-', '');
          setActiveAnchor(id);
        }
      },
      {
        root,
        // Trigger when section top crosses the upper third of the viewport
        rootMargin: '-10% 0px -70% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const el of sectionEls) observer.observe(el);
    observers.push(observer);

    return () => {
      for (const o of observers) o.disconnect();
    };
  }, [activePage]);

  const handleAnchorClick = (sectionId: string) => {
    setActiveAnchor(sectionId);
    const el = document.getElementById(`section-${sectionId}`);
    if (el && contentScrollRef.current) {
      contentScrollRef.current.scrollTo({
        top: el.offsetTop - 24,
        behavior: 'smooth',
      });
    }
    window.history.replaceState(null, '', `#${activePageId}/${sectionId}`);
  };

  const handlePageChange = (pageId: string) => {
    setActivePageId(pageId);
    window.history.replaceState(null, '', `#${pageId}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-ghost-bg text-text-primary dark:bg-pulse-bg dark:text-text-primary">
      {/* Top header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-cream-bg/80 px-6 py-3 backdrop-blur-sm dark:border-pulse-border dark:bg-pulse-surface/80">
        <BookOpen className="h-5 w-5 text-indigo-500 dark:text-indigo-400" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight text-text-primary">
            Naavik Documentation
          </h1>
          <p className="text-[11.5px] text-text-muted">
            Platform reference, module guides, and architecture notes.
          </p>
        </div>

        {/* Global search trigger */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-cream-surface px-2.5 py-1.5 text-[12.5px] text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-bg dark:hover:border-indigo-400 sm:flex"
          title="Search documentation (⌘K)"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Search docs</span>
          <span className="ml-2 hidden items-center gap-0.5 rounded border border-border bg-cream-bg px-1 py-0.5 font-mono text-[10px] dark:border-pulse-border dark:bg-pulse-surface md:inline-flex">
            <Command className="h-2.5 w-2.5" strokeWidth={2.5} />
            <span>K</span>
          </span>
        </button>

        {/* Ask the docs toggle */}
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors ${
            chatOpen
              ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:border-indigo-400 dark:text-indigo-200'
              : 'border-border bg-cream-surface text-text-secondary hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-bg dark:hover:border-indigo-400'
          }`}
          title="Ask the docs assistant (⌘/)"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Ask the docs</span>
        </button>
      </header>

      {/* Three-pane body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left nav */}
        <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-cream-bg dark:border-pulse-border dark:bg-pulse-surface md:flex">
          {/* Search */}
          <div className="border-b border-border p-3 dark:border-pulse-border">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
                strokeWidth={2}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documentation"
                className="w-full rounded-md border border-border bg-cream-surface px-8 py-1.5 text-[12.5px] text-text-primary placeholder:text-text-muted focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-pulse-border dark:bg-pulse-bg dark:text-text-primary dark:focus:border-indigo-400"
              />
            </div>
          </div>

          {/* Nav list */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
            {DOC_GROUPS.map((group) => {
              const pages = pagesByGroup[group.id] ?? [];
              if (!pages.length) return null;
              return (
                <div key={group.id} className="mb-4 last:mb-0">
                  <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-muted dark:text-text-muted">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {pages.map((p) => {
                      const isActive = p.id === activePageId;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => handlePageChange(p.id)}
                            className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                              isActive
                                ? 'bg-indigo-500/10 font-medium text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300'
                                : 'text-text-secondary hover:bg-cream-surface hover:text-text-primary dark:hover:bg-pulse-surface-light dark:hover:text-text-primary'
                            }`}
                          >
                            <span className="flex-1 truncate">{p.title}</span>
                            {isActive ? (
                              <ChevronRight
                                className="ml-1 h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400"
                                strokeWidth={2}
                              />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            {!filteredPages.length ? (
              <p className="px-2.5 py-4 text-[12px] text-text-muted">
                No results for &ldquo;{query}&rdquo;.
              </p>
            ) : null}
          </nav>
        </aside>

        {/* Center content */}
        <main
          ref={contentScrollRef}
          className="relative min-w-0 flex-1 overflow-y-auto scrollbar-thin"
        >
          <article className="mx-auto max-w-[760px] px-8 py-10 lg:px-12">
            {/* Breadcrumb + heading */}
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              {DOC_GROUPS.find((g) => g.id === activePage.group)?.label}
            </p>
            <h1 className="mb-2 text-[28px] font-semibold tracking-tight text-text-primary dark:text-text-primary">
              {activePage.title}
            </h1>
            <p className="mb-8 text-[15px] leading-7 text-text-secondary dark:text-text-secondary">
              {activePage.summary}
            </p>
            <div className="mb-10 h-px w-full bg-border dark:bg-pulse-border" />

            {activePage.sections.map((section) => (
              <section
                key={section.id}
                id={`section-${section.id}`}
                className="mb-12 scroll-mt-6"
              >
                <h2 className="group mb-4 flex items-baseline gap-2 text-[20px] font-semibold tracking-tight text-text-primary dark:text-text-primary">
                  <span>{section.title}</span>
                  <a
                    href={`#${activePageId}/${section.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      handleAnchorClick(section.id);
                    }}
                    className="text-[14px] font-normal text-text-muted opacity-0 transition-opacity hover:text-indigo-500 group-hover:opacity-100"
                    aria-label="Section link"
                  >
                    #
                  </a>
                </h2>
                <div className="docs-prose">{section.body}</div>
              </section>
            ))}

            {/* Footer nav between pages */}
            <PageFooter activePageId={activePageId} onChange={handlePageChange} />
          </article>
        </main>

        {/* Right rail — swaps between On-This-Page anchors and the docs chat panel */}
        {chatOpen ? (
          <div className="hidden w-[360px] shrink-0 xl:flex">
            <DocsChatPanel
              open
              onClose={() => setChatOpen(false)}
              onCitationClick={(pageId, sectionId) => {
                if (pageId !== activePageId) handlePageChange(pageId);
                // Defer until the new page's sections mount
                requestAnimationFrame(() => {
                  const el = document.getElementById(`section-${sectionId}`);
                  if (el && contentScrollRef.current) {
                    contentScrollRef.current.scrollTo({
                      top: el.offsetTop - 24,
                      behavior: 'smooth',
                    });
                    setActiveAnchor(sectionId);
                    window.history.replaceState(null, '', `#${pageId}/${sectionId}`);
                  }
                });
              }}
            />
          </div>
        ) : (
          <aside className="hidden w-[220px] shrink-0 border-l border-border bg-cream-bg px-4 py-10 dark:border-pulse-border dark:bg-pulse-surface xl:block">
            <div className="sticky top-10">
              <p className="mb-3 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                On this page
              </p>
              <ul className="space-y-1.5 border-l border-border dark:border-pulse-border">
                {activePage.sections.map((section) => {
                  const isActive = section.id === activeAnchor;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => handleAnchorClick(section.id)}
                        className={`-ml-px block w-full border-l-2 pl-3 pr-2 py-0.5 text-left text-[12.5px] leading-5 transition-colors ${
                          isActive
                            ? 'border-indigo-500 font-medium text-indigo-600 dark:border-indigo-400 dark:text-indigo-300'
                            : 'border-transparent text-text-muted hover:text-text-primary dark:hover:text-text-primary'
                        }`}
                      >
                        {section.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        )}
      </div>

      {/* Cmd+K global search */}
      <DocsSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(pageId, sectionId) => {
          if (pageId !== activePageId) handlePageChange(pageId);
          requestAnimationFrame(() => {
            const el = document.getElementById(`section-${sectionId}`);
            if (el && contentScrollRef.current) {
              contentScrollRef.current.scrollTo({
                top: el.offsetTop - 24,
                behavior: 'smooth',
              });
              setActiveAnchor(sectionId);
              window.history.replaceState(null, '', `#${pageId}/${sectionId}`);
            }
          });
        }}
      />
    </div>
  );
}

// ─── Footer prev/next ─────────────────────────────────────────────────────

function PageFooter({
  activePageId,
  onChange,
}: {
  activePageId: string;
  onChange: (id: string) => void;
}) {
  const idx = DOC_PAGES.findIndex((p) => p.id === activePageId);
  const prev = idx > 0 ? DOC_PAGES[idx - 1] : null;
  const next = idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : null;

  if (!prev && !next) return null;

  return (
    <div className="mt-12 grid grid-cols-2 gap-3 border-t border-border pt-6 dark:border-pulse-border">
      {prev ? (
        <button
          type="button"
          onClick={() => onChange(prev.id)}
          className="flex flex-col rounded-lg border border-border bg-cream-surface px-4 py-3 text-left transition-colors hover:border-indigo-500 hover:bg-indigo-500/5 dark:border-pulse-border dark:bg-pulse-surface dark:hover:border-indigo-400"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Previous
          </span>
          <span className="mt-1 text-[14px] font-medium text-text-primary">{prev.title}</span>
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => onChange(next.id)}
          className="flex flex-col items-end rounded-lg border border-border bg-cream-surface px-4 py-3 text-right transition-colors hover:border-indigo-500 hover:bg-indigo-500/5 dark:border-pulse-border dark:bg-pulse-surface dark:hover:border-indigo-400"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Next
          </span>
          <span className="mt-1 text-[14px] font-medium text-text-primary">{next.title}</span>
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
