/**
 * Flowchart model from spec document — shared by PlanningPane and HLD export.
 */
import { MarkerType } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import { FLOWCHART_COLORS, FLOWCHART_DIMENSIONS, DEFAULT_DIMENSIONS, LAYOUT, EDGE_STYLE, TYPOGRAPHY } from './flowchartTokens'

export const NODE_TYPE_COLORS: Record<string, { bg: string; border: string; label?: string }> = FLOWCHART_COLORS
export { DEFAULT_COLOR as DEFAULT_NODE_COLOR } from './flowchartTokens'

export const NODE_DIMENSIONS: Record<string, { w: number; h: number }> = FLOWCHART_DIMENSIONS
export const DEFAULT_NODE_DIMENSIONS = DEFAULT_DIMENSIONS

export function applyAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes

  const NODE_W = LAYOUT.nodeW
  const H_GAP = LAYOUT.hGap
  const V_GAP = LAYOUT.vGap

  const childMap = new Map<string, string[]>()
  const parentCount = new Map<string, number>()
  nodes.forEach((n) => {
    childMap.set(n.id, [])
    parentCount.set(n.id, 0)
  })
  edges.forEach((e) => {
    if (childMap.has(e.source) && childMap.has(e.target)) {
      childMap.get(e.source)!.push(e.target)
      parentCount.set(e.target, (parentCount.get(e.target) ?? 0) + 1)
    }
  })

  const layer = new Map<string, number>()
  const queue: string[] = []
  nodes.forEach((n) => {
    if ((parentCount.get(n.id) ?? 0) === 0) {
      layer.set(n.id, 0)
      queue.push(n.id)
    }
  })
  if (queue.length === 0 && nodes.length > 0) {
    layer.set(nodes[0].id, 0)
    queue.push(nodes[0].id)
  }
  while (queue.length > 0) {
    const id = queue.shift()!
    const cur = layer.get(id) ?? 0
    for (const child of childMap.get(id) ?? []) {
      if (!layer.has(child)) {
        layer.set(child, cur + 1)
        queue.push(child)
      }
    }
  }
  nodes.forEach((n) => {
    if (!layer.has(n.id)) layer.set(n.id, 0)
  })

  const byLayer = new Map<number, string[]>()
  nodes.forEach((n) => {
    const l = layer.get(n.id) ?? 0
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(n.id)
  })

  // Calculate max height per layer for variable-height nodes
  const nodeById = new Map<string, Node>(nodes.map((n) => [n.id, n]))
  const layerMaxH = new Map<number, number>()
  byLayer.forEach((ids, l) => {
    const maxH = ids.reduce((m, id) => {
      const nodeType = typeof nodeById.get(id)?.type === 'string' ? (nodeById.get(id)!.type as string) : ''
      const h = (NODE_DIMENSIONS[nodeType] ?? DEFAULT_NODE_DIMENSIONS).h
      return Math.max(m, h)
    }, 0)
    layerMaxH.set(l, maxH)
  })

  // Compute cumulative Y offset per layer
  const layerY = new Map<number, number>()
  const sortedLayers = Array.from(layerMaxH.keys()).sort((a, b) => a - b)
  let cumulativeY = 0
  for (const l of sortedLayers) {
    layerY.set(l, cumulativeY)
    cumulativeY += (layerMaxH.get(l) ?? 0) + V_GAP
  }

  const positions = new Map<string, { x: number; y: number }>()
  byLayer.forEach((ids, l) => {
    const totalW = ids.length * NODE_W + (ids.length - 1) * H_GAP
    const yOffset = layerY.get(l) ?? 0
    ids.forEach((id, i) => {
      positions.set(id, { x: i * (NODE_W + H_GAP) - totalW / 2, y: yOffset })
    })
  })

  return nodes.map((n) => {
    // Skip position assignment for user-positioned nodes
    const isUserPositioned = (n.data as any)?.userPositioned === true
    const nodeLayer = layer.get(n.id) ?? 0
    const { x } = positions.get(n.id) ?? n.position
    return { ...n, position: isUserPositioned ? n.position : { x, y: layerY.get(nodeLayer) ?? n.position.y } }
  })
}

export interface FlowchartModel {
  nodes: Node[]
  edges: Edge[]
  viewport: { x: number; y: number; zoom: number }
  issues: string[]
}

