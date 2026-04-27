import { useState, useEffect, useRef } from 'react'
import { fetchIOCList, fetchMetricsForIOC, type DropdownItem } from '../../hooks/useDataDict'

interface MetricTagInsertMenuProps {
  onInsert: (metricType: string, ioc: string, metric: string) => void
  onCancel: () => void
}

type Step = 'type' | 'ioc' | 'metric'

export function MetricTagInsertMenu({ onInsert, onCancel: _onCancel }: MetricTagInsertMenuProps) {
  const [step, setStep] = useState<Step>('type')
  const [metricType, setMetricType] = useState('')
  const [ioc, setIoc] = useState('')

  const handleTypeSelect = (type: string) => {
    setMetricType(type)
    setStep('ioc')
  }

  const handleIOCSelect = (value: string) => {
    setIoc(value)
    setStep('metric')
  }

  const handleMetricSelect = (value: string) => {
    onInsert(metricType, ioc, value)
  }

  return (
    <div className="w-72 rounded-lg border border-border bg-cream-surface shadow-lg p-2">
      {step === 'type' && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-2 py-1">
            Metric Type
          </div>
          <div className="flex gap-1.5 p-1">
            {(['PM', 'CM', 'KPI'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeSelect(t)}
                className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'ioc' && (
        <SearchStep
          title="Select IOC"
          fetchItems={fetchIOCList}
          onSelect={handleIOCSelect}
          onBack={() => setStep('type')}
        />
      )}

      {step === 'metric' && (
        <SearchStep
          title={`Metrics in ${ioc}`}
          fetchItems={() => fetchMetricsForIOC(ioc)}
          onSelect={handleMetricSelect}
          onBack={() => setStep('ioc')}
        />
      )}
    </div>
  )
}

function SearchStep({
  title,
  fetchItems,
  onSelect,
  onBack,
}: {
  title: string
  fetchItems: () => Promise<DropdownItem[]>
  onSelect: (value: string) => void
  onBack: () => void
}) {
  const [items, setItems] = useState<DropdownItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchItems()
      .then((data) => { if (!cancelled) { setItems(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchItems])

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = search
    ? items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()))
    : items

  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1">
        <button onClick={onBack} className="text-[10px] text-blue-500 hover:underline">
          &larr; Back
        </button>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
      </div>
      <input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search..."
        className="w-full rounded border border-border px-2 py-1 text-xs outline-none focus:border-blue-300 my-1"
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="overflow-y-auto max-h-[200px]">
        {loading && <div className="px-2 py-2 text-xs text-text-muted">Loading...</div>}
        {!loading && filtered.length === 0 && <div className="px-2 py-2 text-xs text-text-muted">No results</div>}
        {filtered.map((item) => (
          <button
            key={item.value}
            onClick={() => onSelect(item.value)}
            className="w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 flex justify-between rounded"
          >
            <span className="font-medium text-text-primary truncate">{item.label}</span>
            {item.secondary && <span className="ml-2 text-[10px] text-text-muted">{item.secondary}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
