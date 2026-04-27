import { useCallback, useEffect, useState } from 'react'
import {
  specApi,
  sessionsApi,
  SpecApiResponse,
  SessionAgentState,
  SpecPatchOperation,
  FlowchartGraphV1,
} from '../lib/api'

export function useSpec(sessionId: string) {
  const [spec, setSpec] = useState<SpecApiResponse | null>(null)
  const [sessionState, setSessionState] = useState<SessionAgentState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (silent: boolean = false) => {
    if (!silent) {
      setIsLoading(true)
      setError(null)
    }
    try {
      const [specDoc, state] = await Promise.all([
        specApi.get(sessionId),
        sessionsApi.getState(sessionId),
      ])
      setSpec(specDoc)
      setSessionState(state)
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load spec')
      }
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }, [sessionId])

  const approve = useCallback(
    async (version?: number) => {
      const result = await specApi.approve(sessionId, version)
      const nextState = result?.session_state as SessionAgentState | undefined
      if (nextState) {
        setSessionState(nextState)
      }
      await refresh(true)
      return nextState ?? null
    },
    [refresh, sessionId]
  )

  const reject = useCallback(
    async (note: string = '') => {
      await specApi.reject(sessionId, note)
      await refresh()
    },
    [refresh, sessionId]
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  const patch = useCallback(
    async (operations: SpecPatchOperation[]) => {
      if (!operations.length) return
      await specApi.patch(sessionId, operations)
      await refresh()
    },
    [refresh, sessionId]
  )

  useEffect(() => {
    const interval = setInterval(() => {
      refresh(true)
    }, 2000)
    return () => clearInterval(interval)
  }, [refresh])

  const saveFlowchart = useCallback(
    async (flowchart: FlowchartGraphV1) => {
      await specApi.saveFlowchart(sessionId, flowchart)
      try { await refresh() } catch { /* save already succeeded — don't mask it */ }
    },
    [sessionId, refresh]
  )

  return {
    spec,
    sessionState,
    isLoading,
    error,
    refresh,
    approve,
    reject,
    patch,
    saveFlowchart,
  }
}
