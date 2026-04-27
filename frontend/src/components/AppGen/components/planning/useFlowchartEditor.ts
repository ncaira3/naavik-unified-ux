import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyNodeChanges as xyApplyNodeChanges } from '@xyflow/react'
import type { Edge, Node, Connection, NodeChange } from '@xyflow/react'
import { DEFAULT_LABELS } from './flowchartTokens'

export interface FlowchartChange {
  type:
    | 'node_added' | 'node_removed'
    | 'node_label_changed' | 'node_type_changed' | 'node_content_changed'
    | 'edge_added' | 'edge_removed' | 'edge_label_changed'
  id: string
  old?: string
  new?: string
  node_type?: string
  label?: string
  source?: string
  target?: string
}

export type PlacementMode = { nodeType: string } | null

export interface UseFlowchartEditorReturn {
  // State
  isEditing: boolean
  draftNodes: Node[]
  draftEdges: Edge[]
  selectedNodeId: string | null
  placementMode: PlacementMode
  deleteMode: boolean
  isSaving: boolean
  saveError: string | null

  // Actions
  startEditing: (nodes: Node[], edges: Edge[]) => void
  cancelEditing: () => void
  save: (saveFn: (payload: any) => Promise<void>, notifyFn?: (changes: FlowchartChange[]) => void, viewport?: { x: number; y: number; zoom: number }) => Promise<void>
  selectNode: (nodeId: string | null) => void
  updateNodeLabel: (nodeId: string, label: string) => void
  updateNodeType: (nodeId: string, newType: string) => void
  updateNodeContent: (nodeId: string, content: string) => void
  updateEdgeLabel: (edgeId: string, label: string) => void
  addNode: (type: string, position: { x: number; y: number }) => string
  deleteNode: (nodeId: string) => void
  deleteEdge: (edgeId: string) => void
  onConnect: (connection: Connection) => void
  setPlacementMode: (mode: PlacementMode) => void
  setDeleteMode: (on: boolean) => void
  applyNodeChanges: (changes: NodeChange[]) => void
  undo: () => void
  handleCanvasClick: (event: React.MouseEvent, position: { x: number; y: number }) => void
}

let nodeIdCounter = 0
function generateNodeId(): string {
  return `n_${Date.now()}_${++nodeIdCounter}`
}
function generateEdgeId(source: string, target: string): string {
  return `e_${source}_${target}_${Date.now()}`
}

/** Pure diff computation — lives at module level to avoid stale closures. */
function computeFlowchartDiff(
  baselineNodes: Node[], baselineEdges: Edge[],
  currentNodes: Node[], currentEdges: Edge[]
): FlowchartChange[] {
  const changes: FlowchartChange[] = []
  const baseNodeMap = new Map(baselineNodes.map(n => [n.id, n]))
  const baseEdgeMap = new Map(baselineEdges.map(e => [e.id, e]))
  const draftNodeMap = new Map(currentNodes.map(n => [n.id, n]))
  const draftEdgeMap = new Map(currentEdges.map(e => [e.id, e]))

  // Added nodes
  for (const n of currentNodes) {
    if (!baseNodeMap.has(n.id)) {
      changes.push({ type: 'node_added', id: n.id, node_type: n.type, label: String((n.data as any)?.label ?? '') })
    }
  }
  // Removed nodes
  for (const n of baselineNodes) {
    if (!draftNodeMap.has(n.id)) {
      changes.push({ type: 'node_removed', id: n.id, label: String((n.data as any)?.label ?? '') })
    }
  }
  // Changed nodes
  for (const n of currentNodes) {
    const base = baseNodeMap.get(n.id)
    if (!base) continue
    const oldLabel = String((base.data as any)?.label ?? '')
    const newLabel = String((n.data as any)?.label ?? '')
    if (oldLabel !== newLabel) {
      changes.push({ type: 'node_label_changed', id: n.id, old: oldLabel, new: newLabel })
    }
    if (base.type !== n.type) {
      changes.push({ type: 'node_type_changed', id: n.id, old: base.type, new: n.type })
    }
    const oldContent = String((base.data as any)?.content ?? '')
    const newContent = String((n.data as any)?.content ?? '')
    if (oldContent !== newContent) {
      changes.push({ type: 'node_content_changed', id: n.id })
    }
  }
  // Added edges
  for (const e of currentEdges) {
    if (!baseEdgeMap.has(e.id)) {
      changes.push({ type: 'edge_added', id: e.id, source: e.source, target: e.target, label: String(e.label ?? '') })
    }
  }
  // Removed edges
  for (const e of baselineEdges) {
    if (!draftEdgeMap.has(e.id)) {
      changes.push({ type: 'edge_removed', id: e.id })
    }
  }
  // Changed edge labels
  for (const e of currentEdges) {
    const base = baseEdgeMap.get(e.id)
    if (!base) continue
    const oldLabel = String(base.label ?? '')
    const newLabel = String(e.label ?? '')
    if (oldLabel !== newLabel) {
      changes.push({ type: 'edge_label_changed', id: e.id, old: oldLabel, new: newLabel })
    }
  }
  return changes
}

