import { useMemo, useState } from 'react';
import type { UiBlock } from '../../types';
import { emitChip } from '../../utils/uiBlocks';
import FollowupChips, { type FollowupChip } from './Followups/FollowupChips';
import InteractiveGridTable from '../Chat/ReportComponents/InteractiveGridTable';
import InlineMap from '../InlineMap';
import RcaSiteStoryCard from '../Chat/ReportComponents/RcaSiteStoryCard';
import RcaReportCard from './RcaReportCard';
import TicketEscalationCard from '../Chat/ReportComponents/TicketEscalationCard';
import { WorkflowExecutionStatus } from '../Chat/ReportComponents/WorkflowExecutionStatus';
import ChatKpiDashboard from '../Chat/ReportComponents/ChatKpiDashboard';
import CompactTable from './CompactTable';
import DiagnosisCard from './DiagnosisCard';
import RecommendationCard from './RecommendationCard';
import SeverityMeter from './SeverityMeter';
import TopologyGrid from './TopologyGrid';
import InsightChartCard from '../Chat/ReportComponents/InsightChartCard';

function extractText(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        const p = JSON.parse(s);
        if (typeof p?.text === 'string') return p.text;
        if (typeof p?.bucket === 'string') return p.bucket;
      } catch {}
    }
    return raw;
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as any;
    return o.text || o.bucket || '';
  }
  return String(raw);
}

