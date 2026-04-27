import { lazy, Suspense, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { ChatPanel } from './components/ChatPanel'
import { Header } from './components/Header'
import { useFiles } from './hooks/useFiles'
import { useChat, AgentEvent } from './hooks/useChat'
import { useProjects } from './hooks/useProjects'
import { useStageArtifact } from './hooks/useStageArtifact'
import { useTestAndValidationArtifacts } from './hooks/useTestAndValidationArtifacts'
import { useReachedStages, agentToStageTab } from './hooks/useReachedStages'
import { useWorkflowRun } from './hooks/useWorkflowRun'
import { useWorkspaceStageController } from './hooks/useWorkspaceStageController'
import { useWorkspaceStagePresentation } from './hooks/useWorkspaceStagePresentation'
import { StageTabBar } from './components/StageTabBar'
import { projectsApi, authApi, sessionsApi, setAuthToken, getAuthToken, onUnauthorized } from './lib/api'
import type { TestScenario } from './components/testValidation/types'
import type { StageTabId } from './lib/stages'
import type { PlanningPaneHandle } from './components/PlanningPane'
import { WorkflowTimelinePanel } from './components/WorkflowTimelinePanel'
import { WorkspaceLoadingState } from './components/workspace/WorkspaceLoadingState'
import { CodingWorkspacePane } from './components/workspace/CodingWorkspacePane'
import { StageWorkspacePane } from './components/workspace/StageWorkspacePane'
import { StageAdvanceDialog } from './components/workspace/StageAdvanceDialog'
import { StageJumpDialog } from './components/workspace/StageJumpDialog'

const ProjectsPage = lazy(() => import('./components/ProjectsPage').then((module) => ({ default: module.ProjectsPage })))
const PlanningPane = lazy(() => import('./components/PlanningPane').then((module) => ({ default: module.PlanningPane })))
const LoginPage = lazy(() => import('./components/LoginPage').then((module) => ({ default: module.LoginPage })))

function WorkspaceView({
  projectName,
  onBack,
  username,
  onLogout,
}: {
  projectName: string
  onBack: () => void
  username: string
  onLogout: () => void
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [viewedTab, setViewedTab] = useState<StageTabId>('planning')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [runningIntegrationTests, setRunningIntegrationTests] = useState(false)
  const planningPaneRef = useRef<PlanningPaneHandle>(null)

  const { fileTree, refreshFileTree, readFile, writeFile, createFile, deleteFile, createDirectory } =
    useFiles(projectName)

  const handleRenameFile = useCallback(async (oldPath: string, newPath: string) => {
    try {
      const content = await readFile(oldPath)
      await createFile(newPath, content)
      await deleteFile(oldPath)
      if (selectedFile === oldPath) {
        setSelectedFile(newPath)
      }
    } catch {
      // rename failed — no-op
    }
  }, [readFile, createFile, deleteFile, selectedFile])

  const {
    status: workflowStatus,
    timeline: workflowTimeline,
    workflowContextLoaded,
    loading: workflowLoading,
    mutating: workflowMutating,
    error: workflowError,
    refresh: refreshWorkflow,
    jumpToStage,
    previewJump,
    advanceStage,
    stageSnapshotMap,
    completedStages: workflowCompletedStages,
  } = useWorkflowRun(projectName)

  const persistLastViewedStage = useCallback(
    async (stage: string) => {
      try {
        await sessionsApi.patchState(projectName, { last_viewed_stage: stage })
      } catch {
        // persist failed — non-blocking
      }
    },
    [projectName]
  )

  const { reachedTabs, refresh: refreshReachedStages } = useReachedStages(
    workflowStatus
  )

  const {
    activeAgent,
    availableAgentModes,
    pendingStageJump,
    pendingStageAdvance,
    pendingStageKickoff,
    startBuildFromPlan,
    handleAgentChange,
    confirmPendingJump,
    cancelPendingJump,
    confirmPendingAdvance,
    cancelPendingAdvance,
    handleAdvanceStage,
    clearPendingStageKickoff,
  } = useWorkspaceStageController({
    projectName,
    workflowStatus,
    workflowContextLoaded,
    workflowLoading,
    stageSnapshotMap,
    persistLastViewedStage,
    previewJump,
    jumpToStage,
    advanceStage,
  })

  const workingTab = agentToStageTab(activeAgent)

  const viewedStageAgent = useMemo(() => {
    if (viewedTab === 'test') {
      if (activeAgent === 'testing' || activeAgent === 'unit_testing' || activeAgent === 'integration_validation') {
        return activeAgent
      }
      return workflowStatus?.current_stage === 'testing' ? 'testing' : 'testing'
    }
    return viewedTab
  }, [activeAgent, viewedTab, workflowStatus?.current_stage])

  const isViewingHistoricalTab = viewedTab !== workingTab
  const isViewingPlanningTab = viewedTab === 'planning'
  const isViewingCodeTab = viewedTab === 'code_generation'
  const isViewingTestTab = viewedTab === 'test'

  const { artifact: stageArtifact, refresh: refreshArtifact } =
    useStageArtifact(projectName, viewedStageAgent)
  const testArtifactsHook = useTestAndValidationArtifacts(projectName, isViewingTestTab)
  const testArtifacts = isViewingTestTab
    ? {
        testingArtifact: testArtifactsHook.testingArtifact,
        refresh: testArtifactsHook.refresh,
      }
    : null

  const handleFileChange = useCallback(
    (event: AgentEvent) => {
      refreshFileTree()
      if (selectedFile && event.metadata?.path === selectedFile) {
        readFile(selectedFile).then(setFileContent).catch(() => {})
      }
    },
    [refreshFileTree, selectedFile, readFile]
  )

  const handleResponseComplete = useCallback(() => {
    refreshFileTree()
    refreshReachedStages()
  }, [refreshFileTree, refreshReachedStages])

  const {
    messages,
    isLoading,
    isStalled,
    isConnected,
    error,
    currentEvents,
    pendingClarificationId,
    sendMessage,
    sendClarificationAnswers,
    cancelRequest,
    clearError,
  } = useChat({
    sessionId: projectName,
    agentId: activeAgent,
    onResponseComplete: handleResponseComplete,
    onFileChange: handleFileChange,
  })

  const handlePlanEdited = useCallback(() => {
    sendMessage(
      'The plan has been manually edited and saved by the user. ' +
      'Please read the updated plan with get_spec_document and regenerate the flowchart ' +
      'using set_flowchart to reflect the new plan structure. ' +
      'Do NOT modify the plan text — only update the flowchart.'
    )
  }, [sendMessage])

  const handleFlowchartEdited = useCallback((changes: Array<{ type: string; id: string; old?: string; new?: string; label?: string; node_type?: string; source?: string; target?: string }>) => {
    if (!changes.length) return
    const wireContent = `__FLOWCHART_EDIT__${JSON.stringify({ changes })}`
    const lines = changes.map((c) => {
      switch (c.type) {
        case 'node_added': return `* Added ${c.node_type} node "${c.label}"`
        case 'node_removed': return `* Removed node "${c.label}"`
        case 'node_label_changed': return `* Node "${c.id}": label "${c.old}" -> "${c.new}"`
        case 'node_type_changed': return `* Node "${c.id}": type ${c.old} -> ${c.new}`
        case 'node_content_changed': return `* Node "${c.id}": content updated`
        case 'edge_added': return `* Added edge ${c.source} -> ${c.target}${c.label ? ` (${c.label})` : ''}`
        case 'edge_removed': return `* Removed edge "${c.id}"`
        case 'edge_label_changed': return `* Edge "${c.id}": label "${c.old}" -> "${c.new}"`
        default: return `* ${c.type} on "${c.id}"`
      }
    })
    const displayContent = `I edited the flowchart:\n${lines.join('\n')}`
    sendMessage(wireContent, undefined, displayContent)
  }, [sendMessage])

  const handleFileSelect = useCallback(
    async (path: string) => {
      setSelectedFile(path)
      try {
        const content = await readFile(path)
        setFileContent(content)
      } catch {
        setFileContent('')
      }
    },
    [readFile]
  )

  const handleFileContentChange = useCallback((content: string) => {
    setFileContent(content)
  }, [])

  const handleFileSave = useCallback(async () => {
    if (selectedFile) {
      await writeFile(selectedFile, fileContent)
      refreshFileTree()
    }
  }, [selectedFile, fileContent, writeFile, refreshFileTree])

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([
        refreshFileTree(),
        refreshArtifact(),
        refreshReachedStages(),
        isViewingTestTab ? testArtifactsHook.refresh() : Promise.resolve(),
        planningPaneRef.current?.refresh(),
        refreshWorkflow(),
      ])
    } finally {
      setTimeout(() => setIsRefreshing(false), 600)
    }
  }, [refreshFileTree, refreshArtifact, refreshReachedStages, isViewingTestTab, testArtifactsHook.refresh, refreshWorkflow])

  const handleRunIntegrationTests = useCallback(async (scenario?: TestScenario) => {
    setRunningIntegrationTests(true)
    try {
      await sessionsApi.runTests(
        projectName,
        scenario
          ? {
              scope: 'functional',
              scenario_ids: [scenario.id],
              input_overrides: scenario.inputParams ?? {},
              use_saved_manifest: true,
            }
          : { scope: 'all', use_saved_manifest: true }
      )
      await testArtifactsHook.refresh()
    } catch {
      // integration test run failed — non-blocking
    } finally {
      setRunningIntegrationTests(false)
    }
  }, [projectName, testArtifactsHook])

  const {
    latestAssistantContent,
    tabState,
    stageBadges,
  } = useWorkspaceStagePresentation({
    activeAgent: viewedStageAgent,
    messages,
    stageSnapshotMap,
  })

  useEffect(() => {
    setViewedTab(workingTab)
  }, [projectName, workingTab])

  const handleStageTabSelect = useCallback((tabId: StageTabId) => {
    setViewedTab(tabId)
  }, [])

  useEffect(() => {
    if (!pendingStageKickoff) return
    if (!isConnected || isLoading) return

    sendMessage(pendingStageKickoff)
    clearPendingStageKickoff()
  }, [clearPendingStageKickoff, isConnected, isLoading, pendingStageKickoff, sendMessage])

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-100 via-slate-50 to-white">
      <Header
        projectName={projectName}
        onBack={onBack}
        onRefresh={handleRefreshAll}
        isRefreshing={isRefreshing}
        username={username}
        onLogout={onLogout}
      />

      <Group
        orientation="horizontal"
        className="flex-1 min-h-0"
      >
        <Panel defaultSize={30} minSize={20} maxSize={45} className="min-w-0">
          <div className="h-full overflow-hidden rounded-2xl border border-border bg-cream-surface shadow-aira">
            <ChatPanel
              sessionId={projectName}
              messages={messages}
              isLoading={isLoading}
              isStalled={isStalled}
              isConnected={isConnected}
              error={error}
              currentEvents={currentEvents}
              pendingClarificationId={pendingClarificationId}
              agentId={activeAgent}
              availableAgents={availableAgentModes}
              onAgentChange={handleAgentChange}
              onSendMessage={sendMessage}
              onSendClarification={sendClarificationAnswers}
              onCancel={cancelRequest}
              onDismissError={clearError}
              completedStages={workflowCompletedStages}
              stageBadges={stageBadges}
            />
          </div>
        </Panel>

        <Separator className="w-1 bg-border hover:bg-accent transition-colors cursor-col-resize" />

        <Panel defaultSize={70} minSize={30} className="flex flex-col min-h-0 min-w-0">
          <div className="h-full overflow-hidden rounded-2xl border border-border bg-cream-surface shadow-aira flex flex-col">
            <StageTabBar
              reachedTabs={reachedTabs}
              activeTab={viewedTab}
              onTabSelect={handleStageTabSelect}
              tabState={tabState}
            />
            <WorkflowTimelinePanel
              status={workflowStatus}
              timeline={workflowTimeline}
              loading={workflowLoading}
              mutating={workflowMutating}
              error={workflowError}
              onAdvanceStage={handleAdvanceStage}
            />
            <div className="flex-1 min-h-0 flex flex-col">
              {isViewingHistoricalTab && (
                <div className="border-b border-white/10 bg-white/5 px-4 py-2 text-xs text-text-secondary dark:text-slate-300">
                  Viewing {viewedTab.replace(/_/g, ' ')} output only. This does not change the workflow stage or invalidate downstream work.
                </div>
              )}
              {isViewingPlanningTab ? (
                <Suspense fallback={<WorkspaceLoadingState label="Loading planning workspace" />}>
                  <PlanningPane
                    ref={planningPaneRef}
                    sessionId={projectName}
                    onBuildApplication={startBuildFromPlan}
                    isAgentBusy={isLoading}
                    onPlanEdited={handlePlanEdited}
                    onFlowchartEdited={handleFlowchartEdited}
                    readOnly={isViewingHistoricalTab}
                  />
                </Suspense>
              ) : isViewingCodeTab ? (
                <CodingWorkspacePane
                  projectName={projectName}
                  fileTree={fileTree}
                  selectedFile={selectedFile}
                  fileContent={fileContent}
                  readOnly={isViewingHistoricalTab}
                  onFileSelect={handleFileSelect}
                  onCreateFile={createFile}
                  onCreateDirectory={createDirectory}
                  onDeleteFile={deleteFile}
                  onRenameFile={handleRenameFile}
                  onFileContentChange={handleFileContentChange}
                  onFileSave={handleFileSave}
                />
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <StageWorkspacePane
                    displayStage={viewedStageAgent}
                    selectedFile={selectedFile}
                    fileContent={fileContent}
                    stageArtifact={stageArtifact}
                    latestAssistantContent={latestAssistantContent}
                    projectName={projectName}
                    testArtifacts={testArtifacts}
                    readOnly={isViewingHistoricalTab}
                    isAgentBusy={isLoading || runningIntegrationTests}
                    isRunningIntegrationTests={runningIntegrationTests}
                    onBackToReport={() => setSelectedFile(null)}
                    onFileContentChange={handleFileContentChange}
                    onFileSave={handleFileSave}
                    onRefresh={refreshArtifact}
                    onFileSelect={handleFileSelect}
                    onRunIntegrationTests={handleRunIntegrationTests}
                  />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </Group>

      <StageJumpDialog
        pendingStageJump={pendingStageJump}
        workflowMutating={workflowMutating}
        onCancel={cancelPendingJump}
        onConfirm={confirmPendingJump}
      />
      <StageAdvanceDialog
        pendingStageAdvance={pendingStageAdvance}
        workflowMutating={workflowMutating}
        onCancel={cancelPendingAdvance}
        onConfirm={confirmPendingAdvance}
      />
    </div>
  )
}

