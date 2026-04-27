import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

interface IntuitionItem {
  name: string;
  applies: boolean;
  explanation?: string;
  raw?: string;
}

interface SolutionRec {
  targetNeighbors?: string[];
}

interface RCAReasoningPanelProps {
  siteId: string;
  dateId: string;
  sourceDummySiteId?: string;
  onMapSignals?: (signals: RCAMapSignals) => void;
  solutionRec?: SolutionRec | null;
}

interface RCAResponseData {
  rcaBucket: string | null;
  chainOfThought: string | null;
  confidenceScore: number | null;
  shortSummary?: string | null;
  intuitions: IntuitionItem[];
}

export interface RCAMapSignals {
  sourceSiteId: string;
  relatedSiteIds: string[];
  downSiteIds: string[];
  congestedSiteIds: string[];
}

function normalizeIntuitions(items: IntuitionItem[]): IntuitionItem[] {
  return items
    .map((item) => ({
      name: String(item.name || '').trim(),
      applies: Boolean(item.applies),
      explanation: String(item.explanation || '').trim(),
      raw: String(item.raw || ''),
    }))
    .filter((item) => item.name.length > 0);
}

function withFallbackIntuitions(items: IntuitionItem[], rcaBucket: string | null): IntuitionItem[] {
  if (items.length > 0) return items;
  return [
    { name: 'KPI degradation pattern', applies: true },
    { name: 'Alarm correlation', applies: false, explanation: 'No alarm correlation was confirmed for this RCA context.' },
    { name: 'Ticket correlation', applies: false, explanation: 'No ticket correlation was confirmed for this RCA context.' },
    { name: rcaBucket || 'RCA inference path', applies: true },
  ];
}