function CodeView({ code, language }: { code: string; language?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 shadow-sm overflow-hidden">
      <div className="px-4 py-2 text-[11px] font-semibold tracking-wide uppercase text-text-muted dark:text-slate-300 border-b border-slate-200 dark:border-white/10">
        {language || 'code'}
      </div>
      <pre className="p-4 text-xs overflow-auto">
        <code className="whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

function Callout({ tone, title, text }: { tone: 'info' | 'success' | 'warning' | 'error'; title?: string; text: string }) {
  const styles =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100'
        : tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-100'
          : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100';
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${styles}`}>
      {title && <div className="font-semibold mb-1">{title}</div>}
      <div className="whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function RankedList({ title, items, onRowAction }: {
  title?: string;
  items: Array<{ title: string; subtitle?: string; value?: string; severity?: string }>;
  onRowAction?: (action: string, row: any) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/6 shadow-sm overflow-hidden">
      {title && <div className="px-4 py-3 text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">{title}</div>}
      <div className="divide-y divide-slate-100 dark:divide-white/8">
        {items.map((it, idx) => {
          const dot =
            it.severity === 'high'
              ? 'bg-red-500'
              : it.severity === 'med'
                ? 'bg-amber-500'
                : it.severity === 'low'
                  ? 'bg-emerald-500'
                  : 'bg-slate-400';
          const subtitleText = extractText(it.subtitle);
          const valueText = extractText(it.value);
          return (
            <div key={idx} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0 flex items-start gap-3">
                <div className={`mt-1.5 w-2.5 h-2.5 flex-shrink-0 rounded-full ${dot}`} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary dark:text-white truncate">{it.title}</div>
                  {subtitleText && <div className="text-xs text-text-muted dark:text-slate-400 truncate">{subtitleText}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {valueText && !valueText.startsWith('{') && (
                  <div className="text-xs font-semibold text-text-secondary dark:text-slate-200 whitespace-nowrap">{valueText}</div>
                )}
                {onRowAction && (
                  <button
                    type="button"
                    onClick={() => onRowAction('explain-rca', it)}
                    className="rounded px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                    style={{ background: '#2563eb' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
                  >
                    Explain RCA
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-4 py-2 text-[11px] text-text-muted border-t border-slate-100 dark:border-white/8">{items.length} site{items.length !== 1 ? 's' : ''}</p>
    </div>
  );
}

function StatRow({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 shadow-sm">
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((it, idx) => (
          <div key={idx} className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wide uppercase text-text-muted dark:text-slate-300 truncate" title={it.hint || it.label}>
              {it.label}
            </div>
            <div className="text-sm font-semibold text-text-primary dark:text-white truncate" title={it.value}>
              {it.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chips({ chips, prompt }: { chips: Array<{ label: string; value: string; description?: string }>; prompt?: string }) {
  const hasDescriptions = chips.some((c) => c.description);
  return (
    <div className="space-y-2">
      {prompt && (
        <div className="text-xs text-text-secondary dark:text-slate-300">{prompt}</div>
      )}
      <div className={hasDescriptions ? 'flex flex-col gap-2' : 'flex flex-wrap gap-2'}>
        {chips.map((c, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => emitChip(c.value)}
            className={
              hasDescriptions
                ? 'text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-slate-200/80 dark:border-white/15 bg-white/80 dark:bg-white/6 text-text-secondary dark:text-slate-100 hover:bg-white dark:hover:bg-white/10 transition'
                : 'px-3.5 py-2 rounded-full text-xs font-semibold border border-slate-200/80 dark:border-white/15 bg-white/80 dark:bg-white/6 text-text-secondary dark:text-slate-100 hover:bg-white dark:hover:bg-white/10 transition'
            }
            title={c.value}
          >
            <span className="font-mono">{c.label}</span>
            {c.description && (
              <span className="block text-[11px] font-normal text-text-muted dark:text-slate-400 mt-0.5">{c.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      {(title || description) && (
        <div>
          {title && <div className="text-sm font-bold text-text-primary dark:text-white">{title}</div>}
          {description && <div className="text-xs text-text-secondary dark:text-slate-300 mt-0.5">{description}</div>}
        </div>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function GridLayout({ columns = 2, blocks }: { columns?: number; blocks: Array<{ span?: number; block: UiBlock }> }) {
  const cols = Math.max(1, Math.min(4, Number(columns || 2)));
  return (
    <div className={`grid gap-3 grid-cols-1 ${cols === 2 ? 'md:grid-cols-2' : cols === 3 ? 'md:grid-cols-3' : cols === 4 ? 'md:grid-cols-4' : ''}`}>
      {blocks.map((b, idx) => (
        <div key={idx} className={b.span && cols > 1 ? `md:col-span-${Math.min(cols, b.span)}` : ''}>
          <UiBlockRenderer block={b.block} />
        </div>
      ))}
    </div>
  );
}

function Tabs({ tabs }: { tabs: Array<{ id: string; label: string; blocks: UiBlock[] }> }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const active = useMemo(() => tabs.find((t) => t.id === activeId) || tabs[0], [tabs, activeId]);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 shadow-sm overflow-hidden">
      <div className="px-3 py-2 flex gap-2 border-b border-slate-200 dark:border-white/10">
        {tabs.map((t) => {
          const isActive = t.id === active?.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                isActive
                  ? 'bg-slate-900 text-white dark:bg-white/20 dark:text-white'
                  : 'text-text-secondary hover:text-slate-900 dark:text-white/60 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="p-3 space-y-3">
        {active?.blocks.map((b, idx) => (
          <UiBlockRenderer key={b.id || `${b.type}_${idx}`} block={b} />
        ))}
      </div>
    </div>
  );
}

function UiBlockRenderer({ block }: { block: UiBlock }) {
  if (block.type === 'text') {
    return <div className="text-sm text-text-primary dark:text-slate-100 whitespace-pre-wrap">{block.data.text}</div>;
  }
  if (block.type === 'callout') {
    return <Callout tone={block.data.tone} title={block.data.title} text={block.data.text} />;
  }
  if (block.type === 'chips') {
    // Conversation-builder chips carry structured `needs` per chip — route to
    // the FollowupChips component which expands an inline form when needed.
    const variant = (block.data as any)?.variant;
    const chips = (block.data as any)?.chips ?? [];
    const hasStructured =
      variant === 'followups' ||
      chips.some((c: any) => Array.isArray(c?.needs) && c.needs.length > 0);
    if (hasStructured) {
      return (
        <FollowupChips
          chips={chips as FollowupChip[]}
          prompt={block.data.prompt}
        />
      );
    }
    return <Chips chips={block.data.chips} prompt={block.data.prompt} />;
  }
  if (block.type === 'stat_row') {
    return <StatRow items={block.data.items} />;
  }
  if (block.type === 'data_table') {
    // Skip the per-row "Explain RCA" button when the producer flagged the table as
    // single-USID context (parameter changes, topology, RET, etc.) — Explain only
    // makes sense when the table lists multiple sites the user might investigate.
    const disableRowActions = Boolean(block.data?.disableRowActions);
    const handleRowAction = disableRowActions
      ? undefined
      : (action: string, row: Record<string, any>) => {
          if (action === 'explain-rca') {
            const siteId = row.USID || row.Site || row['Site ID'] || row['siteId'] || '';
            if (siteId) emitChip(`Explain RCA for site ${siteId}`);
          }
        };
    return <InteractiveGridTable title={block.data.title || block.title || 'Table'} rows={block.data.rows} showSelection={false} rowTooltipField={block.data.rowTooltipField} onRowAction={handleRowAction} />;
  }
  if (block.type === 'compact_table') {
    return (
      <CompactTable
        title={block.data.title || block.title}
        subtitle={block.data.subtitle}
        rows={block.data.rows}
        columnOrder={block.data.columnOrder}
        columnHints={block.data.columnHints}
        maxHeight={block.data.maxHeight}
      />
    );
  }
  if (block.type === 'diagnosis_card') {
    return <DiagnosisCard synthesis={block.data.synthesis} context={block.data.context} />;
  }
  if (block.type === 'recommendation_card') {
    const d = block.data as any;
    return <RecommendationCard siteId={d.siteId} date={d.date} plan={d.plan} />;
  }
  if (block.type === 'severity_meter') {
    return (
      <SeverityMeter
        title={block.data.title || block.title}
        subtitle={block.data.subtitle}
        rows={block.data.rows}
        max={block.data.max}
        total={block.data.total}
      />
    );
  }
  if (block.type === 'topology_grid') {
    return (
      <TopologyGrid
        title={block.data.title || block.title}
        subtitle={block.data.subtitle}
        cells={block.data.cells}
        meta={block.data.meta}
      />
    );
  }
  if (block.type === 'ranked_list') {
    const handleRankedAction = (action: string, row: any) => {
      if (action === 'explain-rca') {
        const siteId = row.title || row.USID || row.Site || '';
        if (siteId) emitChip(`Explain RCA for site ${siteId}`);
      }
    };
    return <RankedList title={block.data.title || block.title} items={block.data.items} onRowAction={handleRankedAction} />;
  }
  if (block.type === 'section') {
    return <Section title={block.title} description={block.data.description}>{block.data.blocks.map((b, idx) => <UiBlockRenderer key={b.id || `${b.type}_${idx}`} block={b} />)}</Section>;
  }
  if (block.type === 'grid_layout') {
    return <GridLayout columns={block.data.columns} blocks={block.data.blocks} />;
  }
  if (block.type === 'tabs') {
    return <Tabs tabs={block.data.tabs} />;
  }
  if (block.type === 'map_inset') {
    const sites = Array.isArray((block.data as any)?.sites) ? (block.data as any).sites : (Array.isArray(block.data) ? block.data : []);
    return <InlineMap sites={sites} height={280} interactive={true} />;
  }
  if (block.type === 'rca_story') {
    return <RcaSiteStoryCard data={block.data} onChoiceClick={() => {}} />;
  }
  if (block.type === 'rca_summary' || block.type === 'rca_report') {
    return <RcaReportCard data={block.data as any} />;
  }
  if (block.type === 'ticket_escalation') {
    return <TicketEscalationCard data={block.data} />;
  }
  if (block.type === 'execution_status') {
    return <WorkflowExecutionStatus status={block.data as any} />;
  }
  if (block.type === 'kpi_dashboard') {
    const d = block.data as any;
    return (
      <ChatKpiDashboard
        siteId={d.siteId}
        availableSiteIds={d.availableSiteIds}
        kpiNames={d.kpiNames}
        timeframe={d.timeframe ?? 'daily'}
        daysBack={d.daysBack ?? 30}
        endDate={d.endDate}
        collapseAfterGroups={d.collapseAfterGroups}
      />
    );
  }
  if (block.type === 'code_view') {
    return <CodeView language={(block.data as any).language || 'text'} code={(block.data as any).code || ''} />;
  }
  if (block.type === 'insight_chart') {
    return <InsightChartCard data={block.data as any} />;
  }
  return null;
}

/**
 * Group adjacent `compact_table` blocks into 2-column rows so the page reads
 * denser. Other block types render full-width. A compact table is "pairable"
 * if it has a small column count (≤ 4) and ≤ 30 rows — wider/longer tables
 * keep their full width so they remain readable.
 */
function isPairableCompactTable(block: UiBlock): boolean {
  if (block.type !== 'compact_table') return false;
  const rows: any[] = (block.data as any)?.rows || [];
  if (!rows.length) return true;
  const cols = (block.data as any)?.columnOrder || Object.keys(rows[0] || {}).filter((k) => !k.startsWith('__'));
  return rows.length <= 30 && cols.length <= 4;
}

/**
 * If the agent emitted multiple `kpi_dashboard` blocks (typically one per
 * site), collapse them into a single block with a USID switcher. Long lists
 * of stacked dashboards take up too much vertical space; one dashboard with
 * a switcher is what the user actually wants.
 */
function collapseKpiDashboards(blocks: UiBlock[]): UiBlock[] {
  let firstIdx = -1;
  let count = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]?.type === 'kpi_dashboard') {
      if (firstIdx < 0) firstIdx = i;
      count += 1;
    }
  }
  if (count <= 1) return blocks;

  // Merge all kpi_dashboard blocks into one — siteId from the first block,
  // availableSiteIds = union of all siteIds across blocks, kpiNames = union.
  const dashboards = blocks.filter((b) => b.type === 'kpi_dashboard');
  const first: any = dashboards[0].data ?? {};
  const allSites: string[] = [];
  const allKpis: string[] = [];
  for (const d of dashboards) {
    const data: any = d.data ?? {};
    if (data.siteId && !allSites.includes(data.siteId)) allSites.push(data.siteId);
    if (Array.isArray(data.availableSiteIds)) {
      for (const s of data.availableSiteIds) if (s && !allSites.includes(s)) allSites.push(s);
    }
    if (Array.isArray(data.kpiNames)) {
      for (const k of data.kpiNames) if (k && !allKpis.includes(k)) allKpis.push(k);
    }
  }
  const merged: UiBlock = {
    ...dashboards[0],
    data: {
      ...first,
      siteId: first.siteId ?? allSites[0],
      availableSiteIds: allSites.length > 1 ? allSites : undefined,
      kpiNames: allKpis.length ? allKpis : first.kpiNames,
    },
  };

  // Re-insert the merged dashboard at the position of the FIRST dashboard
  // and strip the rest. Preserves the ordering of all non-dashboard blocks.
  const out: UiBlock[] = [];
  let placed = false;
  for (const b of blocks) {
    if (b.type === 'kpi_dashboard') {
      if (!placed) {
        out.push(merged);
        placed = true;
      }
      // Skip subsequent dashboards
    } else {
      out.push(b);
    }
  }
  return out;
}

export default function UiBlocksRenderer({ blocks }: { blocks: UiBlock[] }) {
  // Pre-pass: collapse any stacked `kpi_dashboard` blocks into a single one.
  // This is the user-visible "I want one dashboard, not N" guarantee even if
  // the agent slips up and emits multiple.
  const collapsed = collapseKpiDashboards(blocks);

  // Walk the blocks list and emit either:
  //  - a single full-width block, or
  //  - a 2-col row when two pairable compact tables are adjacent
  const grouped: Array<{ kind: 'single'; block: UiBlock } | { kind: 'pair'; blocks: [UiBlock, UiBlock] }> = [];
  for (let i = 0; i < collapsed.length; i++) {
    const cur = collapsed[i];
    const next = collapsed[i + 1];
    if (cur && next && isPairableCompactTable(cur) && isPairableCompactTable(next)) {
      grouped.push({ kind: 'pair', blocks: [cur, next] });
      i += 1;
    } else {
      grouped.push({ kind: 'single', block: cur });
    }
  }
  return (
    <div className="space-y-3">
      {grouped.map((g, idx) => {
        if (g.kind === 'pair') {
          return (
            <div key={`pair_${idx}`} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {g.blocks.map((b, j) => (
                <UiBlockRenderer key={b.id || `${b.type}_${idx}_${j}`} block={b} />
              ))}
            </div>
          );
        }
        const b = g.block;
        return <UiBlockRenderer key={b.id || `${b.type}_${idx}`} block={b} />;
      })}
    </div>
  );
}
