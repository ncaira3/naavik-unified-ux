import { useState, useEffect, useCallback } from 'react'
import { projectsApi, ProjectInfo } from '../lib/api'

export function useProjects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await projectsApi.list()
      setProjects(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const createProject = useCallback(async (name: string, description?: string) => {
    const project = await projectsApi.create(name, description)
    await loadProjects()
    return project
  }, [loadProjects])

  const deleteProject = useCallback(async (name: string) => {
    await projectsApi.delete(name)
    await loadProjects()
  }, [loadProjects])

  const selectProject = useCallback(async (name: string) => {
    return await projectsApi.select(name)
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return {
    projects,
    isLoading,
    error,
    loadProjects,
    createProject,
    deleteProject,
    selectProject,
  }
}

