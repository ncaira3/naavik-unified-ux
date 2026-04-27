import { useMemo } from 'react'
import type { WorkflowRunStatusResponse } from '../lib/api'
import { STAGE_TAB_ORDER, type StageTabId } from '../lib/stages'

/** Map stage tab id to agent id(s). Test tab maps to unit_testing by default. */
export function stageTabToAgent(tabId: StageTabId): string {
  if (tabId === 'test') return 'testing'
  return tabId
}

/** Agent id to stage tab id (for highlighting active tab). */
export function agentToStageTab(agentId: string): StageTabId {
  if (agentId === 'testing' || agentId === 'unit_testing' || agentId === 'integration_validation') return 'test'
  if (agentId === 'app_assembly') return 'app_assembly'
  if (agentId === 'coding') return 'code_generation'
  if (agentId === 'planning' || agentId === 'code_generation' || agentId === 'code_audit') {
    return agentId as StageTabId
  }
  return 'planning'
}

function stageTabFromStageName(stageName: string): StageTabId | null {
  if (stageName === 'testing' || stageName === 'unit_testing' || stageName === 'integration_validation') return 'test'
  if (stageName === 'planning' || stageName === 'code_generation' || stageName === 'code_audit' || stageName === 'app_assembly') {
    return stageName
  }
  return null
}

function isVisibleWorkflowStatus(status?: string): boolean {
  return status === 'queued' || status === 'running' || status === 'succeeded' || status === 'failed' || status === 'stale'
}

/**
 * Returns stage tabs derived only from the current workflow run.
 * This avoids leaking artifact/history state from other projects into the UI.
 */
export function useReachedStages(
  workflowStatus: WorkflowRunStatusResponse | null
) {
  const reachedTabs = useMemo((): StageTabId[] => {
    const out = new Set<StageTabId>(['planning'])

    for (const stage of workflowStatus?.stages || []) {
      if (!isVisibleWorkflowStatus(stage.status)) continue
      const tabId = stageTabFromStageName(stage.stage_name)
      if (tabId) out.add(tabId)
    }

    const currentStageTab = stageTabFromStageName(workflowStatus?.current_stage || '')
    if (currentStageTab) out.add(currentStageTab)

    return STAGE_TAB_ORDER.filter((tabId) => out.has(tabId))
  }, [workflowStatus])

  return {
    reachedTabs,
    isLoading: false,
    error: null as string | null,
    refresh: async () => {},
  }
}
