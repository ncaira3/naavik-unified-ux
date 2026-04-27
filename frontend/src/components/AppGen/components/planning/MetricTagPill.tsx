import { useState, useRef, useEffect, useCallback } from 'react'
import { useBlockNoteEditor } from '@blocknote/react'

interface MetricTagPillProps {
  metricType: string
  ioc: string
  metric: string
  updateInlineContent?: (update: {
    type: 'metricTag'
    props?: { metricType?: string; ioc?: string; metric?: string }
  }) => void
}

interface DropdownItem {
  label: string
  secondary?: string
  value: string
  group?: string
}

const METRIC_TYPES = ['PM', 'CM', 'KPI'] as const

export function MetricTagPill({
  metricType,
  ioc,
  metric,
  updateInlineContent,
}: MetricTagPillProps) {
  const editor = useBlockNoteEditor()
  const editable = editor?.isEditable ?? false
  const [openDropdown, setOpenDropdown] = useState<'type' | 'ioc' | 'metric' | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleIocSelect = useCallback(
    (value: string) => {
      setOpenDropdown(null)
      updateInlineContent?.({
        type: 'metricTag',
        props: { ioc: value, metric: '' },
      })
    },
    [updateInlineContent],
  )

  const handleTypeSelect = useCallback(
    (value: string) => {
      setOpenDropdown(null)
      updateInlineContent?.({ type: 'metricTag', props: { metricType: value } })
    },
    [updateInlineContent],
  )

  const handleMetricSelect = useCallback(
    (value: string, newType?: string) => {
      setOpenDropdown(null)
      const props: { metric: string; metricType?: string } = { metric: value }
      if (newType) props.metricType = newType
      updateInlineContent?.({ type: 'metricTag', props })
    },
    [updateInlineContent],
  )

  return (
    <span
      ref={ref}
      contentEditable={false}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', position: 'relative' }}
    >
      <span style={{ position: 'relative' }}>
        <span
          onClick={editable ? () => setOpenDropdown(openDropdown === 'type' ? null : 'type') : undefined}
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 ${
            editable ? 'cursor-pointer hover:bg-orange-100' : ''
          }`}
        >
          {metricType || 'PM'}
          {editable && <span className="ml-1 text-orange-400 text-[9px]">&#x25BE;</span>}
        </span>
        {openDropdown === 'type' && (
          <div className="absolute left-0 top-full z-50 mt-1 w-20 rounded-lg border border-border bg-cream-surface shadow-lg">
            {METRIC_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => handleTypeSelect(t)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 ${
                  t === metricType ? 'font-semibold text-orange-700 bg-orange-50' : 'text-text-secondary'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </span>

      <span className="text-[11px] text-text-muted select-none">&nbsp;:&nbsp;</span>

      <span style={{ position: 'relative' }}>
        <span
          onClick={editable ? () => setOpenDropdown(openDropdown === 'ioc' ? null : 'ioc') : undefined}
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${
            editable ? 'cursor-pointer hover:bg-emerald-100' : ''
          }`}
        >
          {ioc || <span className="text-emerald-400 italic">select IOC</span>}
          {editable && <span className="ml-1 text-emerald-400 text-[9px]">&#x25BE;</span>}
        </span>
        {openDropdown === 'ioc' && (
          <SearchableDropdown
            fetchItems={async () => {
              const { fetchIOCList } = await import('../../hooks/useDataDict')
              return fetchIOCList()
            }}
            onSelect={handleIocSelect}
            onClose={() => setOpenDropdown(null)}
          />
        )}
      </span>

      <span className="text-[11px] text-text-muted select-none">&nbsp;.&nbsp;</span>

      <span style={{ position: 'relative' }}>
        <span
          onClick={editable ? () => setOpenDropdown(openDropdown === 'metric' ? null : 'metric') : undefined}
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 ${
            editable ? 'cursor-pointer hover:bg-blue-100' : ''
          }`}
        >
          {metric || <span className="text-blue-400 italic">select metric</span>}
          {editable && <span className="ml-1 text-blue-400 text-[9px]">&#x25BE;</span>}
        </span>
        {openDropdown === 'metric' && ioc && (
          <SearchableDropdown
            fetchItems={async () => {
              const { fetchMetricsForIOC } = await import('../../hooks/useDataDict')
              return fetchMetricsForIOC(ioc)
            }}
            onSelect={(value, item) => handleMetricSelect(value, item?.group === 'PM/KPI' ? 'PM' : 'CM')}
            onClose={() => setOpenDropdown(null)}
          />
        )}
      </span>
    </span>
  )
}

function SearchableDropdown({
  fetchItems,
  onSelect,
  onClose,
}: {
  fetchItems: () => Promise<DropdownItem[]>
  onSelect: (value: string, item?: DropdownItem) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<DropdownItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchItems()
      .then((data) => { if (!cancelled) { setItems(data); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Failed to load'); setLoading(false) } })
    return () => { cancelled = true }
  }, [fetchItems])

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = search
    ? items.filter((item) =>
        item.label.toLowerCase().includes(search.toLowerCase()) ||
        (item.secondary?.toLowerCase().includes(search.toLowerCase()))
      )
    : items

  const groups = new Map<string, DropdownItem[]>()
  for (const item of filtered) {
    const g = item.group || ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(item)
  }

  return (
    <div
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-cream-surface shadow-lg"
      style={{ maxHeight: '280px' }}
    >
      <div className="border-b border-border p-1.5">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-blue-300"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            e.stopPropagation()
          }}
        />
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '230px' }}>
        {loading && <div className="px-3 py-2 text-xs text-text-muted">Loading...</div>}
        {error && (
          <div className="px-3 py-2 text-xs text-red-500">
            {error}
            <button onClick={() => { setLoading(true); setError(null); fetchItems().then(setItems).catch(() => setError('Failed')).finally(() => setLoading(false)) }} className="ml-2 underline">Retry</button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-text-muted">No results</div>
        )}
        {!loading && !error && Array.from(groups.entries()).map(([group, groupItems]) => (
          <div key={group}>
            {group && (
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-cream-bg">
                {group}
              </div>
            )}
            {groupItems.map((item) => (
              <button
                key={item.value}
                onClick={() => onSelect(item.value, item)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between"
              >
                <span className="font-medium text-text-primary truncate">{item.label}</span>
                {item.secondary && (
                  <span className="ml-2 text-[10px] text-text-muted shrink-0">{item.secondary}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
