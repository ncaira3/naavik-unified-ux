import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
// BlockNote has persistent space/enter issues inside ReactFlow-adjacent panels.
// Using textarea for reliable editing. Metric tags supported via markdown syntax.
import { NODE_TYPE_COLORS } from './specFlowchart'
import { SHADOWS, PANEL_WIDTH, NODE_TYPE_OPTIONS } from './flowchartTokens'

interface FlowchartNodePanelProps {
  nodeId: string
  nodeType: string
  label: string
  content: string
  onClose: () => void
  onUpdateLabel: (label: string) => void
  onUpdateType: (type: string) => void
  onUpdateContent: (content: string) => void
  onDelete: () => void
}

export function FlowchartNodePanel({
  nodeId,
  nodeType,
  label,
  content,
  onClose,
  onUpdateLabel,
  onUpdateType,
  onUpdateContent,
  onDelete,
}: FlowchartNodePanelProps) {
  const palette = NODE_TYPE_COLORS[nodeType] ?? { bg: '#f9fafb', border: '#6b7280' }
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [localLabel, setLocalLabel] = useState(label)

  // Sync when node selection changes
  useEffect(() => {
    setLocalLabel(label)
  }, [nodeId, label])

  const handleLabelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalLabel(e.target.value)
    onUpdateLabel(e.target.value)
  }, [onUpdateLabel])

  const handleDelete = useCallback(() => {
    if (content && content.trim().length > 0) {
      if (!window.confirm('This node has content. Delete it?')) return
    }
    onDelete()
  }, [content, onDelete])

  return (
    <div
      className="flex flex-col border-l border-border bg-cream-surface"
      style={{ width: PANEL_WIDTH, boxShadow: SHADOWS.panel, animation: 'slideInRight 0.3s ease-out' }}
    >
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ background: palette.border }}
          />
          <select
            value={nodeType}
            onChange={(e) => onUpdateType(e.target.value)}
            className="rounded border border-border bg-cream-surface px-2 py-1 text-xs font-medium text-text-secondary outline-none focus:border-blue-300"
          >
            {NODE_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-text-muted hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Label */}
      <div className="border-b border-border px-4 py-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Node Label</label>
        <input
          type="text"
          value={localLabel}
          onChange={handleLabelChange}
          className="nodrag nopan nowheel mt-1 w-full rounded border border-border px-2 py-1.5 text-sm font-semibold text-text-primary outline-none focus:border-blue-300"
          placeholder="Enter label..."
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      {/* Content editor with metric tag insertion */}
      <div className="flex-1 min-h-0 flex flex-col px-4 py-2">
        <div className="relative flex items-center justify-between mb-1 shrink-0">
          <label className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Content</label>
          <MetricInsertButton onInsert={(tag) => {
            const ta = textareaRef.current
            if (!ta) return
            const start = ta.selectionStart
            const end = ta.selectionEnd
            const before = ta.value.slice(0, start)
            const after = ta.value.slice(end)
            const newVal = before + tag + after
            ta.value = newVal
            onUpdateContent(newVal)
            requestAnimationFrame(() => {
              ta.focus()
              ta.selectionStart = ta.selectionEnd = start + tag.length
            })
          }} />
        </div>
        <textarea
          ref={textareaRef}
          className="flex-1 w-full rounded-lg border border-border bg-cream-bg p-3 text-sm text-text-primary outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-100 transition-colors resize-none"
          style={{ minHeight: 100 }}
          placeholder="Add details, notes, or metric references..."
          defaultValue={content || ''}
          onChange={(e) => onUpdateContent(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <button
          onClick={handleDelete}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-cream-surface px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Node
        </button>
      </div>
    </div>
  )
}

