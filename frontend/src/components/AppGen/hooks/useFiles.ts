import { useState, useEffect, useCallback } from 'react'
import { filesApi, FileTree } from '../lib/api'

export function useFiles(sessionId: string) {
  const [fileTree, setFileTree] = useState<FileTree | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshFileTree = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const tree = await filesApi.getTree(sessionId)
      setFileTree(tree)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  const readFile = useCallback(async (path: string): Promise<string> => {
    const result = await filesApi.readFile(sessionId, path)
    return result.content
  }, [sessionId])

  const writeFile = useCallback(async (path: string, content: string) => {
    await filesApi.writeFile(sessionId, path, content)
  }, [sessionId])

  const createFile = useCallback(async (path: string, content: string = '') => {
    await filesApi.createFile(sessionId, path, content)
    await refreshFileTree()
  }, [refreshFileTree, sessionId])

  const deleteFile = useCallback(async (path: string) => {
    await filesApi.deleteFile(sessionId, path)
    await refreshFileTree()
  }, [refreshFileTree, sessionId])

  const createDirectory = useCallback(async (path: string) => {
    await filesApi.createDirectory(sessionId, path)
    await refreshFileTree()
  }, [refreshFileTree, sessionId])

  const resetWorkspace = useCallback(async () => {
    await filesApi.resetWorkspace(sessionId)
    await refreshFileTree()
  }, [refreshFileTree, sessionId])

  // Initial load
  useEffect(() => {
    refreshFileTree()
  }, [refreshFileTree])

  return {
    fileTree,
    isLoading,
    error,
    refreshFileTree,
    readFile,
    writeFile,
    createFile,
    deleteFile,
    createDirectory,
    resetWorkspace,
  }
}
