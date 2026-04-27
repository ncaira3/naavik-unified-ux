/**
 * SavedDashboardsPanel — lists all saved KPI dashboards.
 * Rendered inline in the chat as a visualization card when user asks
 * "show my dashboards" / "open saved dashboards".
 */
import { useState } from 'react';
import {
  Bookmark, BarChart2, Clock, Calendar, Trash2,
  ChevronRight, LayoutDashboard, Plus, Database,
} from 'lucide-react';
import { useSavedDashboards, type SavedDashboard } from '../../../hooks/useSavedDashboards';
import { useSavedQueryDashboards, type SavedQueryDashboard } from '../../../hooks/useSavedQueryDashboards';
import { useTheme } from '../../../context/ThemeContext';
import { KPI_MAP } from './ChatKpiDashboard';

interface SavedDashboardsPanelProps {
  onOpen: (dashboard: SavedDashboard) => void;
  onOpenQueryDashboard?: (dashboard: SavedQueryDashboard) => void;
  onCreateNew?: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SavedDashboardsPanel({ onOpen, onOpenQueryDashboard, onCreateNew }: SavedDashboardsPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { dashboards, deleteDashboard } = useSavedDashboards();
  const { dashboards: queryDashboards, remove: removeQueryDashboard } = useSavedQueryDashboards();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteQuery, setConfirmDeleteQuery] = useState<string | null>(null);

