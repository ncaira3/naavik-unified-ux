import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_MODE_CONFIG } from '../lib/stages'
import type { WorkflowRunStatusResponse, WorkflowStageSnapshot } from '../lib/api'

const STAGE_ORDER = [
  'planning',
  'code_generation',
  'code_audit',
  'testing',
  'app_assembly',
] as const

const STAGE_KICKOFF_MESSAGES: Record<string, string> = {
  code_generation:
    'The user has approved the plan. Start code generation immediately.\n\n' +
    'Use the approved spec and flowchart as source of truth, create/modify files directly, ' +
    'and proceed autonomously with safe defaults where implementation choices exist. ' +
    'Do not ask clarification questions during code generation.',
  code_audit: 'Begin the code audit.',
  testing:
    'Generate and run a comprehensive testing stage for the application.\n\n' +
    'Start by reviewing the code audit findings (loaded in your context) to ' +
    'prioritize coverage. Then explore the codebase, generate unit tests from code structure, ' +
    'derive functional scenarios from the plan and flowchart, save the testing manifest, ' +
    'run the deterministic runner, and save the final testing report.',
  app_assembly: 'Create the deployment artifacts.',
}

type PendingStageJump = { target: string; invalidated: string[] } | null

type PreviewJumpResult = {
  ok: boolean
  invalidated: string[]
  message?: string
}

type JumpToStageResult = {
  ok: boolean
  invalidated: string[]
  message?: string
}

type AdvanceStageResult = {
  ok: boolean
  nextStage?: string
  message?: string
}

type PendingStageAdvance = {
  current: string
  next: string
} | null

interface UseWorkspaceStageControllerOptions {
  projectName: string
  workflowStatus: WorkflowRunStatusResponse | null
  workflowContextLoaded: boolean
  workflowLoading: boolean
  stageSnapshotMap: Record<string, WorkflowStageSnapshot>
  persistLastViewedStage: (stage: string) => Promise<void>
  previewJump: (targetStage: string, reason?: string) => Promise<PreviewJumpResult>
  jumpToStage: (targetStage: string, reason?: string) => Promise<JumpToStageResult>
  advanceStage: (stageName?: string) => Promise<AdvanceStageResult>
}

function stageIndex(stage: string | null | undefined): number {
  return STAGE_ORDER.indexOf((stage || '') as (typeof STAGE_ORDER)[number])
}

