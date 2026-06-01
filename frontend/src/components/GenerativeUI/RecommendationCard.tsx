/**
 * RecommendationCard — DataDict-enriched change plan from the live RCA.
 *
 * Inspection-only. There is no "Provision" handoff here by design — the card
 * gives an engineer everything they need to copy the plan into their own
 * change-management tool with full citations.
 *
 * Data flow:
 *   tool_run_rca_live → enrichRecommendation() → recommendation_card block →
 *   this component.
 */
import { useMemo, useState } from 'react';
import {
  Sparkles,
  ArrowUp,
  ArrowDown,
  Lock,
  Unlock,
  Power,
  RotateCcw,
  Settings,
  Copy,
  Check,
  ChevronDown,
  Database,
  BookOpen,
  Split,
  Layers,
  ArrowDownToLine,
  Zap,
  Undo2,
  TrendingUp,
  AlertTriangle,
  Eye,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

interface ParameterPlan {
  paramName: string;
  scope?: string;
  direction?: string;
  deltaText?: string;
  description?: string;
  possibleImpact?: string;
  possibleChange?: string;
  dataType?: string;
  sources: Array<'rca-text' | 'datadict' | 'rca-knowledge'>;
}

type ActionKind =
  | 'load_shed' | 'layer_move' | 'tilt' | 'power' | 'revert'
  | 'capacity' | 'escalate' | 'monitor' | 'validate';

interface ActionParam {
  paramName: string;
  scope?: string;
  change?: string;
  description?: string;
  impact?: string;
}

interface PredictedDelta {
  label: string;
  before: string;
  after: string;
  delta: string;
  tone: 'green' | 'amber' | 'red';
}

interface RecommendedAction {
  kind: ActionKind;
  title: string;
  rationale: string;
  confidence?: 'high' | 'medium' | 'low';
  loadShed?: Array<{
    neighborUsid: string;
    neighborFace?: string;
    currentHoShare?: number;
    neighborPrbHeadroom?: number;
    paramName?: string;
    deltaDb?: number;
  }>;
  layerMove?: { fromBand: string; toBand: string; bhPeakPrb?: number; note?: string };
  tilt?: { cellName: string; currentDeg?: number; deltaDeg: number; reason?: string };
  power?: { cellName: string; deltaDb: number; reason?: string };
  params?: ActionParam[];
  evidence?: string[];
  simulation?: {
    confidence: number;
    basedOn: string;
    predicted: PredictedDelta[];
  };
}

interface RecommendationPlan {
  category?: string;
  confidenceLevel?: 'high' | 'medium' | 'low';
  headline?: string;
  reasoning?: string;
  freeText?: string;
  parameters: ParameterPlan[];
  actions?: RecommendedAction[];
  alternatives?: Array<{ bucket: string; confidence: number }>;
}

interface Props {
  siteId?: string;
  date?: string;
  plan: RecommendationPlan;
}

// ─── Direction icons ────────────────────────────────────────────────────────

const DIRECTION_ICONS: Record<string, LucideIcon> = {
  Increase: ArrowUp,
  Decrease: ArrowDown,
  Lock: Lock,
  Unlock: Unlock,
  Disable: Power,
  Enable: Power,
  Revert: RotateCcw,
  Set: Settings,
};

const CONFIDENCE_BADGE: Record<NonNullable<RecommendationPlan['confidenceLevel']>, { label: string; cls: string }> = {
  high:   { label: 'High confidence',   cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:bg-emerald-400/15 dark:text-emerald-300 dark:border-emerald-400/30' },
  medium: { label: 'Medium confidence', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:border-amber-400/30' },
  low:    { label: 'Low confidence',    cls: 'bg-slate-500/15 text-slate-700 border-slate-500/30 dark:bg-slate-400/15 dark:text-slate-300 dark:border-slate-400/30' },
};

// ─── Source citation chips ──────────────────────────────────────────────────

const SOURCE_META: Record<ParameterPlan['sources'][number], { label: string; icon: LucideIcon }> = {
  'rca-text':       { label: 'RCA reasoning',  icon: Sparkles },
  'datadict':       { label: 'DataDict',       icon: Database },
  'rca-knowledge':  { label: 'RCA knowledge',  icon: BookOpen },
};

// ─── Action kind metadata ───────────────────────────────────────────────────

const ACTION_META: Record<ActionKind, { label: string; Icon: LucideIcon; tint: string; bg: string }> = {
  load_shed:   { label: 'Load shed',          Icon: Split,            tint: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-500/12 dark:bg-indigo-400/12' },
  layer_move:  { label: 'Layer balance',      Icon: Layers,           tint: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-500/12 dark:bg-violet-400/12' },
  tilt:        { label: 'Tilt adjustment',    Icon: ArrowDownToLine,  tint: 'text-amber-700 dark:text-amber-300',   bg: 'bg-amber-500/12 dark:bg-amber-400/12' },
  power:       { label: 'Power tweak',        Icon: Zap,              tint: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-500/12 dark:bg-orange-400/12' },
  revert:      { label: 'Revert change',      Icon: Undo2,            tint: 'text-rose-700 dark:text-rose-300',     bg: 'bg-rose-500/12 dark:bg-rose-400/12' },
  capacity:    { label: 'Capacity',           Icon: TrendingUp,       tint: 'text-sky-700 dark:text-sky-300',       bg: 'bg-sky-500/12 dark:bg-sky-400/12' },
  escalate:    { label: 'Escalate',           Icon: AlertTriangle,    tint: 'text-red-700 dark:text-red-300',       bg: 'bg-red-500/12 dark:bg-red-400/12' },
  monitor:     { label: 'Monitor',            Icon: Eye,              tint: 'text-slate-700 dark:text-slate-300',   bg: 'bg-slate-500/12 dark:bg-slate-400/12' },
  validate:    { label: 'Validate',           Icon: ShieldCheck,      tint: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/12 dark:bg-emerald-400/12' },
};

function ActionRow({ action, index }: { action: RecommendedAction; index: number }) {
  const meta = ACTION_META[action.kind] ?? ACTION_META.monitor;
  const { Icon } = meta;
  return (
    <div className="rounded-xl border border-border bg-cream-bg/60 p-3 dark:border-pulse-border dark:bg-pulse-bg/40">
      <div className="flex items-start gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.bg} ${meta.tint}`}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-text-muted">
              Action {index + 1}
            </span>
            <span className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] ${meta.tint}`}>
              {meta.label}
            </span>
            {action.confidence ? (
              <span className="text-[10.5px] text-text-muted">· {action.confidence} confidence</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-text-primary">
            {action.title}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-text-secondary">
            {action.rationale}
          </p>

          {/* Load-shed table */}
          {action.loadShed?.length ? (
            <div className="mt-2 overflow-x-auto rounded-md border border-border/60 dark:border-pulse-border/60">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.06em] text-text-muted">
                    <th className="px-2 py-1 text-left font-semibold">Neighbour</th>
                    <th className="px-2 py-1 text-right font-semibold">PRB headroom</th>
                    <th className="px-2 py-1 text-right font-semibold">Current HO%</th>
                    <th className="px-2 py-1 text-right font-semibold">CIO shift</th>
                  </tr>
                </thead>
                <tbody>
                  {action.loadShed.map((n) => (
                    <tr key={`${n.neighborUsid}_${n.neighborFace ?? ''}`} className="border-t border-border/40 dark:border-pulse-border/40">
                      <td className="px-2 py-1 font-mono text-text-primary">
                        {n.neighborUsid}{n.neighborFace ? ` · ${n.neighborFace}` : ''}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-secondary">
                        {n.neighborPrbHeadroom != null ? `${n.neighborPrbHeadroom} pp` : '—'}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-secondary">
                        {n.currentHoShare != null ? `${(n.currentHoShare * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                        +{n.deltaDb ?? 1} dB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* Layer move summary */}
          {action.layerMove ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/60 bg-cream-surface px-2 py-1 text-[11.5px] dark:border-pulse-border/60 dark:bg-pulse-surface">
              <span className="font-mono text-text-secondary">{action.layerMove.fromBand}</span>
              <ArrowDown className="h-3 w-3 rotate-[-90deg] text-text-muted" strokeWidth={2} />
              <span className="font-mono text-text-primary">{action.layerMove.toBand}</span>
              {action.layerMove.bhPeakPrb != null ? (
                <span className="text-text-muted">· BH peak {action.layerMove.bhPeakPrb}%</span>
              ) : null}
            </div>
          ) : null}

          {/* Tilt / power summaries */}
          {action.tilt ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/60 bg-cream-surface px-2 py-1 text-[11.5px] dark:border-pulse-border/60 dark:bg-pulse-surface">
              <span className="font-mono text-text-primary">{action.tilt.cellName}</span>
              <span className="text-text-muted">tilt</span>
              <span className={`font-mono font-semibold ${action.tilt.deltaDeg < 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {action.tilt.deltaDeg > 0 ? '+' : ''}{action.tilt.deltaDeg}°
              </span>
            </div>
          ) : null}
          {action.power ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/60 bg-cream-surface px-2 py-1 text-[11.5px] dark:border-pulse-border/60 dark:bg-pulse-surface">
              <span className="font-mono text-text-primary">{action.power.cellName}</span>
              <span className="text-text-muted">power</span>
              <span className={`font-mono font-semibold ${action.power.deltaDb > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {action.power.deltaDb > 0 ? '+' : ''}{action.power.deltaDb} dB
              </span>
            </div>
          ) : null}

          {/* Per-action parameter snippets */}
          {action.params?.length ? (
            <ul className="mt-2 space-y-1">
              {action.params.map((p, i) => (
                <li key={`${p.paramName}_${i}`} className="text-[11.5px] leading-snug text-text-secondary">
                  <code className="font-mono text-text-primary">{p.paramName}</code>
                  {p.scope ? <span className="text-text-muted"> · {p.scope}</span> : null}
                  {p.change ? <span className="text-text-primary"> — {p.change}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Predicted KPI deltas (from action-simulator) */}
          {action.simulation && action.simulation.predicted.length > 0 ? (
            <div className="mt-2 rounded-md border border-border/60 bg-cream-surface/60 px-2 py-1.5 dark:border-pulse-border/60 dark:bg-pulse-surface/60">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.08em]">
                <span className="font-semibold text-text-muted">Predicted impact</span>
                <span className="text-text-muted">
                  {Math.round(action.simulation.confidence * 100)}% confidence
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {action.simulation.predicted.map((p, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="truncate text-text-secondary">{p.label}</span>
                    <span
                      className={`font-mono font-semibold ${
                        p.tone === 'green'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : p.tone === 'amber'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-rose-700 dark:text-rose-300'
                      }`}
                      title={`${p.before} → ${p.after}`}
                    >
                      {p.delta}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-text-muted">{action.simulation.basedOn}</p>
            </div>
          ) : null}

          {/* Evidence citations */}
          {action.evidence?.length ? (
            <details className="mt-2 text-[11px]">
              <summary className="cursor-pointer font-semibold text-text-muted hover:text-text-primary">Evidence</summary>
              <ul className="mt-1 space-y-0.5 pl-3 text-text-secondary">
                {action.evidence.map((e, i) => (
                  <li key={i} className="font-mono">{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RecommendationCard({ siteId, date, plan }: Props) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [copiedAs, setCopiedAs] = useState<'json' | 'text' | null>(null);

  const planJson = useMemo(
    () => JSON.stringify({ siteId, date, ...plan }, null, 2),
    [siteId, date, plan],
  );
  const planText = useMemo(() => formatPlanAsText(siteId, date, plan), [siteId, date, plan]);

  const copy = async (kind: 'json' | 'text') => {
    try {
      await navigator.clipboard.writeText(kind === 'json' ? planJson : planText);
      setCopiedAs(kind);
      setTimeout(() => setCopiedAs(null), 1500);
    } catch {
      /* clipboard refused — ignore silently */
    }
  };

  const actions = plan.actions ?? [];
  const empty = !plan.parameters.length && !plan.freeText && !plan.headline && actions.length === 0;
  if (empty) {
    return (
      <div className="mt-3 rounded-2xl border border-border bg-cream-bg p-4 text-[13px] text-text-secondary dark:border-pulse-border dark:bg-pulse-surface">
        The live RCA returned without an actionable recommendation. See the RCA summary above.
      </div>
    );
  }

  const conf = plan.confidenceLevel ? CONFIDENCE_BADGE[plan.confidenceLevel] : null;

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.04] via-cream-bg to-cream-bg shadow-sm dark:border-indigo-400/20 dark:from-indigo-400/[0.06] dark:via-pulse-surface dark:to-pulse-surface">
      {/* Hero strip */}
      <div className="flex items-start gap-3 border-b border-border/60 px-4 py-3 dark:border-pulse-border/60">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-600 dark:bg-indigo-400/12 dark:text-indigo-300">
          <Sparkles className="h-4.5 w-4.5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Recommended change
            </p>
            {plan.category ? (
              <span className="rounded-full bg-cream-surface px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-secondary dark:bg-pulse-surface-light">
                {plan.category}
              </span>
            ) : null}
            {conf ? (
              <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${conf.cls}`}>
                {conf.label}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-text-primary">
            {plan.headline}
          </p>
          {siteId ? (
            <p className="mt-0.5 text-[11.5px] text-text-muted">
              Site {siteId}{date ? ` · ${date}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      {/* Actions — surfaced FIRST when the strategy module produced them */}
      {actions.length > 0 && (
        <div className="space-y-2.5 px-4 py-3">
          {actions.map((a, idx) => (
            <ActionRow key={`${a.kind}_${idx}`} action={a} index={idx} />
          ))}
        </div>
      )}

      {/* Alternative buckets (when present) */}
      {plan.alternatives && plan.alternatives.length > 1 ? (
        <div className="border-t border-border/60 px-4 py-2 dark:border-pulse-border/60">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Alternative root causes considered
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.alternatives.slice(1, 4).map((alt) => (
              <span
                key={alt.bucket}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-cream-surface px-2 py-0.5 text-[10.5px] text-text-secondary dark:border-pulse-border dark:bg-pulse-surface"
                title={`${(alt.confidence * 100).toFixed(0)}% confidence`}
              >
                <span className="capitalize">{alt.bucket.toLowerCase()}</span>
                <span className="font-mono text-text-muted">{(alt.confidence * 100).toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Parameters touched — section heading shifts when actions present */}
      {plan.parameters.length > 0 && (
        <div className="space-y-2.5 border-t border-border/60 px-4 py-3 dark:border-pulse-border/60">
          {actions.length > 0 ? (
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              Parameters touched
            </p>
          ) : null}
          {plan.parameters.map((p, idx) => {
            const Icon = (p.direction && DIRECTION_ICONS[p.direction]) || Settings;
            return (
              <div
                key={`${p.paramName}-${idx}`}
                className="rounded-xl border border-border bg-cream-bg/60 p-3 dark:border-pulse-border dark:bg-pulse-bg/40"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      p.direction === 'Decrease' || p.direction === 'Disable' || p.direction === 'Lock' || p.direction === 'Revert'
                        ? 'bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300'
                        : 'bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <code className="text-[12.5px] font-semibold text-text-primary">{p.paramName}</code>
                      {p.scope ? (
                        <span className="text-[11px] text-text-muted">· {p.scope}</span>
                      ) : null}
                      {p.dataType ? (
                        <span className="text-[10.5px] font-mono text-text-muted">{p.dataType}</span>
                      ) : null}
                    </div>
                    {(p.direction || p.deltaText) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                        {p.direction ? (
                          <span className="rounded-md border border-indigo-500/30 bg-indigo-500/8 px-1.5 py-0.5 font-semibold uppercase tracking-[0.05em] text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-200">
                            {p.direction}
                          </span>
                        ) : null}
                        {p.deltaText ? (
                          <span className="font-mono text-text-secondary">{p.deltaText}</span>
                        ) : null}
                      </div>
                    )}
                    {p.description ? (
                      <p className="mt-1.5 text-[12px] leading-snug text-text-secondary">
                        {p.description}
                      </p>
                    ) : null}
                    {p.possibleImpact ? (
                      <p className="mt-1 text-[11.5px] leading-snug text-text-secondary">
                        <span className="font-semibold text-text-primary">Impact: </span>
                        {p.possibleImpact}
                      </p>
                    ) : null}
                    {p.possibleChange ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-text-muted">
                        <span className="font-semibold">Typical change: </span>
                        {p.possibleChange}
                      </p>
                    ) : null}
                    {/* Source citation chips */}
                    {p.sources.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.sources.map((s) => {
                          const meta = SOURCE_META[s];
                          const SIcon = meta.icon;
                          return (
                            <span
                              key={s}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-cream-surface px-1.5 py-0.5 text-[10px] text-text-muted dark:border-pulse-border dark:bg-pulse-surface"
                              title={meta.label}
                            >
                              <SIcon className="h-2.5 w-2.5" strokeWidth={2} />
                              {meta.label}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Free-text fallback when no parameters could be extracted */}
      {plan.parameters.length === 0 && plan.freeText ? (
        <div className="px-4 py-3 text-[12.5px] leading-relaxed text-text-secondary">
          {plan.freeText}
        </div>
      ) : null}

      {/* Reasoning expander */}
      {plan.reasoning ? (
        <div className="border-t border-border/60 dark:border-pulse-border/60">
          <button
            type="button"
            onClick={() => setShowReasoning((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-[11.5px] font-semibold text-text-secondary transition-colors hover:text-text-primary"
          >
            <span>{showReasoning ? 'Hide reasoning' : 'Show RCA reasoning'}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showReasoning ? 'rotate-180' : ''}`}
              strokeWidth={2}
            />
          </button>
          {showReasoning ? (
            <div className="border-t border-border/60 bg-cream-surface px-4 py-3 text-[12px] leading-relaxed text-text-secondary dark:border-pulse-border/60 dark:bg-pulse-bg">
              <pre className="whitespace-pre-wrap font-sans">{plan.reasoning}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Footer — copy actions (no Provision attach by design) */}
      <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-cream-surface/60 px-4 py-2.5 dark:border-pulse-border/60 dark:bg-pulse-bg/40">
        <span className="text-[10.5px] text-text-muted">
          Inspection only — copy into your change-management tool.
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => copy('text')}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-cream-bg px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface dark:hover:border-indigo-400"
            title="Copy as plain text"
          >
            {copiedAs === 'text' ? (
              <Check className="h-3 w-3 text-emerald-500" strokeWidth={2.4} />
            ) : (
              <Copy className="h-3 w-3" strokeWidth={2} />
            )}
            {copiedAs === 'text' ? 'Copied' : 'Copy as text'}
          </button>
          <button
            type="button"
            onClick={() => copy('json')}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-cream-bg px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-indigo-500 hover:text-text-primary dark:border-pulse-border dark:bg-pulse-surface dark:hover:border-indigo-400"
            title="Copy as JSON"
          >
            {copiedAs === 'json' ? (
              <Check className="h-3 w-3 text-emerald-500" strokeWidth={2.4} />
            ) : (
              <Copy className="h-3 w-3" strokeWidth={2} />
            )}
            {copiedAs === 'json' ? 'Copied' : 'Copy as JSON'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Plain-text formatter for clipboard ─────────────────────────────────────

function formatPlanAsText(siteId: string | undefined, date: string | undefined, plan: RecommendationPlan): string {
  const lines: string[] = [];
  lines.push(`# Recommended change`);
  if (siteId) lines.push(`Site: ${siteId}${date ? ` · ${date}` : ''}`);
  if (plan.category) lines.push(`Category: ${plan.category}`);
  if (plan.confidenceLevel) lines.push(`Confidence: ${plan.confidenceLevel}`);
  if (plan.headline) lines.push('', plan.headline);

  if (plan.actions?.length) {
    for (let i = 0; i < plan.actions.length; i++) {
      const a = plan.actions[i];
      lines.push('');
      lines.push(`## Action ${i + 1} — ${ACTION_META[a.kind]?.label ?? a.kind}: ${a.title}`);
      lines.push(a.rationale);
      if (a.loadShed?.length) {
        for (const n of a.loadShed) {
          lines.push(
            `  · NEIGH ${n.neighborUsid}${n.neighborFace ? ` (${n.neighborFace})` : ''}` +
            ` — PRB headroom ${n.neighborPrbHeadroom ?? '?'} pp` +
            `, current HO ${n.currentHoShare != null ? (n.currentHoShare * 100).toFixed(1) + '%' : '?'}` +
            `, CIO ${n.paramName ?? 'cellIndividualOffset'} +${n.deltaDb ?? 1} dB`,
          );
        }
      }
      if (a.layerMove) {
        lines.push(`  · Layer: ${a.layerMove.fromBand} → ${a.layerMove.toBand}` +
          (a.layerMove.bhPeakPrb != null ? ` (BH peak ${a.layerMove.bhPeakPrb}%)` : ''));
      }
      if (a.tilt) lines.push(`  · Tilt: ${a.tilt.cellName} ${a.tilt.deltaDeg > 0 ? '+' : ''}${a.tilt.deltaDeg}°`);
      if (a.power) lines.push(`  · Power: ${a.power.cellName} ${a.power.deltaDb > 0 ? '+' : ''}${a.power.deltaDb} dB`);
      if (a.params?.length) {
        for (const p of a.params) {
          lines.push(`  · ${p.paramName}${p.scope ? ` (${p.scope})` : ''}${p.change ? ` — ${p.change}` : ''}`);
        }
      }
      if (a.evidence?.length) {
        lines.push('  · Evidence:');
        for (const e of a.evidence) lines.push(`    - ${e}`);
      }
    }
  }

  if (plan.parameters.length > 0) {
    lines.push('', '## Parameters touched');
  }
  for (const p of plan.parameters) {
    lines.push('');
    lines.push(`## ${p.paramName}${p.scope ? ` (${p.scope})` : ''}`);
    if (p.direction || p.deltaText) {
      lines.push(`Change: ${p.direction ?? ''}${p.deltaText ? ` ${p.deltaText}` : ''}`.trim());
    }
    if (p.description) lines.push(`Description: ${p.description}`);
    if (p.possibleImpact) lines.push(`Impact: ${p.possibleImpact}`);
    if (p.possibleChange) lines.push(`Typical change: ${p.possibleChange}`);
    if (p.dataType) lines.push(`Type: ${p.dataType}`);
    if (p.sources.length) lines.push(`Sources: ${p.sources.join(', ')}`);
  }

  if (plan.parameters.length === 0 && plan.freeText) {
    lines.push('', plan.freeText);
  }
  if (plan.reasoning) {
    lines.push('', '## RCA reasoning', plan.reasoning);
  }
  return lines.join('\n');
}
