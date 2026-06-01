/**
 * AgentActivityCard — single, compact live tool-call ribbon.
 *
 * Replaces the legacy TypingIndicator when SSE is active. Designed to be
 * unobtrusive: one line by default, expandable into a step list.
 *
 *   - While streaming with no tools yet:   "Thinking…"
 *   - When a tool is running:              "Inspecting site topology… (12s)"
 *   - Progress heartbeat:                  "Still working… (45s)"
 *   - When all tools done (stream open):   "Synthesizing answer…"
 *   - When stream finished:                "Completed (N steps)" — collapses after 1.5 s
 *
 * Clicking the ribbon expands to show the full ordered list of tool calls,
 * each with live elapsed time while pending.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { ActivityItem } from '../../hooks/useAgentStream';

interface Props {
  items: ActivityItem[];
  isStreaming: boolean;
  stalled?: boolean;
  /** Latest progress message from backend heartbeat. */
  progressMessage?: string | null;
}

/** Map tool names to human-readable active-form labels. */
const TOOL_LABELS: Record<string, string> = {
  find_site: 'Looking up site',
  get_worst_offenders: 'Ranking worst offenders',
  get_site_rca: 'Running RCA',
  run_rca_live: 'Running live RCA',
  get_site_kpis: 'Fetching site KPIs',
  show_kpi_dashboard: 'Building KPI dashboard',
  query_data: 'Querying data',
  generate_report: 'Generating report',
  telecom_knowledge: 'Searching knowledge base',
  resolve_kpi_param: 'Resolving KPI / parameter',
  set_map_layer: 'Updating map layer',
  navigate_to: 'Opening view',
  get_site_topology: 'Inspecting site topology',
  get_config_changes: 'Checking config changes',
  get_neighbor_relations: 'Mapping neighbor relations',
  get_ret_changes: 'Comparing antenna tilts',
  get_site_outages: 'Checking outage events',
  get_neighbor_outages: 'Cross-checking neighbor outages',
  get_hourly_trends: 'Pulling hourly KPI trends',
  get_kpi_impact_breakdown: 'Computing CQX impact breakdown',
  get_ticket_history: 'Looking up trouble tickets',
  compare_with_cluster: 'Comparing with cluster peers',
  get_local_events: 'Searching local events',
  ask_clarification: 'Asking for clarification',
};

function labelFor(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ');
}

/** Format elapsed milliseconds as a compact human label: "3s", "1m 12s". */
function elapsedLabel(ms: number): string {
  if (ms < 1_000) return '<1s';
  const s = Math.floor(ms / 1_000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Live clock that ticks every second while `running` is true. */
function useElapsed(startedAt: number, running: boolean): number {
  const [now, setNow] = useState(Date.now);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [running]);

  return now - startedAt;
}

/** Single row in the expanded step list — has its own live timer. */
function ActivityRow({ item }: { item: ActivityItem }) {
  const isPending = item.status === 'pending';
  const elapsed = useElapsed(item.startedAt, isPending);
  const duration = isPending ? elapsed : (item.endedAt ?? Date.now()) - item.startedAt;
  const isSlow = isPending && elapsed > 20_000;

  return (
    <li className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
      <span className="mt-0.5 shrink-0">
        {item.status === 'pending' && (
          <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
        )}
        {item.status === 'done' && (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        )}
        {item.status === 'error' && <XCircle className="h-3 w-3 text-rose-500" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {labelFor(item.name)}
          </span>
          {/* Elapsed time badge */}
          <span
            className={`flex items-center gap-0.5 text-[10px] font-mono tabular-nums ${
              isSlow
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {isSlow && <Clock className="h-2.5 w-2.5" />}
            {elapsedLabel(duration)}
          </span>
        </div>
        {item.argsSummary && (
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {item.argsSummary}
          </div>
        )}
        {item.summary && item.status !== 'pending' && (
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            → {item.summary}
          </div>
        )}
      </div>
    </li>
  );
}

export default function AgentActivityCard({ items, isStreaming, stalled, progressMessage }: Props) {
  const pendingCount = useMemo(
    () => items.filter((i) => i.status === 'pending').length,
    [items],
  );
  const doneCount = items.length - pendingCount;

  const latestPending = items.find((i) => i.status === 'pending');

  // Live elapsed timer for the ribbon label (drives ribbon text only).
  const ribbonElapsed = useElapsed(
    latestPending?.startedAt ?? Date.now(),
    !!latestPending,
  );

  // Compact one-liner label shown in the ribbon.
  const ribbonLabel = (() => {
    // Progress heartbeat overrides generic labels.
    if (progressMessage && isStreaming && !latestPending) return progressMessage;
    if (items.length === 0 && isStreaming) return 'Thinking…';
    if (latestPending) {
      const timeHint = ribbonElapsed > 5_000 ? ` (${elapsedLabel(ribbonElapsed)})` : '';
      const others = pendingCount - 1;
      return others > 0
        ? `${labelFor(latestPending.name)}…${timeHint} (+${others} in parallel)`
        : `${labelFor(latestPending.name)}…${timeHint}`;
    }
    if (isStreaming && items.length > 0) return 'Synthesizing answer…';
    if (!isStreaming && items.length > 0)
      return `Completed (${items.length} step${items.length === 1 ? '' : 's'})`;
    return 'Working…';
  })();

  const [expanded, setExpanded] = useState<boolean>(false);

  // Auto-expand when a tool has been pending for more than 10 s — long jobs
  // should show their step list so the user can see progress.
  useEffect(() => {
    if (ribbonElapsed > 10_000 && latestPending) {
      setExpanded(true);
    }
  }, [ribbonElapsed, latestPending]);

  // Auto-collapse a moment after the stream ends.
  useEffect(() => {
    if (!isStreaming && pendingCount === 0 && items.length > 0) {
      const t = setTimeout(() => setExpanded(false), 1200);
      return () => clearTimeout(t);
    }
  }, [isStreaming, pendingCount, items.length]);

  if (items.length === 0 && !isStreaming) return null;

  const showSpinner = isStreaming || pendingCount > 0;
  // Show the "slow" amber badge only when TRULY stalled (no heartbeat for 120s).
  const showStalledBadge = stalled;

  return (
    <div className="flex gap-3 items-start animate-slide-in py-1">
      {/* Naavik agent avatar */}
      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-white/10 border border-white/10 shadow-sm mt-0.5">
        <img src="/aira-logo.png" alt="Aira" className="w-4 h-4 object-contain" />
      </div>

      {/* Activity ribbon */}
      <div className="inline-flex max-w-full flex-col rounded-xl border border-slate-200/80 bg-white/70 backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-900/40">
        <button
          type="button"
          onClick={() => items.length > 0 && setExpanded((v) => !v)}
          disabled={items.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-600 transition disabled:cursor-default hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
        >
          {showSpinner ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          )}
          <span className="truncate font-medium">{ribbonLabel}</span>
          {items.length > 0 && (
            <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {doneCount}/{items.length}
            </span>
          )}
          {showStalledBadge && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              No response
            </span>
          )}
          {items.length > 0 &&
            (expanded ? (
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400" />
            ))}
        </button>

        {expanded && items.length > 0 && (
          <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700/60">
            <ol className="space-y-1.5">
              {items.map((it) => (
                <ActivityRow key={it.callId} item={it} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
