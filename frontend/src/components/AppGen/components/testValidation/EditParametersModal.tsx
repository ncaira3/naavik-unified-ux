import { useMemo, useState } from 'react'
import { ListTree, Loader2, RotateCcw, Save, Zap } from 'lucide-react'
import type { TestScenario } from './types'

export function EditParametersModal({
  scenario,
  onClose,
  onRunWithDraft,
  onSaveDefaults,
}: {
  scenario: TestScenario
  onClose: () => void
  onRunWithDraft?: (inputParams: Record<string, number | string | boolean>) => void | Promise<void>
  onSaveDefaults?: (inputParams: Record<string, number | string | boolean>) => void | Promise<void>
}) {
  const initialInputParams = useMemo(
    () => ({ ...(scenario.inputParams as Record<string, number | string | boolean> | undefined) }),
    [scenario.inputParams]
  )
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inputParams, setInputParams] = useState<Record<string, number | string | boolean>>(
    () => ({ ...(scenario.inputParams as Record<string, number | string | boolean>) })
  )

  const inputEntries = Object.entries(inputParams)
  const isDirty = JSON.stringify(inputParams) !== JSON.stringify(initialInputParams)

  const handleRunWithDraft = async () => {
    if (!onRunWithDraft) {
      onClose()
      return
    }
    setRunning(true)
    try {
      await onRunWithDraft(inputParams)
    } finally {
      setRunning(false)
    }
  }

  const handleSaveDefaults = async () => {
    if (!onSaveDefaults) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await onSaveDefaults(inputParams)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-bg-primary shadow-aira-md"
        onClick={event => event.stopPropagation()}
      >
        <div className="border-b border-border px-5 pb-2 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
              <ListTree className="h-4 w-4 text-text-secondary" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-text-primary">Edit {scenario.name}</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Update draft parameters for a single rerun, or save them as the new scenario defaults.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 px-5 py-6">
          {inputEntries.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-text-primary">Input Parameters</h3>
                {isDirty && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    Draft changes
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {inputEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 rounded-md border border-border bg-bg-primary p-2">
                    <label htmlFor={`in-${key}`} className="whitespace-nowrap text-sm font-medium text-text-primary">
                      {key}
                    </label>
                    <input
                      id={`in-${key}`}
                      type={typeof value === 'number' ? 'number' : 'text'}
                      value={String(value)}
                      onChange={event =>
                        setInputParams(prev => ({
                          ...prev,
                          [key]: typeof value === 'number' ? Number(event.target.value) : event.target.value,
                        }))
                      }
                      className="h-8 min-w-[6rem] rounded border border-border bg-bg-primary px-2 text-sm text-text-primary"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {inputEntries.length === 0 && (
            <p className="text-sm text-text-muted">
              No input parameters are defined for this scenario.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 pb-5 pt-3">
          {inputEntries.length > 0 && (
            <>
              <button
                onClick={handleRunWithDraft}
                disabled={running || saving}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Run With Draft
              </button>
              <button
                onClick={handleSaveDefaults}
                disabled={saving || running}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-primary px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-tertiary disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Defaults
              </button>
              <button
                onClick={() => setInputParams({ ...initialInputParams })}
                disabled={!isDirty || saving || running}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-primary px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-tertiary disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-bg-primary px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-tertiary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