/** Authenticated shell — only mounts after user is logged in. */
export function AuthenticatedApp({
  username,
  onLogout,
}: {
  username: string
  onLogout: () => void
}) {
  const [currentProject, setCurrentProject] = useState<string | null>(null)

  const {
    projects,
    isLoading: projectsLoading,
    createProject,
    deleteProject,
    loadProjects,
  } = useProjects()

  const handleSelectProject = useCallback(async (name: string) => {
    try {
      await projectsApi.select(name)
      setCurrentProject(name)
    } catch {
      // select failed — no-op
    }
  }, [])

  const handleCreateProject = useCallback(
    async (name: string, description?: string) => {
      await createProject(name, description)
    },
    [createProject]
  )

  const handleDeleteProject = useCallback(
    async (name: string) => {
      await deleteProject(name)
    },
    [deleteProject]
  )

  const handleBack = useCallback(() => {
    setCurrentProject(null)
    loadProjects()
  }, [loadProjects])

  if (!currentProject) {
    return (
      <Suspense fallback={<WorkspaceLoadingState label="Loading projects" />}>
        <ProjectsPage
          projects={projects}
          isLoading={projectsLoading}
          onCreateProject={handleCreateProject}
          onSelectProject={handleSelectProject}
          onDeleteProject={handleDeleteProject}
          username={username}
          onLogout={onLogout}
        />
      </Suspense>
    )
  }

  return (
    <WorkspaceView
      key={currentProject}
      projectName={currentProject}
      onBack={handleBack}
      username={username}
      onLogout={onLogout}
    />
  )
}

