export function StageJumpDialog({
  pendingStageJump,
  workflowMutating,
  onCancel,
  onConfirm,
}: {
  pendingStageJump: { target: string; invalidated: string[] } | null
  workflowMutating: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!pendingStageJump) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-cream-surface p-5 shadow-xl">
        <h3 className="text-base font-semibold text-text-primary">Confirm Stage Jump</h3>
        <p className="mt-2 text-sm text-text-secondary">
          Switching back to{' '}
          <span className="font-semibold">{pendingStageJump.target.replace(/_/g, ' ')}</span>{' '}
          will mark downstream stages as stale.
        </p>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">Stages to invalidate</p>
          <ul className="mt-1 space-y-1">
            {pendingStageJump.invalidated.map((stage) => (
              <li key={stage} className="text-xs text-amber-800">
                • {stage.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={workflowMutating}
            className="rounded-lg bg-ui-btn px-3 py-1.5 text-sm font-medium text-ui-btn-fg hover:bg-ui-btn-hover disabled:opacity-60"
          >
            Confirm Jump
          </button>
        </div>
      </div>
    </div>
  )
}