/** Compact metric tag insertion button with IOC/metric picker */
function MetricInsertButton({ onInsert }: { onInsert: (tag: string) => void }) {
  const [open, setOpen] = useState(false)
  const [metricType, setMetricType] = useState<string>('PM')
  const [iocList, setIocList] = useState<Array<{ label: string; value: string }>>([])
  const [metricList, setMetricList] = useState<Array<{ label: string; value: string; group?: string }>>([])
  const [selectedIoc, setSelectedIoc] = useState('')
  const [selectedMetric, setSelectedMetric] = useState('')
  const [iocSearch, setIocSearch] = useState('')
  const [metricSearch, setMetricSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Load IOC list when opened
  useEffect(() => {
    if (!open) return
    setLoading(true)
    import('../../hooks/useDataDict').then(mod =>
      mod.fetchIOCList()
    ).then(data => {
      setIocList(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [open])

  // Load metrics when IOC selected
  useEffect(() => {
    if (!selectedIoc) { setMetricList([]); return }
    setLoading(true)
    import('../../hooks/useDataDict').then(mod =>
      mod.fetchMetricsForIOC(selectedIoc)
    ).then(data => {
      setMetricList(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedIoc])

  const handleInsert = () => {
    if (!selectedIoc || !selectedMetric) return
    const tag = `${metricType}: ${selectedIoc}.${selectedMetric}`
    onInsert(tag)
    setOpen(false)
    setSelectedIoc('')
    setSelectedMetric('')
    setIocSearch('')
    setMetricSearch('')
  }

  const filteredIocs = iocSearch
    ? iocList.filter(i => i.label.toLowerCase().includes(iocSearch.toLowerCase()))
    : iocList

  const filteredMetrics = metricSearch
    ? metricList.filter(m => m.label.toLowerCase().includes(metricSearch.toLowerCase()))
    : metricList

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors"
      >
        + Metric
      </button>
    )
  }

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-cream-surface shadow-xl">
      {/* Type selector */}
      <div className="flex gap-1 border-b border-border p-2">
        {['PM', 'CM', 'KPI'].map(t => (
          <button
            key={t}
            onClick={() => setMetricType(t)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              metricType === t ? 'bg-orange-100 text-orange-700' : 'text-text-muted hover:bg-slate-50'
            }`}
          >{t}</button>
        ))}
      </div>

      {/* IOC picker */}
      <div className="border-b border-border p-2">
        <div className="text-[10px] font-medium text-text-muted uppercase mb-1">IOC</div>
        <input
          type="text"
          placeholder="Search IOC..."
          value={selectedIoc || iocSearch}
          onChange={(e) => { setIocSearch(e.target.value); setSelectedIoc(''); setSelectedMetric('') }}
          className="w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-blue-300"
          onKeyDown={(e) => e.stopPropagation()}
        />
        {!selectedIoc && (
          <div className="max-h-40 overflow-y-auto mt-1">
            {loading && <div className="text-[10px] text-text-muted px-1">Loading...</div>}
            {filteredIocs.slice(0, 50).map(ioc => (
              <button
                key={ioc.value}
                onClick={() => { setSelectedIoc(ioc.value); setIocSearch(''); setSelectedMetric('') }}
                className="w-full text-left px-2 py-1 text-xs hover:bg-emerald-50 rounded truncate"
              >{ioc.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Metric picker */}
      {selectedIoc && (
        <div className="border-b border-border p-2">
          <div className="text-[10px] font-medium text-text-muted uppercase mb-1">Metric</div>
          <input
            type="text"
            placeholder="Search metric..."
            value={selectedMetric || metricSearch}
            onChange={(e) => { setMetricSearch(e.target.value); setSelectedMetric('') }}
            className="w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-blue-300"
            onKeyDown={(e) => e.stopPropagation()}
          />
          {!selectedMetric && (
            <div className="max-h-40 overflow-y-auto mt-1">
              {loading && <div className="text-[10px] text-text-muted px-1">Loading...</div>}
              {filteredMetrics.slice(0, 50).map(m => (
                <button
                  key={m.value}
                  onClick={() => { setSelectedMetric(m.value); setMetricSearch('') }}
                  className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50 rounded truncate"
                >{m.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Insert button */}
      <div className="p-2 flex gap-2">
        <button onClick={() => setOpen(false)} className="flex-1 rounded px-2 py-1.5 text-xs text-text-muted hover:bg-slate-50 border border-border">Cancel</button>
        <button
          onClick={handleInsert}
          disabled={!selectedIoc || !selectedMetric}
          className="flex-1 rounded px-2 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
        >Insert</button>
      </div>
    </div>
  )
}
