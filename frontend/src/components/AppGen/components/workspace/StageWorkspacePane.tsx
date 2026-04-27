import { lazy, Suspense } from 'react'
import { CodeEditor } from '../CodeEditor'
import { WorkspaceLoadingState } from './WorkspaceLoadingState'
import type { TestScenario } from '../testValidation/types'
import type { TestArtifactsPayload } from '../StagePanel'

const StagePanel = lazy(() =>
  import('../StagePanel').then((module) => ({ default: module.StagePanel }))
)

interface StageWorkspacePaneProps {
  /** Stage to display in the panel (derived from the selected tab). */
  displayStage: string
  selectedFile: string | null
  fileContent: string
  stageArtifact: Record<string, any> | null
  latestAssistantContent: string
  projectName: string
  testArtifacts: TestArtifactsPayload | null
  readOnly?: boolean
  isAgentBusy: boolean
  isRunningIntegrationTests: boolean
  onBackToReport: () => void
  onFileContentChange: (content: string) => void
  onFileSave: () => Promise<void>
  onRefresh: () => Promise<void>
  onFileSelect: (path: string) => void
  onRunIntegrationTests: (scenario?: TestScenario) => Promise<void>
}

export function StageWorkspacePane({
  displayStage,
  selectedFile,
  fileContent,
  stageArtifact,
  latestAssistantContent,
  projectName,
  testArtifacts,
  readOnly = false,
  isAgentBusy,
  isRunningIntegrationTests,
  onBackToReport,
  onFileContentChange,
  onFileSave,
  onRefresh,
  onFileSelect,
  onRunIntegrationTests,
}: StageWorkspacePaneProps) {
  if (selectedFile) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-bg-tertiary px-3 py-1.5">
          <button
            onClick={onBackToReport}
            className="text-xs font-medium text-accent hover:text-accent-hover"
          >
            ← Back to Report
          </button>
          <span className="truncate font-mono text-xs text-text-muted">{selectedFile}</span>
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor
            content={fileContent}
            filePath={selectedFile}
            onChange={onFileContentChange}
            onSave={onFileSave}
            readOnly={readOnly}
          />
        </div>
      </div>
    )
  }

  return (
    <Suspense fallback={<WorkspaceLoadingState label="Loading stage view" />}>
      <StagePanel
        stage={displayStage}
        artifact={stageArtifact}
        latestAssistantContent={latestAssistantContent}
        sessionId={projectName}
        testArtifacts={testArtifacts}
        onRefresh={onRefresh}
        onFileSelect={onFileSelect}
        onRunIntegrationTests={onRunIntegrationTests}
        isAgentBusy={isAgentBusy}
        isRunningIntegrationTests={isRunningIntegrationTests}
      />
    </Suspense>
  )
}
