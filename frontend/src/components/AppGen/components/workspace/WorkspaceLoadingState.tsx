import { Loader2 } from 'lucide-react'

export function WorkspaceLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,_rgba(248,250,252,0.92)_0%,_rgba(255,255,255,0.98)_100%)]">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-cream-surface px-4 py-3 text-sm text-text-secondary shadow-aira-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
    </div>
  )
}
