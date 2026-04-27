// ui/src/components/planning/flowchartTokens.ts

export const FLOWCHART_COLORS = {
  start:    { bg: '#ecfdf5', border: '#059669', label: '#064e3b' },
  end:      { bg: '#fef2f2', border: '#dc2626', label: '#7f1d1d' },
  decision: { bg: '#fefce8', border: '#ca8a04', label: '#713f12' },
  process:  { bg: '#eff6ff', border: '#2563eb', label: '#1e3a5f' },
  io:       { bg: '#f5f3ff', border: '#7c3aed', label: '#4c1d95' },
} as const

export const DEFAULT_COLOR = { bg: '#f9fafb', border: '#6b7280', label: '#1e293b' }

export const FLOWCHART_DIMENSIONS = {
  start:    { w: 240, h: 70 },
  end:      { w: 240, h: 70 },
  decision: { w: 260, h: 130 },
  process:  { w: 260, h: 72 },
  io:       { w: 260, h: 72 },
} as const

export const DEFAULT_DIMENSIONS = { w: 260, h: 72 }
export const PANEL_WIDTH = 340

export const LAYOUT = {
  nodeW: 260,
  hGap: 80,
  vGap: 100,
  handleSize: 10,
  defaultZoom: 0.9,
} as const

export const SHADOWS = {
  node:     '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  nodeHover:'0 4px 12px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)',
  nodeSelected: (borderColor: string) =>
    `0 0 0 3px ${borderColor}80, 0 4px 16px rgba(0,0,0,0.15)`,
  nodeDrag: '0 8px 24px rgba(0,0,0,0.15), 0 4px 8px rgba(0,0,0,0.08)',
  panel:    '-4px 0 24px rgba(0,0,0,0.08)',
  toolbar:  '0 2px 12px rgba(0,0,0,0.08)',
} as const

export const TYPOGRAPHY = {
  labelSize: 13,
  labelWeight: 600,
  labelColor: '#0f172a',
  previewSize: 11,
  previewColor: '#64748b',
  edgeLabelSize: 11,
  edgeLabelWeight: 500,
  edgeLabelColor: '#334155',
} as const

export const EDGE_STYLE = {
  stroke: '#94a3b8',
  strokeHover: '#475569',
  strokeWidth: 1.5,
  strokeWidthHover: 2.5,
  arrowSize: 12,
  labelBg: '#ffffff',
  labelBorder: '#e2e8f0',
} as const

export const CANVAS = {
  bg: '#fafafa',
  bgEdit: '#f8faff',
  gridGap: 24,
  gridDotSize: 1,
  gridColor: '#e5e7eb',
} as const

export const ANIMATION = {
  hover: '150ms ease',
  selection: '200ms ease-out',
  panelIn: '300ms ease-out',
  panelOut: '200ms ease-in',
  handleScale: '150ms ease',
} as const

export const HANDLE_STYLE = {
  size: 10,
  bg: '#cbd5e1',
  border: '2px solid white',
} as const

export type NodeTypeName = 'start' | 'end' | 'decision' | 'process' | 'io'

export const NODE_TYPE_OPTIONS: { value: NodeTypeName; label: string; icon: string }[] = [
  { value: 'start', label: 'Start', icon: '▶' },
  { value: 'process', label: 'Process', icon: '▭' },
  { value: 'decision', label: 'Decision', icon: '◇' },
  { value: 'io', label: 'I/O', icon: '▱' },
  { value: 'end', label: 'End', icon: '■' },
]

export const DEFAULT_LABELS: Record<string, string> = {
  process: 'New Process',
  decision: 'New Decision',
  io: 'New I/O',
  start: 'Start',
  end: 'End',
}
