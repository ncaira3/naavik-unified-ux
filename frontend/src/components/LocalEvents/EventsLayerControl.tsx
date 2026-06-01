/**
 * EventsLayerControl — compact map-anchored control that drives the events
 * layer. Replaces the older docked side panel.
 *
 *   ┌──────────────────────────────┐
 *   │ ▶ Events                     │   (collapsed pill)
 *   └──────────────────────────────┘
 *   Clicked:
 *   ┌──────────────────────────────┐
 *   │ ◉ Events           [×]       │
 *   │ ─────────────────────────────│
 *   │ Date window                  │
 *   │ [Today] [±3d] [Past 7] [Next 7] [Custom]
 *   │ From [2026-05-22]  To [2026-05-29]
 *   │ ─────────────────────────────│
 *   │ Radius                       │
 *   │ [─────●─────]   5 mi         │
 *   │ ─────────────────────────────│
 *   │ Categories                   │
 *   │ [Concert] [Sports] [Festival] [Weather] [News] [Holiday]
 *   │ ─────────────────────────────│
 *   │ Anchored to: site 9787 / map centre
 *   │ 12 events shown                                      │
 *   └──────────────────────────────┘
 *
 * Lives in the top-right of the map, just above the zoom controls.
 */
import { useState } from 'react';
import {
  Calendar,
  X,
  ChevronDown,
  CalendarRange,
  Loader2,
  MapPinned,
  Layers,
  Plug,
} from 'lucide-react';
import { CATEGORY_COLOR, CATEGORY_LABEL, type EventCategory } from '../../services/localEvents';

export interface EventsLayerState {
  enabled: boolean;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  radiusMiles: number;
  enabledCategories: Set<EventCategory>;
  anchorMode: 'site' | 'map';   // how the center is determined
}

interface Props {
  state: EventsLayerState;
  onChange: (next: EventsLayerState) => void;
  selectedSiteLabel?: string | null;
  loading?: boolean;
  totalEvents?: number;
  filteredEvents?: number;
  /** Position the control. Default top-right corner. */
  className?: string;
}