  const border   = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.14)';
  const surface  = isDark ? 'rgba(28,28,30,0.96)' : 'rgba(248,250,252,0.98)';
  const cardBg   = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.03)';
  const text     = isDark ? '#e2e8f0' : '#0f172a';
  const muted    = isDark ? '#94a3b8' : '#64748b';

  return (
    <div
      className="w-full rounded-xl overflow-hidden border"
      style={{ background: surface, borderColor: border }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: border }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <LayoutDashboard className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: text }}>Saved Dashboards</div>
            <div className="text-[11px]" style={{ color: muted }}>{dashboards.length + queryDashboards.length} saved</div>
          </div>
        </div>
        {onCreateNew && (
          <button
            onClick={onCreateNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-500/20 border border-indigo-500/40 text-cyan-300 hover:bg-indigo-500/30 transition-colors"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        )}
      </div>

      {/* Empty state */}
      {dashboards.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
            <Bookmark className="w-6 h-6" style={{ color: muted }} />
          </div>
          <p className="text-sm font-medium" style={{ color: muted }}>No saved dashboards yet</p>
          <p className="text-[11px] text-center max-w-xs" style={{ color: muted }}>
            Create a KPI dashboard in chat and click <strong style={{ color: isDark ? '#a5b4fc' : '#4f46e5' }}>Save</strong> to pin it here.
          </p>
        </div>
      )}

      {/* Dashboard list */}
      {dashboards.length > 0 && (
        <div className="p-3 space-y-2">
          {dashboards.map((db) => {
            const kpiLabel = db.kpiNames.length === 0
              ? 'Standard KPIs'
              : db.kpiNames.length <= 3
                ? db.kpiNames.map((n) => KPI_MAP[n]?.label || n).join(', ')
                : `${db.kpiNames.length} KPIs`;
            const isDeleting = confirmDelete === db.id;

            return (
              <div
                key={db.id}
                className="rounded-xl border overflow-hidden transition-colors"
                style={{ background: cardBg, borderColor: border }}
              >
                <div className="flex items-start gap-3 px-3 py-3">
                  {/* Icon */}
                  <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5" style={{ background: 'rgba(99,102,241,0.15)' }}>
                    <BarChart2 className="w-4 h-4 text-cyan-400" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: text }}>{db.name}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      <span className="text-[11px]" style={{ color: muted }}>
                        Sites: <span style={{ color: isDark ? '#c7d2fe' : '#4338ca' }}>{db.siteIds.join(', ')}</span>
                      </span>
                      <span className="flex items-center gap-1 text-[11px]" style={{ color: muted }}>
                        {db.timeframe === 'daily' ? <Calendar className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {db.timeframe === 'daily' ? `${db.daysBack}d daily` : `${db.daysBack}h hourly`}
                      </span>
                      <span className="text-[11px]" style={{ color: muted }}>ending {db.endDate}</span>
                    </div>
                    <div className="text-[11px] mt-0.5 truncate" style={{ color: muted }}>{kpiLabel}</div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px]" style={{ color: muted }}>{timeAgo(db.updatedAt)}</span>
                    {isDeleting ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { deleteDashboard(db.id); setConfirmDelete(null); }}
                          className="px-2 py-1 rounded-md text-[10px] font-bold bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors hover:opacity-70"
                          style={{ borderColor: border, color: muted }}
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(db.id)}
                        className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500/15 transition-colors opacity-40 hover:opacity-100"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    )}
                    <button
                      onClick={() => onOpen(db)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors hover:opacity-80"
                      style={{ background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.35)', color: '#818cf8' }}
                    >
                      Open <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Custom / Query Dashboards ── */}
      {queryDashboards.length > 0 && (
        <div className="p-3 space-y-2" style={{ borderTop: dashboards.length > 0 ? `1px solid ${border}` : undefined }}>
          <div className="flex items-center gap-1.5 px-1 pb-1">
            <Database className="w-3 h-3" style={{ color: muted }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: muted }}>Custom Dashboards</span>
          </div>
          {queryDashboards.map((qdb) => {
            const chartCount = qdb.blocks.filter((b: any) => b.type === 'insight_chart').length;
            const tableCount = qdb.blocks.filter((b: any) => b.type === 'data_table').length;
            const isDeleting = confirmDeleteQuery === qdb.id;
            return (
              <div
                key={qdb.id}
                className="rounded-xl border overflow-hidden transition-colors"
                style={{ background: cardBg, borderColor: border }}
              >
                <div className="flex items-start gap-3 px-3 py-3">
                  <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5" style={{ background: 'rgba(20,184,166,0.15)' }}>
                    <Database className="w-4 h-4 text-teal-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate" style={{ color: text }}>{qdb.name}</div>
                    <div className="flex flex-wrap gap-x-3 mt-0.5">
                      {chartCount > 0 && <span className="text-[11px]" style={{ color: muted }}>{chartCount} chart{chartCount > 1 ? 's' : ''}</span>}
                      {tableCount > 0 && <span className="text-[11px]" style={{ color: muted }}>{tableCount} table{tableCount > 1 ? 's' : ''}</span>}
                      <span className="text-[11px]" style={{ color: muted }}>{qdb.blocks.length} block{qdb.blocks.length > 1 ? 's' : ''}</span>
                    </div>
                    {qdb.prompt && (
                      <div className="text-[11px] mt-0.5 truncate italic" style={{ color: muted }}>"{qdb.prompt.slice(0, 60)}{qdb.prompt.length > 60 ? '…' : ''}"</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px]" style={{ color: muted }}>{timeAgo(qdb.updatedAt)}</span>
                    {isDeleting ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { removeQueryDashboard(qdb.id); setConfirmDeleteQuery(null); }}
                          className="px-2 py-1 rounded-md text-[10px] font-bold bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors"
                        >Delete</button>
                        <button
                          onClick={() => setConfirmDeleteQuery(null)}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors hover:opacity-70"
                          style={{ borderColor: border, color: muted }}
                        >Keep</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteQuery(qdb.id)}
                        className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500/15 transition-colors opacity-40 hover:opacity-100"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    )}
                    <button
                      onClick={() => onOpenQueryDashboard?.(qdb)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors hover:opacity-80"
                      style={{ background: 'rgba(20,184,166,0.12)', borderColor: 'rgba(20,184,166,0.35)', color: '#2dd4bf' }}
                    >
                      Open <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