function App() {
  const [user, setUser] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  // Sync theme from parent window via postMessage
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'NAAVIK_THEME') {
        document.documentElement.classList.toggle('dark', e.data.theme === 'dark')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Check for existing token on mount
  useEffect(() => {
    const token = getAuthToken()
    if (token) {
      authApi.me()
        .then((data) => {
          setUser(data.username)
        })
        .catch(() => {
          setAuthToken(null)
        })
        .finally(() => {
          setAuthChecked(true)
        })
    } else {
      setAuthChecked(true)
    }
  }, [])

  // Listen for 401 responses to auto-logout
  useEffect(() => {
    return onUnauthorized(() => {
      setAuthToken(null)
      setUser(null)
    })
  }, [])

  const handleLogin = useCallback((username: string, _token: string) => {
    setUser(username)
  }, [])

  const handleLogout = useCallback(() => {
    setAuthToken(null)
    setUser(null)
  }, [])

  if (!authChecked) {
    return <WorkspaceLoadingState label="Loading workspace" />
  }

  if (!user) {
    return (
      <Suspense fallback={<WorkspaceLoadingState label="Loading sign in" />}>
        <LoginPage onLogin={handleLogin} />
      </Suspense>
    )
  }

  return <AuthenticatedApp key={user} username={user} onLogout={handleLogout} />
}

export default App