const CATEGORIES: EventCategory[] = [
  'concert',
  'sports',
  'festival',
  'school',
  'conference',
  'severe-weather',
  'news',
  'public-holiday',
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface QuickRange {
  id: string;
  label: string;
  range: () => { startDate: string; endDate: string };
}
const QUICK_RANGES: QuickRange[] = [
  { id: 'today',     label: 'Today',      range: () => ({ startDate: todayISO(), endDate: todayISO() }) },
  { id: 'pm3',       label: '±3 days',    range: () => ({ startDate: addDays(todayISO(), -3), endDate: addDays(todayISO(), 3) }) },
  { id: 'past7',     label: 'Past 7',     range: () => ({ startDate: addDays(todayISO(), -7), endDate: todayISO() }) },
  { id: 'next7',     label: 'Next 7',     range: () => ({ startDate: todayISO(), endDate: addDays(todayISO(), 7) }) },
  { id: 'next30',    label: 'Next 30',    range: () => ({ startDate: todayISO(), endDate: addDays(todayISO(), 30) }) },
];

export default function EventsLayerControl({
  state,
  onChange,
  selectedSiteLabel,
  loading,
  totalEvents,
  filteredEvents,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const set = <K extends keyof EventsLayerState>(key: K, value: EventsLayerState[K]) =>
    onChange({ ...state, [key]: value });

  const toggleCategory = (cat: EventCategory) => {
    const next = new Set(state.enabledCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    onChange({ ...state, enabledCategories: next });
  };

  const applyQuickRange = (q: QuickRange) => {
    const r = q.range();
    onChange({ ...state, startDate: r.startDate, endDate: r.endDate });
  };

  // Determine which quick-range is currently selected (best-effort match).
  const activeQuickId = QUICK_RANGES.find((q) => {
    const r = q.range();
    return r.startDate === state.startDate && r.endDate === state.endDate;
  })?.id;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`group flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold backdrop-blur-md transition-colors ${
          state.enabled
            ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-400/15 dark:text-indigo-200'
            : 'border-border bg-white/90 text-text-secondary hover:border-indigo-500/50 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface/90'
        } ${className ?? ''}`}
        title="Events layer"
      >
        <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
        <span>Events</span>
        {state.enabled ? (
          loading ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          ) : (
            <span className="ml-0.5 rounded-full bg-indigo-500 px-1.5 py-0 text-[10px] font-bold text-white dark:bg-indigo-400">
              {(filteredEvents ?? 0)}
            </span>
          )
        ) : null}
      </button>
    );
  }

  return (
    <div
      className={`w-[300px] overflow-hidden rounded-xl border border-border bg-cream-bg/96 shadow-2xl backdrop-blur-md dark:border-pulse-border dark:bg-pulse-surface/96 ${className ?? ''}`}
    >
      {/* Header — title + enable toggle + close */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 dark:border-pulse-border">
        <Calendar className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" strokeWidth={2} />
        <span className="text-[12.5px] font-semibold text-text-primary">Events layer</span>
        <button
          type="button"
          onClick={() => set('enabled', !state.enabled)}
          className={`ml-auto inline-flex h-4 w-7 items-center rounded-full transition-colors ${
            state.enabled ? 'bg-indigo-500 dark:bg-indigo-400' : 'bg-slate-300 dark:bg-slate-600'
          }`}
          aria-pressed={state.enabled}
          aria-label="Toggle events layer"
        >
          <span
            className={`h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              state.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
          />
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-md p-0.5 text-text-muted hover:bg-cream-surface hover:text-text-primary dark:hover:bg-pulse-surface-light"
          aria-label="Collapse"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {/* Body */}
      <div className={`px-3 py-2.5 space-y-3 transition-opacity ${state.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        {/* Anchor info */}
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-cream-surface px-2 py-1 text-[10.5px] dark:border-pulse-border/60 dark:bg-pulse-bg">
          {state.anchorMode === 'site' ? (
            <>
              <MapPinned className="h-3 w-3 text-text-muted" strokeWidth={2} />
              <span className="truncate text-text-secondary">
                Around <span className="font-semibold text-text-primary">{selectedSiteLabel || 'selected site'}</span>
              </span>
            </>
          ) : (
            <>
              <Layers className="h-3 w-3 text-text-muted" strokeWidth={2} />
              <span className="truncate text-text-secondary">Around <span className="font-semibold text-text-primary">map centre</span></span>
            </>
          )}
        </div>

        {/* Date range — quick picks */}
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <CalendarRange className="h-3 w-3 text-text-muted" strokeWidth={2} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              Date window
            </span>
          </div>
          <div className="mb-1 flex flex-wrap gap-1">
            {QUICK_RANGES.map((q) => {
              const isActive = activeQuickId === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => applyQuickRange(q)}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:border-indigo-400 dark:text-indigo-200'
                      : 'border-border text-text-secondary hover:border-indigo-500/50 hover:text-text-primary dark:border-pulse-border'
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
          {/* Manual date inputs */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={state.startDate}
              max={state.endDate}
              onChange={(e) => set('startDate', e.target.value)}
              className="flex-1 rounded-md border border-border bg-transparent px-1.5 py-0.5 text-[11px] text-text-primary focus:border-indigo-500 focus:outline-none dark:border-pulse-border dark:focus:border-indigo-400"
            />
            <ChevronDown className="h-3 w-3 -rotate-90 text-text-muted" strokeWidth={2} />
            <input
              type="date"
              value={state.endDate}
              min={state.startDate}
              onChange={(e) => set('endDate', e.target.value)}
              className="flex-1 rounded-md border border-border bg-transparent px-1.5 py-0.5 text-[11px] text-text-primary focus:border-indigo-500 focus:outline-none dark:border-pulse-border dark:focus:border-indigo-400"
            />
          </div>
        </div>

        {/* Radius slider */}
        <div>
          <div className="mb-0.5 flex items-center justify-between text-[10.5px]">
            <span className="font-semibold uppercase tracking-[0.06em] text-text-muted">Radius</span>
            <span className="font-medium text-text-primary">{state.radiusMiles} mi</span>
          </div>
          <input
            type="range"
            min={1}
            max={25}
            step={1}
            value={state.radiusMiles}
            onChange={(e) => set('radiusMiles', Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        {/* Category filter chips */}
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            Categories
          </p>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => {
              const isOn = state.enabledCategories.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                    isOn ? 'border-transparent text-white' : 'border-border text-text-muted hover:text-text-primary dark:border-pulse-border'
                  }`}
                  style={isOn ? { background: CATEGORY_COLOR[c] } : undefined}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border bg-cream-surface px-3 py-1.5 text-[10px] text-text-muted dark:border-pulse-border dark:bg-pulse-bg">
        <span className="inline-flex items-center gap-1">
          <Plug className="h-2.5 w-2.5" strokeWidth={2} />
          Ticketmaster · SeatGeek · NWS · GDELT
        </span>
        <span className="font-mono">
          {loading ? '…' : `${filteredEvents ?? 0} / ${totalEvents ?? 0}`}
        </span>
      </div>
    </div>
  );
}
