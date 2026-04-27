import { useMemo } from 'react'
import type { WorkflowStageSnapshot } from '../lib/api'
import type { ChatMessage } from './useChat'

type StageStatus = 'pending' | 'running' | 'failed' | 'stale' | 'succeeded'

function stageBadgeFromStatus(status?: string): string | undefined {
  if (!status) return undefined
  if (status === 'stale') return 'stale'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'queued') return 'running'
  return undefined
}

export function useWorkspaceStagePresentation({
  activeAgent,
  messages,
  stageSnapshotMap,
}: {
  activeAgent: string
  messages: ChatMessage[]
  stageSnapshotMap: Record<string, WorkflowStageSnapshot>
}) {
  const latestAssistantContent = useMemo(() => {
    const stageAliases: Record<string, string[]> = {
      code_generation: ['code_generation', 'coding', 'code', 'codegen'],
      code_audit: ['code_audit', 'audit'],
      planning: ['planning', 'plan'],
      testing: ['testing', 'unit_testing', 'integration_validation', 'unit_test'],
      unit_testing: ['unit_testing', 'unit_test'],
      integration_validation: ['integration_validation'],
      app_assembly: ['app_assembly', 'assembly'],
    }
    const allowed = new Set(stageAliases[activeAgent] || [activeAgent])
    const message = [...messages].reverse().find(
      (entry) => entry.role === 'assistant' && entry.agentId && allowed.has(entry.agentId)
    )
    return message?.content ?? ''
  }, [activeAgent, messages])

  const tabState = useMemo(() => {
    const one = (stageName: string) => stageSnapshotMap[stageName]?.status
    const foldTest = (): StageStatus => {
      const statuses = [one('testing'), one('unit_testing'), one('integration_validation')].filter(Boolean) as string[]
      if (statuses.includes('failed')) return 'failed'
      if (statuses.includes('running') || statuses.includes('queued')) return 'running'
      if (statuses.includes('stale')) return 'stale'
      if (statuses.includes('succeeded')) return 'succeeded'
      return 'pending'
    }

    return {
      planning: (one('planning') || 'pending') as StageStatus,
      code_generation: (one('code_generation') || 'pending') as StageStatus,
      code_audit: (one('code_audit') || 'pending') as StageStatus,
      test: foldTest(),
      app_assembly: (one('app_assembly') || 'pending') as StageStatus,
    }
  }, [stageSnapshotMap])

  const stageBadges = useMemo(
    () => ({
      planning: stageBadgeFromStatus(stageSnapshotMap.planning?.status),
      code_generation: stageBadgeFromStatus(stageSnapshotMap.code_generation?.status),
      code_audit: stageBadgeFromStatus(stageSnapshotMap.code_audit?.status),
      testing: stageBadgeFromStatus(stageSnapshotMap.testing?.status),
      unit_testing: stageBadgeFromStatus(stageSnapshotMap.unit_testing?.status),
      integration_validation: stageBadgeFromStatus(stageSnapshotMap.integration_validation?.status),
      app_assembly: stageBadgeFromStatus(stageSnapshotMap.app_assembly?.status),
    }),
    [stageSnapshotMap]
  )

  return {
    latestAssistantContent,
    tabState,
    stageBadges,
  }
}
