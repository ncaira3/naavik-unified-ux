import { useCallback, useRef, useState } from 'react'
import {
  Background, Controls, MiniMap, ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Connection, Edge, Node, NodeChange, ReactFlowInstance } from '@xyflow/react'
import { CANVAS, PANEL_WIDTH } from './flowchartTokens'
import { FlowchartDetailPopover } from './FlowchartDetailPopover'

const FLOWCHART_GLOBAL_CSS = `
  .react-flow__node {
    background: transparent !important;
    border: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
  }
  .react-flow__viewport {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }
  .flowchart-node-wrapper {
    transform: translateZ(0);
    backface-visibility: hidden;
    transition: box-shadow 150ms ease, transform 200ms ease-out, border-color 150ms ease;
  }
  .react-flow__node.selected .flowchart-node-wrapper {
    z-index: 10;
  }
  .flowchart-node-wrapper:hover .react-flow__handle {
    opacity: 1 !important;
    transform: scale(1) !important;
  }
  .flowchart-view-mode .react-flow__handle {
    opacity: 0 !important;
    pointer-events: none !important;
    width: 1px !important;
    height: 1px !important;
  }
`

import { FlowchartNode } from './FlowchartNode'
import { EditableEdge } from './EditableEdge'
import { FlowchartToolbar } from './FlowchartToolbar'
import { FlowchartNodePanel } from './FlowchartNodePanel'
import type { PlacementMode } from './useFlowchartEditor'

const nodeTypes = {
  default: FlowchartNode,
  start: FlowchartNode,
  end: FlowchartNode,
  decision: FlowchartNode,
  process: FlowchartNode,
  io: FlowchartNode,
}

const edgeTypes = {
  default: EditableEdge,
  smoothstep: EditableEdge,
}

interface FlowchartCanvasProps {
  nodes: Node[]
  edges: Edge[]
  viewport?: { x?: number; y?: number; zoom?: number }
  onNodesChange: (changes: NodeChange[]) => void
  editMode?: boolean
  minimalChrome?: boolean
  exportRootId?: string
  onFlowInit?: (instance: ReactFlowInstance) => void
  // New edit handlers
  onConnect?: (connection: Connection) => void
  onNodeDelete?: (nodeId: string) => void
  onEdgeDelete?: (edgeId: string) => void
  onCanvasClick?: (event: React.MouseEvent, position: { x: number; y: number }) => void
  // Toolbar props
  placementMode?: PlacementMode
  deleteMode?: boolean
  onSetPlacement?: (mode: PlacementMode) => void
  onSetDeleteMode?: (on: boolean) => void
  // Panel props
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string | null) => void
  onUpdateNodeLabel?: (nodeId: string, label: string) => void
  onUpdateNodeType?: (nodeId: string, type: string) => void
  onUpdateNodeContent?: (nodeId: string, content: string) => void
  onDeleteNode?: (nodeId: string) => void
  onUndo?: () => void
  onResetLayout?: () => void
}

