export function StageAdvanceDialog({
  pendingStageAdvance,
  workflowMutating,
  onCancel,
  onConfirm,
}: {
  pendingStageAdvance: { current: string; next: string } | null
  workflowMutating: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!pendingStageAdvance) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-cream-surface p-5 shadow-xl">
        <h3 className="text-base font-semibold text-text-primary">Current Stage Still Running</h3>
        <p className="mt-2 text-sm text-text-secondary">
          The current stage run is still in progress. Advancing now will treat{' '}
          <span className="font-semibold">{pendingStageAdvance.current.replace(/_/g, ' ')}</span>{' '}
          as approved and move the workflow to{' '}
          <span className="font-semibold">{pendingStageAdvance.next.replace(/_/g, ' ')}</span>.
        </p>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">Before you continue</p>
          <p className="mt-1 text-xs text-amber-800">
            Confirm only if the current output is good enough to approve without waiting for the run to finish normally.
            If tests have already run and you have a report (or hit the run limit), you can approve and move on.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-slate-50"
          >
            Keep Running
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={workflowMutating}
            className="rounded-lg bg-ui-btn px-3 py-1.5 text-sm font-medium text-ui-btn-fg hover:bg-ui-btn-hover disabled:opacity-60"
          >
            Approve and Move On
          </button>
        </div>
      </div>
    </div>
  )
}
