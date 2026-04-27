import { useState } from 'react'
import { AlertCircle, Wrench } from 'lucide-react'

interface AuditActionCardProps {
  summary: string
  onSendMessage: (msg: string) => void
}

/** Inline action card shown when audit has blocking findings with allow_fix. */
export function AuditActionCard({
  summary,
  onSendMessage,
}: AuditActionCardProps) {
  const [clicked, setClicked] = useState<'fix' | null>(null)

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/50 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/60 border-b border-amber-200">
        <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
        <span className="text-xs font-medium text-amber-800">Action Required</span>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs text-text-primary mb-2.5">{summary}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!clicked) {
                setClicked('fix')
                onSendMessage('fix issues')
              }
            }}
            disabled={clicked !== null}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              clicked === 'fix'
                ? 'bg-blue-200 text-blue-700 cursor-default'
                : clicked !== null
                  ? 'bg-cream-surface-light text-text-muted cursor-default'
                  : 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
            }`}
          >
            <Wrench className="w-3 h-3" />
            {clicked === 'fix' ? 'Requesting fix...' : 'Fix Issues'}
          </button>
        </div>
      </div>
    </div>
  )
}
