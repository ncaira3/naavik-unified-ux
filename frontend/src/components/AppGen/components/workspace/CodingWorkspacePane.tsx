import { Panel, Group, Separator } from 'react-resizable-panels'
import { FileTree } from '../FileTree'
import { CodeEditor } from '../CodeEditor'
import { StageCard } from './StagePrimitives'
import { RuntimeTabsPanel } from './RuntimeTabsPanel'

function CodingWorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.08),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.92)_0%,_rgba(255,255,255,0.98)_100%)]">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

interface CodingWorkspacePaneProps {
  projectName: string
  fileTree: React.ComponentProps<typeof FileTree>['tree']
  selectedFile: string | null
  fileContent: string
  readOnly?: boolean
  onFileSelect: (path: string) => void
  onCreateFile: (path: string, content?: string) => Promise<void>
  onCreateDirectory: (path: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
  onRenameFile: (oldPath: string, newPath: string) => Promise<void>
  onFileContentChange: (content: string) => void
  onFileSave: () => Promise<void>
}

export function CodingWorkspacePane({
  projectName,
  fileTree,
  selectedFile,
  fileContent,
  readOnly = false,
  onFileSelect,
  onCreateFile,
  onCreateDirectory,
  onDeleteFile,
  onRenameFile,
  onFileContentChange,
  onFileSave,
}: CodingWorkspacePaneProps) {
  return (
    <CodingWorkspaceShell>
      <Group
        orientation="horizontal"
        className="h-full flex-1"
      >
        <Panel defaultSize={28} minSize={18} maxSize={38}>
          <StageCard flat eyebrow="Project Files" title="Workspace tree">
            <div className="h-full min-h-0 overflow-hidden">
              <FileTree
                tree={fileTree}
                selectedFile={selectedFile}
                onFileSelect={onFileSelect}
                onCreateFile={readOnly ? undefined : onCreateFile}
                onCreateDirectory={readOnly ? undefined : onCreateDirectory}
                onDeleteFile={readOnly ? undefined : onDeleteFile}
                onRenameFile={readOnly ? undefined : onRenameFile}
              />
            </div>
          </StageCard>
        </Panel>

        <Separator className="w-1 cursor-col-resize rounded-full bg-cream-surface-light transition-colors hover:bg-sky-300" />

        <Panel defaultSize={72}>
          <Group
            orientation="vertical"
            className="h-full"
          >
            <Panel defaultSize={64} minSize={30}>
              <StageCard
                flat
                eyebrow="Editor"
                title={selectedFile ? 'File editor' : 'Select a file to inspect or edit'}
                actions={
                  selectedFile ? (
                    <span className="max-w-[320px] truncate rounded-full bg-cream-surface-light px-3 py-1 font-mono text-xs font-medium text-text-secondary">
                      {selectedFile}
                    </span>
                  ) : undefined
                }
              >
                <div className="h-full min-h-0 overflow-hidden">
                  <CodeEditor
                    content={fileContent}
                    filePath={selectedFile}
                    onChange={onFileContentChange}
                    onSave={onFileSave}
                    readOnly={readOnly}
                  />
                </div>
              </StageCard>
            </Panel>

            <Separator className="my-3 h-1 cursor-row-resize rounded-full bg-cream-surface-light transition-colors hover:bg-sky-300" />

            <Panel defaultSize={36} minSize={20}>
              <StageCard flat eyebrow="Runtime" title="Terminal and preview">
                <div className="h-full min-h-0 overflow-hidden">
                  <RuntimeTabsPanel projectName={projectName} />
                </div>
              </StageCard>
            </Panel>
          </Group>
        </Panel>
      </Group>
    </CodingWorkspaceShell>
  )
}
