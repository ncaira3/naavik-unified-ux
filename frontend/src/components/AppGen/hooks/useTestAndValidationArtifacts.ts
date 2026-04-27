import { useState, useEffect, useCallback } from 'react'
import { stagesApi } from '../lib/api'

/** Fetches the unified testing artifact, with legacy fallback behavior handled by the backend. */
export function useTestAndValidationArtifacts(sessionId: string, enabled: boolean) {
  const [testingArtifact, setTestingArtifact] = useState<Record<string, any> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) return

    setIsLoading(true)
    setError(null)
    try {
      const artifact = await stagesApi.getArtifact(sessionId, 'testing')
      setTestingArtifact(artifact)
    } catch (err: any) {
      setError(err?.message || 'Failed to load test artifacts')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, enabled])

  useEffect(() => {
    if (!enabled) {
      setTestingArtifact(null)
      return
    }
    refresh()
  }, [refresh, enabled])

  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [enabled, refresh])

  return { testingArtifact, isLoading, error, refresh }
}
