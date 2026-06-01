/**
 * EventListPanel — Right-docked panel that lists local events around the
 * selected site. Hover a row to emphasise the corresponding map marker.
 */
import { useState } from 'react';
import { CalendarClock, MapPin, ExternalLink, Loader2, X, AlertTriangle } from 'lucide-react';
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  formatEventTime,
  type LocalEvent,
} from '../../services/localEvents';

interface Props {
  open: boolean;
  loading: boolean;
  events: LocalEvent[];
  siteLabel: string;
  radiusMiles: number;
  hoveredEventId: string | null;
  selectedEventId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (event: LocalEvent) => void;
  onClose: () => void;
  onRadiusChange: (radius: number) => void;
}

const CATEGORIES = [
  'concert',
  'sports',
  'festival',
  'school',
  'conference',
  'severe-weather',
  'news',
  'public-holiday',
] as const;

export default function EventListPanel({
  open,
  loading,
  events,
  siteLabel,
  radiusMiles,
  hoveredEventId,
  selectedEventId,
  onHover,
  onSelect,
  onClose,
  onRadiusChange,
}: Props) {
  const [enabledCats, setEnabledCats] = useState<Set<string>>(new Set(CATEGORIES));

  const filtered = events.filter((e) => enabledCats.has(e.category));
  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});

  if (!open) return null;

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-40 flex max-h-[calc(100vh-7rem)] w-[340px] flex-col overflow-hidden rounded-xl border border-border bg-cream-bg/95 shadow-2xl backdrop-blur-md dark:border-pulse-border dark:bg-pulse-surface/95">
      {/* Header */}
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3.5 py-2.5 dark:border-pulse-border">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            Local events
          </p>
          <p className="truncate text-[13px] font-semibold text-text-primary">{siteLabel}</p>
          <p className="text-[11px] text-text-muted">
            {filtered.length} of {events.length} within {radiusMiles} mi
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-muted hover:bg-cream-surface hover:text-text-primary dark:hover:bg-pulse-surface-light"
          aria-label="Close events panel"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      {/* Controls */}
      <div className="border-b border-border px-3.5 py-2 dark:border-pulse-border">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-muted">Radius</span>
          <span className="text-[11px] font-medium text-text-primary">{radiusMiles} mi</span>
        </div>
        <input
          type="range"
          min={1}
          max={25}
          step={1}
          value={radiusMiles}
          onChange={(e) => onRadiusChange(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => {
            const count = counts[c] ?? 0;
            const enabled = enabledCats.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const next = new Set(enabledCats);
                  if (enabled) next.delete(c); else next.add(c);
                  setEnabledCats(next);
                }}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  enabled
                    ? 'border-transparent text-white'
                    : 'border-border text-text-muted hover:text-text-primary dark:border-pulse-border'
                }`}
                style={enabled ? { background: CATEGORY_COLOR[c] } : undefined}
              >
                <span>{CATEGORY_LABEL[c]}</span>
                {count > 0 ? (
                  <span className={enabled ? 'opacity-80' : 'opacity-60'}>{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-[12px] text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Searching public sources…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-text-muted">
            {events.length === 0 ? (
              <>
                <p className="font-medium text-text-secondary">No events found</p>
                <p className="mt-1">
                  Try widening the radius. Severe weather alerts and public holidays will appear
                  here even without API keys configured.
                </p>
              </>
            ) : (
              <p>No events match the selected categories.</p>
            )}
          </div>
        ) : (
          <ul>
            {filtered.map((e) => {
              const color = CATEGORY_COLOR[e.category];
              const isActive = e.id === hoveredEventId || e.id === selectedEventId;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onMouseEnter={() => onHover(e.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(e)}
                    className={`flex w-full items-start gap-2.5 border-b border-border/60 px-3.5 py-2.5 text-left transition-colors last:border-0 dark:border-pulse-border/60 ${
                      isActive
                        ? 'bg-indigo-500/8 dark:bg-indigo-400/10'
                        : 'hover:bg-cream-surface dark:hover:bg-pulse-surface-light'
                    }`}
                  >
                    {/* Color dot */}
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className="text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                          style={{ color }}
                        >
                          {CATEGORY_LABEL[e.category]}
                        </span>
                        {e.category === 'severe-weather' ? (
                          <AlertTriangle className="h-3 w-3 text-red-500" strokeWidth={2} />
                        ) : null}
                        <span className="text-[10px] text-text-muted">
                          · {e.distanceMiles?.toFixed(1)} mi
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-text-primary">
                        {e.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" strokeWidth={1.75} />
                          {formatEventTime(e.startsAt)}
                        </span>
                        {e.venueName ? (
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3" strokeWidth={1.75} />
                            <span className="truncate">{e.venueName}</span>
                          </span>
                        ) : null}
                        {e.attendance ? (
                          <span>~{e.attendance.toLocaleString()} cap</span>
                        ) : null}
                      </div>
                      {e.url ? (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(ev) => ev.stopPropagation()}
                          className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-indigo-600 hover:underline dark:text-indigo-300"
                        >
                          source <ExternalLink className="h-2.5 w-2.5" strokeWidth={2} />
                        </a>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-cream-surface px-3.5 py-2 text-[10px] leading-snug text-text-muted dark:border-pulse-border dark:bg-pulse-bg">
        Sources: Ticketmaster, SeatGeek, NWS, GDELT, Nager.Date. Set
        <code className="mx-1 rounded bg-cream-bg px-1 font-mono dark:bg-pulse-surface">
          TICKETMASTER_API_KEY
        </code>
        and
        <code className="mx-1 rounded bg-cream-bg px-1 font-mono dark:bg-pulse-surface">
          SEATGEEK_CLIENT_ID
        </code>
        in backend/.env to enable concerts &amp; sports.
      </div>
    </div>
  );
}
