import { lazy, Suspense, useState } from 'react'
import { Radio, TerminalIcon } from 'lucide-react'
import { Terminal } from '../Terminal'
import { WorkspaceLoadingState } from './WorkspaceLoadingState'

const PreviewPanel = lazy(() =>
  import('../PreviewPanel').then((module) => ({ default: module.PreviewPanel }))
)

export function RuntimeTabsPanel({ projectName }: { projectName: string }) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'preview'>('terminal')

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex flex-shrink-0 items-center border-b border-border bg-bg-secondary"
        style={{ height: 32 }}
      >
        <button
          onClick={() => setActiveTab('terminal')}
          className={`flex h-full items-center gap-1.5 border-r border-border px-3 text-xs transition-colors ${
            activeTab === 'terminal'
              ? 'bg-bg-primary text-text-primary border-b-2 border-b-accent'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <TerminalIcon className="h-3 w-3" />
          Terminal
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex h-full items-center gap-1.5 px-3 text-xs transition-colors ${
            activeTab === 'preview'
              ? 'bg-bg-primary text-text-primary border-b-2 border-b-accent'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <Radio className="h-3 w-3" />
          Preview
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div className={`absolute inset-0 ${activeTab === 'terminal' ? '' : 'invisible'}`}>
          <Terminal sessionId={projectName} />
        </div>
        <div className={`absolute inset-0 ${activeTab === 'preview' ? '' : 'invisible'}`}>
          <Suspense fallback={<WorkspaceLoadingState label="Loading preview" />}>
            <PreviewPanel sessionId={projectName} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
