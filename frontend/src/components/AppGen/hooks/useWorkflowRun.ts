import { useCallback, useEffect, useMemo, useState } from 'react'
import { workflowApi } from '../lib/api'
import type {
  WorkflowContextResponse,
  WorkflowRunStatusResponse,
  WorkflowRunTimelineResponse,
  WorkflowStageSnapshot,
} from '../lib/api'

const PIPELINE_ORDER = [
  'planning',
  'code_generation',
  'code_audit',
  'testing',
  'app_assembly',
] as const

type PipelineStage = typeof PIPELINE_ORDER[number]

function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_ORDER as readonly string[]).includes(value)
}

function nextStage(stage: PipelineStage): PipelineStage | null {
  const idx = PIPELINE_ORDER.indexOf(stage)
  if (idx < 0 || idx >= PIPELINE_ORDER.length - 1) return null
  return PIPELINE_ORDER[idx + 1]
}

export function useWorkflowRun(sessionId: string) {
  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<WorkflowRunStatusResponse | null>(null)
  const [timeline, setTimeline] = useState<WorkflowRunTimelineResponse['timeline']>([])
  const [workflowContextLoaded, setWorkflowContextLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  const beginMutation = useCallback(() => {
    setMutating(true)
    setError(null)
  }, [])

  const endMutation = useCallback(() => {
    setMutating(false)
  }, [])

  const workflowNotReady = useCallback(() => {
    return { ok: false, message: 'Workflow run context is not ready yet.' }
  }, [])

  const unknownStage = useCallback(() => {
    return { ok: false, message: 'Unknown stage.' }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    setWorkflowContextLoaded(false)
    try {
      const context: WorkflowContextResponse = await workflowApi.getContext(sessionId, 40)
      setWorkflowContextLoaded(true)
      const workflowRunId = (context.run_id || '').trim()
      if (!workflowRunId) {
        setRunId(null)
        setStatus(null)
        setTimeline([])
        return
      }
      setRunId(workflowRunId)
      setStatus(context.status)
      setTimeline(context.timeline || [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workflow run'
      setError(message)
    } finally {
      setWorkflowContextLoaded(true)
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const timer = setInterval(() => {
      refresh()
    }, 8000)
    return () => clearInterval(timer)
  }, [refresh])

  const stageSnapshotMap = useMemo(() => {
    const out: Record<string, WorkflowStageSnapshot> = {}
    for (const stage of status?.stages || []) {
      out[stage.stage_name] = stage
    }
    return out
  }, [status?.stages])

  const completedStages = useMemo(
    () =>
      (status?.stages || [])
        .filter((stage) => stage.status === 'succeeded')
        .map((stage) => stage.stage_name),
    [status?.stages]
  )

  const jumpToStage = useCallback(
    async (
      targetStage: string,
      reason: string = 'User selected stage from chat dropdown'
    ): Promise<{ ok: boolean; invalidated: string[]; message?: string }> => {
      if (!runId || !status) {
        return { ...workflowNotReady(), invalidated: [] }
      }
      if (!isPipelineStage(targetStage)) {
        return { ok: true, invalidated: [] }
      }
      beginMutation()
      try {
        const preview = await workflowApi.jumpPreview(runId, targetStage, {
          from_version: status.version,
          reason,
        })
        const jump = await workflowApi.jumpStage(runId, targetStage, {
          from_version: status.version,
          reason,
        })
        await refresh()
        return {
          ok: true,
          invalidated: preview.will_invalidate.length ? preview.will_invalidate : jump.invalidated_stages,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to jump stage'
        setError(message)
        return { ok: false, invalidated: [], message }
      } finally {
        endMutation()
      }
    },
    [beginMutation, endMutation, runId, status, refresh, workflowNotReady]
  )

  const previewJump = useCallback(
    async (targetStage: string, reason: string = 'User selected stage from chat dropdown') => {
      if (!runId || !status) {
        return { ...workflowNotReady(), invalidated: [] as string[] }
      }
      if (!isPipelineStage(targetStage)) {
        return { ok: true, invalidated: [] as string[] }
      }
      try {
        const preview = await workflowApi.jumpPreview(runId, targetStage, {
          from_version: status.version,
          reason,
        })
        return { ok: true, invalidated: preview.will_invalidate, requires_confirmation: preview.requires_confirmation }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to preview jump'
        setError(message)
        return { ok: false, invalidated: [] as string[], message }
      }
    },
    [runId, status, workflowNotReady]
  )

  const rerunStage = useCallback(
    async (stageName: string): Promise<{ ok: boolean; message?: string }> => {
      if (!runId || !status) {
        return workflowNotReady()
      }
      if (!isPipelineStage(stageName)) {
        return unknownStage()
      }
      beginMutation()
      try {
        await workflowApi.startStage(runId, stageName, {
          from_version: status.version,
          trigger: 'user',
        })
        await refresh()
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start stage rerun'
        setError(message)
        return { ok: false, message }
      } finally {
        endMutation()
      }
    },
    [beginMutation, endMutation, refresh, runId, status, unknownStage, workflowNotReady]
  )

  const advanceStage = useCallback(
    async (
      stageName?: string
    ): Promise<{ ok: boolean; nextStage?: string; message?: string }> => {
      if (!runId || !status) {
        return workflowNotReady()
      }
      const current = (stageName || status.current_stage || '').trim()
      if (!isPipelineStage(current)) {
        return { ...unknownStage(), nextStage: undefined }
      }
      const next = nextStage(current)
      if (!next) {
        return { ok: false, message: 'Current stage is already the final stage.' }
      }
      beginMutation()
      try {
        const advancement = await workflowApi.advanceStage(runId, current, {
          from_version: status.version,
          note: `User advanced from ${current} to ${next}`,
        })
        await refresh()
        return { ok: true, nextStage: advancement.to_stage, message: 'advanced' }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to advance to next stage'
        setError(message)
        return { ok: false, message }
      } finally {
        endMutation()
      }
    },
    [beginMutation, endMutation, refresh, runId, status, unknownStage, workflowNotReady]
  )

  return {
    runId,
    workflowContextLoaded,
    status,
    timeline,
    loading,
    mutating,
    error,
    refresh,
    jumpToStage,
    previewJump,
    rerunStage,
    advanceStage,
    stageSnapshotMap,
    completedStages,
  }
}