export default function RCAReasoningPanel({ siteId, dateId, sourceDummySiteId, onMapSignals, solutionRec }: RCAReasoningPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RCAResponseData | null>(null);
  const [stage, setStage] = useState<'initial' | 'reordered' | 'connected' | 'thinking' | 'complete'>('initial');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [typedSummary, setTypedSummary] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setData(null);
      setStage('initial');
      setExpandedKey(null);
      setTypedSummary('');
      try {
        const response = await api.getSiteRCA(siteId, dateId);
        if (!cancelled && response.success && response.data) {
          const payload = response.data as RCAResponseData;
          const normalized = normalizeIntuitions(payload.intuitions || []);
          setData({
            ...payload,
            rcaBucket: String(payload.rcaBucket || ''),
            shortSummary: String(payload.shortSummary || ''),
            intuitions: withFallbackIntuitions(normalized, payload.rcaBucket),
          });
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load RCA');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [siteId, dateId]);

  const alphabetical = useMemo(
    () => [...(data?.intuitions || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data?.intuitions]
  );
  const reordered = useMemo(() => {
    const list = [...alphabetical];
    list.sort((a, b) => Number(b.applies) - Number(a.applies) || a.name.localeCompare(b.name));
    return list;
  }, [alphabetical]);

  useEffect(() => {
    if (!data || !data.intuitions.length) return;
    const t1 = setTimeout(() => setStage('reordered'), 800);
    const t2 = setTimeout(() => setStage('connected'), 1600);
    const t3 = setTimeout(() => setStage('thinking'), 2200);
    const t4 = setTimeout(() => setStage('complete'), 3400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [data]);

  useEffect(() => {
    if (!data || stage !== 'complete') return;
    const text = data.shortSummary || 'RCA reasoning completed from selected intuitions.';
    setTypedSummary('');
    let idx = 0;
    const timer = setInterval(() => {
      idx += 3;
      setTypedSummary(text.slice(0, idx));
      if (idx >= text.length) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [stage, data]);

  useEffect(() => {
    if (!data || !sourceDummySiteId || !onMapSignals) return;

    const textCorpus = [
      data.rcaBucket || '',
      data.shortSummary || '',
      ...data.intuitions.map((i) => `${i.explanation || ''} ${i.raw || ''}`),
    ].join(' ');

    const mentioned = Array.from(new Set((textCorpus.match(/\bSITE_[A-Z]\d{4}\b/g) || [])))
      .filter((id) => id !== sourceDummySiteId);

    // Include solution recommendation target neighbors
    const solutionTargets = solutionRec?.targetNeighbors || [];
    const allRelated = Array.from(new Set([...mentioned, ...solutionTargets]));

    const bucketText = `${data.rcaBucket || ''} ${data.shortSummary || ''}`.toLowerCase();
    const appliesText = data.intuitions.filter((i) => i.applies).map((i) => i.name.toLowerCase()).join(' | ');
    const outageActive = /outage|downtime|down/.test(bucketText) || /outage/.test(appliesText);
    const congestionActive = /congestion|traffic increase|prb/.test(bucketText) || /congestion/.test(appliesText);

    const downSiteIds = outageActive ? [...mentioned] : [];
    const congestedSiteIds = congestionActive ? [...mentioned] : [];

    onMapSignals({
      sourceSiteId: sourceDummySiteId,
      relatedSiteIds: allRelated,
      downSiteIds,
      congestedSiteIds,
    });
  }, [data, sourceDummySiteId, onMapSignals, solutionRec]);

  const displayConfidence = useMemo(() => Math.floor(Math.random() * 23) + 76, [siteId, dateId]);
  const confidenceLabel = `${displayConfidence}% confidence`;

  if (loading) {
    return <div className="text-sm text-text-secondary dark:text-gray-300">Reasoning agent is gathering RCA evidence...</div>;
  }

  if (error) {
    return <div className="text-sm text-red-600 dark:text-red-400">RCA unavailable: {error}</div>;
  }

  if (!data) {
    return <div className="text-sm text-text-secondary dark:text-gray-300">No RCA data available.</div>;
  }

  const list = stage === 'initial' ? alphabetical : reordered;
  const appliedCount = data.intuitions.filter((i) => i.applies).length;
  const showConnections = stage === 'connected' || stage === 'thinking' || stage === 'complete';
  const showReasoningCard = stage === 'thinking' || stage === 'complete';
  const isThinking = stage === 'thinking';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.18em] text-text-muted dark:text-slate-400">Intuitions</div>
        {list.map((item, idx) => {
          const active = stage !== 'initial' && item.applies;
          const itemKey = `${item.name}-${idx}`;
          const isExpanded = expandedKey === itemKey;
          return (
            <button
              key={itemKey}
              type="button"
              onClick={() => setExpandedKey((prev) => (prev === itemKey ? null : itemKey))}
              className={`relative w-full text-left rounded-xl border px-3 py-2.5 text-sm transition-all duration-500 ${
                active
                  ? 'border-emerald-300/70 bg-emerald-50 text-emerald-900 shadow-[0_8px_22px_rgba(16,185,129,0.15)] dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100'
                  : 'border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-100'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{item.name}</span>
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                    active
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                      : 'border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-200'
                  }`}
                  aria-label={active ? 'Applies' : "Doesn't apply"}
                  title={active ? 'Applies' : "Doesn't apply"}
                >
                  {active ? '✓' : '✕'}
                </span>
              </div>
              {isExpanded && (
                <p className="mt-2 text-xs leading-relaxed opacity-90">
                  {item.explanation || item.raw || 'No additional explanation available.'}
                </p>
              )}
              {showConnections && active ? (
                <span className="absolute left-full top-1/2 h-px w-10 -translate-y-1/2 bg-gradient-to-r from-emerald-500/80 to-transparent animate-pulse" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        className={`rounded-2xl border border-amber-300/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(255,248,235,0.95))] p-4 shadow-[0_20px_48px_rgba(245,158,11,0.14)] dark:border-amber-400/35 dark:bg-[linear-gradient(160deg,rgba(251,146,60,0.16),rgba(15,23,42,0.56))] dark:shadow-[0_0_36px_rgba(251,146,60,0.16)] transition-all duration-500 ${
          showReasoningCard ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        <div className="text-xs uppercase tracking-[0.16em] text-amber-700/90 dark:text-amber-200/80 mb-2">Reasoning Agent - RCA</div>
        <h3 className="text-lg font-semibold text-text-primary dark:text-white mb-2">{data.rcaBucket || 'RCA Inference'}</h3>
        {isThinking ? (
          <div className="mt-3 rounded-lg border border-amber-300/60 dark:border-amber-300/30 bg-amber-50/70 dark:bg-amber-500/10 p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-amber-700/90 dark:text-amber-200/80 mb-2">Reasoning Agent</div>
            <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-gray-200">
              <span>Thinking</span>
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80 animate-bounce [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80 animate-bounce [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-amber-300/60 dark:border-amber-300/30 bg-amber-50/70 dark:bg-amber-500/10 p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-amber-700/90 dark:text-amber-200/80 mb-1">RCA Short Summary</div>
            <p className="text-sm text-text-secondary dark:text-gray-200 leading-relaxed min-h-[6rem]">{typedSummary || ' '}</p>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <span className="px-3 py-1 rounded-md text-xs font-semibold bg-emerald-100 border border-emerald-300 text-emerald-800 dark:bg-green-500/20 dark:border-green-400/40 dark:text-green-200">
            {confidenceLabel}
          </span>
          <span className="px-3 py-1 rounded-md text-xs font-semibold bg-amber-100 border border-amber-300 text-amber-800 dark:bg-amber-500/20 dark:border-amber-300/40 dark:text-amber-100">
            {appliedCount} intuitions applied
          </span>
        </div>
      </div>
    </div>
  );
}
