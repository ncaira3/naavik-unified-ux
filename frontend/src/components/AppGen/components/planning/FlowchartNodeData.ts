// ui/src/components/planning/FlowchartNodeData.ts

export interface FlowchartNodeData {
  label: string
  content?: string
  editMode?: boolean
  userPositioned?: boolean
  onNodeClick?: (nodeId: string) => void
  onNodeDoubleClick?: (nodeId: string) => void
  [key: string]: unknown
}

export interface EditableEdgeData {
  editMode?: boolean
  onLabelChange?: (newLabel: string) => void
  [key: string]: unknown
}