export function useFlowchartEditor(): UseFlowchartEditorReturn {
  const [isEditing, setIsEditing] = useState(false)
  const [draftNodes, setDraftNodes] = useState<Node[]>([])
  const [draftEdges, setDraftEdges] = useState<Edge[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [placementMode, setPlacementMode] = useState<PlacementMode>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const baselineNodesRef = useRef<Node[]>([])
  const baselineEdgesRef = useRef<Edge[]>([])

  // --- Undo stack ---
  const undoStackRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([])
  const MAX_UNDO = 30

  const pushUndo = useCallback(() => {
    undoStackRef.current.push({
      nodes: draftNodes.map(n => ({ ...n, data: { ...n.data } })),
      edges: draftEdges.map(e => ({ ...e })),
    })
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
  }, [draftNodes, draftEdges])

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    setDraftNodes(prev.nodes)
    setDraftEdges(prev.edges)
  }, [])

  // --- beforeunload handler ---
  const isDirty = isEditing && (draftNodes.length > 0 || draftEdges.length > 0)

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const startEditing = useCallback((nodes: Node[], edges: Edge[]) => {
    const snap = nodes.map(n => ({ ...n, data: { ...n.data } }))
    const edgeSnap = edges.map(e => ({ ...e }))
    setDraftNodes(snap)
    setDraftEdges(edgeSnap)
    baselineNodesRef.current = snap.map(n => ({ ...n, data: { ...n.data } }))
    baselineEdgesRef.current = edgeSnap.map(e => ({ ...e }))
    setIsEditing(true)
    setSelectedNodeId(null)
    setPlacementMode(null)
    setDeleteMode(false)
    setSaveError(null)
    undoStackRef.current = []
  }, [])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setDraftNodes([])
    setDraftEdges([])
    setSelectedNodeId(null)
    setPlacementMode(null)
    setDeleteMode(false)
    setSaveError(null)
    undoStackRef.current = []
  }, [])

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
    setPlacementMode(null)
    // Do NOT clear deleteMode here — only toolbar toggle or Escape should clear it
  }, [])

  const updateNodeLabel = useCallback((nodeId: string, label: string) => {
    pushUndo()
    setDraftNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, label } } : n
    ))
  }, [pushUndo])

  const updateNodeType = useCallback((nodeId: string, newType: string) => {
    pushUndo()
    setDraftNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, type: newType, data: { ...n.data } } : n
    ))
  }, [pushUndo])

  const updateNodeContent = useCallback((nodeId: string, content: string) => {
    pushUndo()
    setDraftNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, content } } : n
    ))
  }, [pushUndo])

  const updateEdgeLabel = useCallback((edgeId: string, label: string) => {
    pushUndo()
    setDraftEdges(prev => prev.map(e =>
      e.id === edgeId ? { ...e, label: label || undefined } : e
    ))
  }, [pushUndo])

  const addNode = useCallback((type: string, position: { x: number; y: number }): string => {
    pushUndo()
    const id = generateNodeId()
    const newNode: Node = {
      id,
      type,
      position,
      data: { label: DEFAULT_LABELS[type] ?? 'New Node', content: '', userPositioned: true },
    }
    setDraftNodes(prev => [...prev, newNode])
    setPlacementMode(null)
    return id
  }, [pushUndo])

  const deleteNode = useCallback((nodeId: string) => {
    pushUndo()
    setDraftNodes(prev => prev.filter(n => n.id !== nodeId))
    setDraftEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId))
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }, [selectedNodeId, pushUndo])

  const deleteEdge = useCallback((edgeId: string) => {
    pushUndo()
    setDraftEdges(prev => prev.filter(e => e.id !== edgeId))
  }, [pushUndo])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    // Duplicate edge prevention
    const exists = draftEdges.some(e =>
      e.source === connection.source && e.target === connection.target
    )
    if (exists) return
    pushUndo()
    const id = generateEdgeId(connection.source, connection.target)
    const newEdge: Edge = {
      id,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'smoothstep',
      animated: false,
    }
    setDraftEdges(prev => [...prev, newEdge])
  }, [draftEdges, pushUndo])

  const handleCanvasClick = useCallback((_event: React.MouseEvent, position: { x: number; y: number }) => {
    if (placementMode) {
      const id = addNode(placementMode.nodeType, position)
      setSelectedNodeId(id)
    } else if (deleteMode) {
      // delete mode clicks on nodes/edges handled elsewhere
    } else {
      setSelectedNodeId(null)
    }
  }, [placementMode, deleteMode, addNode])

  const save = useCallback(async (
    saveFn: (payload: any) => Promise<void>,
    notifyFn?: (changes: FlowchartChange[]) => void,
    viewport?: { x: number; y: number; zoom: number }
  ) => {
    setSaveError(null)

    // Auto-restore Start/End if missing
    let nodes = [...draftNodes]
    const hasStart = nodes.some(n => n.type === 'start')
    const hasEnd = nodes.some(n => n.type === 'end')
    if (!hasStart) {
      nodes = [{ id: generateNodeId(), type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } }, ...nodes]
    }
    if (!hasEnd) {
      nodes = [...nodes, { id: generateNodeId(), type: 'end', position: { x: 0, y: 800 }, data: { label: 'End' } }]
    }
    if (!hasStart || !hasEnd) {
      setDraftNodes(nodes)
    }

    // Validate no empty labels
    const emptyNode = nodes.find(n => !String((n.data as any)?.label ?? '').trim())
    if (emptyNode) {
      setSaveError('All nodes must have a label.')
      return
    }

    const payload = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          label: (n.data as any)?.label ?? '',
          content: (n.data as any)?.content ?? '',
          userPositioned: (n.data as any)?.userPositioned ?? false,
        },
      })),
      edges: draftEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'smoothstep',
        ...(e.label ? { label: e.label } : {}),
        animated: e.animated ?? false,
      })),
      viewport: viewport ?? { x: 0, y: 0, zoom: 0.9 },
    }

    setIsSaving(true)
    try {
      await saveFn(payload)
      const changes = computeFlowchartDiff(baselineNodesRef.current, baselineEdgesRef.current, nodes, draftEdges)
      setIsEditing(false)
      setDraftNodes([])
      setDraftEdges([])
      setSelectedNodeId(null)
      setPlacementMode(null)
      setDeleteMode(false)
      if (changes.length > 0 && notifyFn) notifyFn(changes)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }, [draftNodes, draftEdges])

  const applyNodeChanges = useCallback((changes: NodeChange[]) => {
    setDraftNodes((prev) => {
      const updated = xyApplyNodeChanges(changes, prev)
      // Mark dragged nodes as user-positioned so auto-layout skips them
      const positionChangedIds = new Set(
        changes.filter(c => c.type === 'position' && 'dragging' in c && c.dragging === false).map(c => (c as any).id as string)
      )
      if (positionChangedIds.size === 0) return updated
      return updated.map(n =>
        positionChangedIds.has(n.id)
          ? { ...n, data: { ...n.data, userPositioned: true } }
          : n
      )
    })
  }, [])

  return useMemo(() => ({
    isEditing, draftNodes, draftEdges, selectedNodeId, placementMode, deleteMode, isSaving, saveError,
    startEditing, cancelEditing, save, selectNode,
    updateNodeLabel, updateNodeType, updateNodeContent, updateEdgeLabel,
    addNode, deleteNode, deleteEdge, onConnect, applyNodeChanges, undo,
    setPlacementMode, setDeleteMode, handleCanvasClick,
  }), [
    isEditing, draftNodes, draftEdges, selectedNodeId, placementMode, deleteMode, isSaving, saveError,
    startEditing, cancelEditing, save, selectNode,
    updateNodeLabel, updateNodeType, updateNodeContent, updateEdgeLabel,
    addNode, deleteNode, deleteEdge, onConnect, applyNodeChanges, undo,
    setPlacementMode, setDeleteMode, handleCanvasClick,
  ])
}
