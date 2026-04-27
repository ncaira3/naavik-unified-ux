import { useState, useEffect, useCallback } from 'react'
import { stagesApi } from '../lib/api'

const ARTIFACT_STAGES = ['code_audit', 'testing', 'unit_testing', 'app_assembly', 'integration_validation']

export function useStageArtifact(sessionId: string, stageName: string) {
  const [artifact, setArtifact] = useState<Record<string, any> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // Only fetch for stages that produce artifacts
    if (!ARTIFACT_STAGES.includes(stageName)) {
      setArtifact(null)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const data = await stagesApi.getArtifact(sessionId, stageName)
      setArtifact(data)
    } catch (err: any) {
      // 404 is expected when no artifact exists yet
      if (err?.message?.includes('404') || err?.message?.includes('Not Found')) {
        setArtifact(null)
      } else {
        setError(err?.message || 'Failed to load artifact')
      }
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, stageName])

  // Refresh on mount and when stage changes
  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll for updates every 5 seconds when on an artifact stage
  useEffect(() => {
    if (!ARTIFACT_STAGES.includes(stageName)) return

    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [stageName, refresh])

  return { artifact, isLoading, error, refresh }
}