export function useWorkspaceStageController({
  projectName,
  workflowStatus,
  workflowContextLoaded,
  workflowLoading,
  stageSnapshotMap,
  persistLastViewedStage,
  previewJump,
  jumpToStage,
  advanceStage,
}: UseWorkspaceStageControllerOptions) {
  const [activeAgent, setActiveAgent] = useState<string>('planning')
  const [pendingStageKickoff, setPendingStageKickoff] = useState<string | null>(null)
  const [pendingStageJump, setPendingStageJump] = useState<PendingStageJump>(null)
  const [pendingStageAdvance, setPendingStageAdvance] = useState<PendingStageAdvance>(null)
  const [optimisticAgent, setOptimisticAgent] = useState<string | null>(null)
  const hasRestoredStageRef = useRef(false)

  const availableAgentModes = useMemo(() => {
    if (optimisticAgent) {
      const optimisticIndex = stageIndex(optimisticAgent)
      return AGENT_MODE_CONFIG.filter((mode) => {
        const idx = stageIndex(mode.id)
        return idx >= 0 && idx <= optimisticIndex
      })
    }

    const visibleStatuses = new Set(['queued', 'running', 'succeeded', 'failed', 'stale'])
    const maxVisibleIndex = Math.max(
      0,
      stageIndex(workflowStatus?.current_stage),
      ...(workflowStatus?.stages || [])
        .filter((stage) => visibleStatuses.has(stage.status))
        .map((stage) => stageIndex(stage.stage_name))
        .filter((idx) => idx >= 0)
    )

    return AGENT_MODE_CONFIG.filter((mode) => {
      const idx = stageIndex(mode.id)
      return idx >= 0 && idx <= maxVisibleIndex
    })
  }, [optimisticAgent, workflowStatus])

  const startBuildFromPlan = useCallback(async () => {
    const nextStage = 'code_generation'
    setOptimisticAgent(nextStage)
    setActiveAgent(nextStage)
    void persistLastViewedStage(nextStage)
    setPendingStageKickoff(STAGE_KICKOFF_MESSAGES.code_generation)
  }, [persistLastViewedStage])

  const handleAgentChange = useCallback(
    async (nextAgent: string) => {
      if (nextAgent === activeAgent) return

      const currentStageIndex = stageIndex(workflowStatus?.current_stage)
      const nextStageIndex = stageIndex(nextAgent)
      const shouldJump =
        stageSnapshotMap[nextAgent] !== undefined &&
        nextStageIndex >= 0 &&
        currentStageIndex >= 0 &&
        nextStageIndex < currentStageIndex

      if (shouldJump) {
        const preview = await previewJump(nextAgent)
        if (!preview.ok) return
        if (preview.invalidated.length > 0) {
          setPendingStageJump({ target: nextAgent, invalidated: preview.invalidated })
          return
        }
        const jumpResult = await jumpToStage(nextAgent)
        if (!jumpResult.ok) return
      }

      setActiveAgent(nextAgent)
      void persistLastViewedStage(nextAgent)
    },
    [
      activeAgent,
      jumpToStage,
      persistLastViewedStage,
      previewJump,
      stageSnapshotMap,
      workflowStatus?.current_stage,
    ]
  )

  const confirmPendingJump = useCallback(async () => {
    if (!pendingStageJump) return
    const jumpResult = await jumpToStage(
      pendingStageJump.target,
      'User confirmed backward stage jump'
    )
      if (!jumpResult.ok) return

      setOptimisticAgent(null)
      setActiveAgent(pendingStageJump.target)
      void persistLastViewedStage(pendingStageJump.target)
      setPendingStageJump(null)
  }, [jumpToStage, pendingStageJump, persistLastViewedStage])

  const cancelPendingJump = useCallback(() => {
    setPendingStageJump(null)
  }, [])

  const clearPendingStageKickoff = useCallback(() => {
    setPendingStageKickoff(null)
  }, [])

  const applyAdvanceStage = useCallback(
    async (stageName: string) => {
      const result = await advanceStage(stageName)
      if (!result.ok || !result.nextStage) return

      setOptimisticAgent(result.nextStage)
      setActiveAgent(result.nextStage)
      void persistLastViewedStage(result.nextStage)

      const kickoff = STAGE_KICKOFF_MESSAGES[result.nextStage]
      if (kickoff) {
        setPendingStageKickoff(kickoff)
      }
    },
    [advanceStage, persistLastViewedStage]
  )

  const handleAdvanceStage = useCallback(
    async (stageName: string) => {
      const stageStatus = stageSnapshotMap[stageName]?.status
      const nextStageIndex = stageIndex(stageName)
      const nextStage =
        nextStageIndex >= 0 && nextStageIndex < STAGE_ORDER.length - 1
          ? STAGE_ORDER[nextStageIndex + 1]
          : null

      if (nextStage && (stageStatus === 'queued' || stageStatus === 'running')) {
        setPendingStageAdvance({ current: stageName, next: nextStage })
        return
      }

      await applyAdvanceStage(stageName)
    },
    [applyAdvanceStage, stageSnapshotMap]
  )

  const confirmPendingAdvance = useCallback(async () => {
    if (!pendingStageAdvance) return
    await applyAdvanceStage(pendingStageAdvance.current)
    setPendingStageAdvance(null)
  }, [applyAdvanceStage, pendingStageAdvance])

  const cancelPendingAdvance = useCallback(() => {
    setPendingStageAdvance(null)
  }, [])

  useEffect(() => {
    hasRestoredStageRef.current = false
    setActiveAgent('planning')
    setPendingStageJump(null)
    setPendingStageAdvance(null)
    setPendingStageKickoff(null)
    setOptimisticAgent(null)
  }, [projectName])

  useEffect(() => {
    if (hasRestoredStageRef.current) return
    if (!workflowContextLoaded || workflowLoading) return

    const workflowStage = (workflowStatus?.current_stage || '').trim()
    hasRestoredStageRef.current = true
    setOptimisticAgent(null)
    if (!workflowStage) return

    setActiveAgent(workflowStage)
    void persistLastViewedStage(workflowStage)
  }, [
    persistLastViewedStage,
    workflowContextLoaded,
    workflowLoading,
    workflowStatus?.current_stage,
  ])

  useEffect(() => {
    if (optimisticAgent && workflowStatus?.current_stage === optimisticAgent) {
      setOptimisticAgent(null)
    }
  }, [optimisticAgent, workflowStatus?.current_stage])

  useEffect(() => {
    if (availableAgentModes.some((mode) => mode.id === activeAgent)) return
    if (optimisticAgent === activeAgent) return

    const workflowStage = (workflowStatus?.current_stage || '').trim()
    const fallbackAgent =
      availableAgentModes.find((mode) => mode.id === workflowStage)?.id ||
      availableAgentModes[availableAgentModes.length - 1]?.id ||
      'planning'

    if (fallbackAgent !== activeAgent) {
      setActiveAgent(fallbackAgent)
    }
  }, [activeAgent, availableAgentModes, optimisticAgent, workflowStatus?.current_stage])

  return {
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
  }
}