export function flowchartModelFromSpecDocument(flowchart: unknown): FlowchartModel {
  const raw = (flowchart ?? {}) as Record<string, unknown>
  const rawNodes = Array.isArray(raw.nodes) ? (raw.nodes as unknown[]) : []
  const rawEdges = Array.isArray(raw.edges) ? (raw.edges as unknown[]) : []
  const issues: string[] = []

  const nodes = rawNodes
    .filter((n) => n && typeof n === 'object')
    .reduce<Node[]>((acc, n) => {
      const node = n as Record<string, unknown>
      const id = typeof node.id === 'string' && node.id.trim() ? node.id : ''
      if (!id) {
        issues.push('Found a flow node without a valid id.')
        return acc
      }
      const pos = node.position && typeof node.position === 'object' ? (node.position as Record<string, unknown>) : null
      const x = pos && typeof pos.x === 'number' ? Number(pos.x) : 0
      const y = pos && typeof pos.y === 'number' ? Number(pos.y) : 0
      const rawData = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>) : {}
      acc.push({
        id,
        type: typeof node.type === 'string' ? node.type : undefined,
        position: { x, y },
        data: {
          label: String(rawData.label ?? node.id ?? ''),
          content: rawData.content ?? '',
          userPositioned: rawData.userPositioned ?? false,
        },
        style: node.style && typeof node.style === 'object' ? (node.style as Record<string, unknown>) : undefined,
      })
      return acc
    }, [])

  // Build a position lookup for computing optimal handle pairs
  const nodePositions = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    nodePositions.set(n.id, n.position)
  }

  const edges: Edge[] = rawEdges
    .filter((e) => e && typeof e === 'object' && (e as Record<string, unknown>).source && (e as Record<string, unknown>).target)
    .map((e) => {
      const edge = e as Record<string, unknown>
      const label = typeof edge.label === 'string' ? edge.label : undefined
      const sourceId = String(edge.source)
      const targetId = String(edge.target)

      // Compute best handle pair based on relative node positions
      let sourceHandle = typeof edge.sourceHandle === 'string' ? edge.sourceHandle : undefined
      let targetHandle = typeof edge.targetHandle === 'string' ? edge.targetHandle : undefined
      if (!sourceHandle || !targetHandle) {
        const sPos = nodePositions.get(sourceId)
        const tPos = nodePositions.get(targetId)
        if (sPos && tPos) {
          const dx = tPos.x - sPos.x
          const dy = tPos.y - sPos.y
          if (Math.abs(dy) >= Math.abs(dx)) {
            // Primarily vertical relationship
            if (dy >= 0) {
              sourceHandle = sourceHandle || 'bottom-src'
              targetHandle = targetHandle || 'top-tgt'
            } else {
              sourceHandle = sourceHandle || 'top-src'
              targetHandle = targetHandle || 'bottom-tgt'
            }
          } else {
            // Primarily horizontal relationship
            if (dx >= 0) {
              sourceHandle = sourceHandle || 'right-src'
              targetHandle = targetHandle || 'left-tgt'
            } else {
              sourceHandle = sourceHandle || 'left-src'
              targetHandle = targetHandle || 'right-tgt'
            }
          }
        } else {
          // Default: top-to-bottom flow
          sourceHandle = sourceHandle || 'bottom-src'
          targetHandle = targetHandle || 'top-tgt'
        }
      }

      return {
        id: String(edge.id ?? `${sourceId}_${targetId}`),
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: typeof edge.type === 'string' ? edge.type : 'smoothstep',
        label,
        animated: Boolean(edge.animated),
        markerEnd: { type: MarkerType.ArrowClosed, width: EDGE_STYLE.arrowSize, height: EDGE_STYLE.arrowSize, color: EDGE_STYLE.stroke },
        style: { stroke: EDGE_STYLE.stroke, strokeWidth: EDGE_STYLE.strokeWidth },
        ...(label
          ? {
              labelStyle: { fontSize: TYPOGRAPHY.edgeLabelSize, fontWeight: TYPOGRAPHY.edgeLabelWeight, fill: TYPOGRAPHY.edgeLabelColor },
              labelShowBg: true,
              labelBgStyle: { fill: EDGE_STYLE.labelBg, stroke: EDGE_STYLE.labelBorder, strokeWidth: 0.5 },
              labelBgPadding: [4, 6] as [number, number],
            }
          : {}),
      }
    })

  const viewportRaw = raw.viewport as Record<string, unknown> | undefined
  const viewport =
    viewportRaw && typeof viewportRaw === 'object'
      ? {
          x: Number(viewportRaw.x ?? 0),
          y: Number(viewportRaw.y ?? 0),
          zoom: Number(viewportRaw.zoom ?? 0.9),
        }
      : { x: 0, y: 0, zoom: 0.9 }

  return { nodes, edges, viewport, issues }
}

/** Strip edit callbacks so html-to-image capture stays stable. */
export function nodesForHldExport(nodes: Node[]): Node[] {
  return nodes.map((n) => ({
    ...n,
    data: { label: (n.data as any)?.label ?? '', content: (n.data as any)?.content ?? '' },
  }))
}