export function FlowchartCanvas({
  nodes,
  edges,
  viewport,
  onNodesChange,
  editMode = false,
  minimalChrome = false,
  exportRootId,
  onFlowInit,
  onConnect: onConnectProp,
  onNodeDelete,
  onEdgeDelete,
  onCanvasClick,
  placementMode,
  deleteMode,
  onSetPlacement,
  onSetDeleteMode,
  selectedNodeId,
  onSelectNode,
  onUpdateNodeLabel,
  onUpdateNodeType,
  onUpdateNodeContent,
  onDeleteNode,
  onUndo,
  onResetLayout,
}: FlowchartCanvasProps) {
  const defaultVp = { x: viewport?.x ?? 0, y: viewport?.y ?? 0, zoom: viewport?.zoom ?? 0.9 }
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [viewPopoverNode, setViewPopoverNode] = useState<Node | null>(null)

  const handlePaneClick = useCallback((event: React.MouseEvent) => {
    setViewPopoverNode(null)
    if (!editMode || !onCanvasClick) return
    // Convert screen coords to flow coords
    const bounds = reactFlowWrapper.current?.querySelector('.react-flow')?.getBoundingClientRect()
    if (!bounds) return
    // Use the ReactFlow instance to project screen to flow coords
    const flowElement = reactFlowWrapper.current?.querySelector('.react-flow__viewport')
    if (!flowElement) {
      onCanvasClick(event, { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
      return
    }
    const transform = window.getComputedStyle(flowElement).transform
    const matrix = new DOMMatrix(transform)
    const x = (event.clientX - bounds.left - matrix.e) / matrix.a
    const y = (event.clientY - bounds.top - matrix.f) / matrix.d
    onCanvasClick(event, { x, y })
  }, [editMode, onCanvasClick])

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (!editMode) {
      setViewPopoverNode(node)
      return
    }
    if (deleteMode && onNodeDelete) {
      onNodeDelete(node.id)
    } else if (onSelectNode) {
      onSelectNode(node.id)
    }
  }, [editMode, deleteMode, onNodeDelete, onSelectNode])

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (!editMode) return
    if (deleteMode && onEdgeDelete) {
      onEdgeDelete(edge.id)
    }
  }, [editMode, deleteMode, onEdgeDelete])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && editMode && onUndo) {
      event.preventDefault()
      onUndo()
      return
    }
    if (event.key === 'Escape') {
      onSetPlacement?.(null)
      onSetDeleteMode?.(false)
      onSelectNode?.(null)
    }
  }, [editMode, onUndo, onSetPlacement, onSetDeleteMode, onSelectNode])

  const cursorClass = placementMode ? 'cursor-copy' : deleteMode ? 'cursor-pointer' : ''

  // Find selected node for panel
  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null

  return (
    <div className={`flex w-full h-full ${editMode ? 'flowchart-edit-mode' : 'flowchart-view-mode'}`}>
      {/* ReactFlow canvas area */}
      <div ref={reactFlowWrapper} className={`relative flex-1 min-w-0 h-full ${cursorClass}`} style={{ backgroundColor: editMode ? CANVAS.bgEdit : CANVAS.bg }} onKeyDown={handleKeyDown as any} tabIndex={selectedNode ? -1 : 0}>
        <style>{FLOWCHART_GLOBAL_CSS}</style>
        {editMode && onSetPlacement && onSetDeleteMode && (
          <FlowchartToolbar
            placementMode={placementMode ?? null}
            deleteMode={deleteMode ?? false}
            onSetPlacement={onSetPlacement}
            onSetDeleteMode={onSetDeleteMode}
            onResetLayout={onResetLayout}
          />
        )}

        <div className="w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={editMode ? onConnectProp : undefined}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          defaultViewport={defaultVp}
          fitView={!onFlowInit}
          fitViewOptions={{ padding: 0.2 }}
          onInit={onFlowInit}
          nodesDraggable={editMode}
          nodesConnectable={editMode}
          elementsSelectable={editMode}
          deleteKeyCode={editMode && !selectedNode ? ['Delete', 'Backspace'] : null}
          onNodesDelete={editMode && onNodeDelete ? (nodes) => nodes.forEach(n => onNodeDelete(n.id)) : undefined}
          onEdgesDelete={editMode && onEdgeDelete ? (edges) => edges.forEach(e => onEdgeDelete(e.id)) : undefined}
          nodesFocusable={!selectedNode}
          edgesFocusable={!selectedNode}
          selectionKeyCode={selectedNode ? null : 'Shift'}
          panOnDrag
          panOnScroll
          panActivationKeyCode={null}
          zoomOnPinch
          zoomOnScroll
          zoomOnDoubleClick
          selectionOnDrag={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          {...(exportRootId ? { id: exportRootId } : {})}
          onDrop={(event) => {
            if (!editMode || !onCanvasClick) return
            event.preventDefault()
            const type = event.dataTransfer.getData('application/flowchart-node-type')
            if (!type) return
            const bounds = reactFlowWrapper.current?.querySelector('.react-flow')?.getBoundingClientRect()
            if (!bounds) return
            const flowElement = reactFlowWrapper.current?.querySelector('.react-flow__viewport')
            if (!flowElement) return
            const transform = window.getComputedStyle(flowElement).transform
            const matrix = new DOMMatrix(transform)
            const x = (event.clientX - bounds.left - matrix.e) / matrix.a
            const y = (event.clientY - bounds.top - matrix.f) / matrix.d
            onSetPlacement?.({ nodeType: type })
            onCanvasClick(event as any, { x, y })
          }}
          onDragOver={(event) => {
            if (!editMode) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
        >
          {!minimalChrome && (
            <>
              <MiniMap pannable zoomable />
              <Controls showInteractive />
            </>
          )}
          <Background
            gap={CANVAS.gridGap}
            size={CANVAS.gridDotSize}
            color={CANVAS.gridColor}
          />
        </ReactFlow>
      </div>

        {/* View-mode detail popover */}
        {!editMode && viewPopoverNode && (
          <FlowchartDetailPopover
            nodeType={viewPopoverNode.type ?? 'process'}
            label={String((viewPopoverNode.data as any)?.label ?? '')}
            content={String((viewPopoverNode.data as any)?.content ?? '')}
            onClose={() => setViewPopoverNode(null)}
          />
        )}
      </div>

      {/* Side Panel — OUTSIDE ReactFlow wrapper to avoid keyboard event capture */}
      {editMode && selectedNode && onUpdateNodeLabel && onUpdateNodeType && onUpdateNodeContent && onDeleteNode && onSelectNode && (
        <div className="h-full shrink-0" style={{ width: PANEL_WIDTH }}>
          <FlowchartNodePanel
            key={selectedNode.id}
            nodeId={selectedNode.id}
            nodeType={selectedNode.type ?? 'process'}
            label={String((selectedNode.data as any)?.label ?? '')}
            content={String((selectedNode.data as any)?.content ?? '')}
            onClose={() => onSelectNode(null)}
            onUpdateLabel={(label) => onUpdateNodeLabel(selectedNode.id, label)}
            onUpdateType={(type) => onUpdateNodeType(selectedNode.id, type)}
            onUpdateContent={(content) => onUpdateNodeContent(selectedNode.id, content)}
            onDelete={() => { onDeleteNode(selectedNode.id); onSelectNode(null) }}
          />
        </div>
      )}
    </div>
  )
}
