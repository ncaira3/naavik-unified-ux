import React, { memo, useCallback, useMemo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { FLOWCHART_COLORS, DEFAULT_COLOR, FLOWCHART_DIMENSIONS, DEFAULT_DIMENSIONS, SHADOWS, TYPOGRAPHY, HANDLE_STYLE, ANIMATION } from './flowchartTokens'
import type { FlowchartNodeData } from './FlowchartNodeData'

type FlowchartNodeType = Node<FlowchartNodeData, string>

const HANDLE_STYLE_BASE: React.CSSProperties = {
  width: HANDLE_STYLE.size,
  height: HANDLE_STYLE.size,
  background: HANDLE_STYLE.bg,
  border: HANDLE_STYLE.border,
  opacity: 0,
  transform: 'scale(0.5)',
  transition: `opacity ${ANIMATION.handleScale}, transform ${ANIMATION.handleScale}`,
}

/** Strip HTML tags from a string for plain-text preview. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function FlowchartNodeInner({ id, data, type, selected }: NodeProps<FlowchartNodeType>) {
  const nodeData = data as FlowchartNodeData
  const { label, content, editMode, onNodeClick } = nodeData

  const nodeType = type ?? 'process'
  const colors = FLOWCHART_COLORS[nodeType as keyof typeof FLOWCHART_COLORS] ?? DEFAULT_COLOR
  const dims = FLOWCHART_DIMENSIONS[nodeType as keyof typeof FLOWCHART_DIMENSIONS] ?? DEFAULT_DIMENSIONS

  const handleClick = useCallback(() => {
    if (editMode && onNodeClick) {
      onNodeClick(id)
    }
  }, [editMode, onNodeClick, id])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (nodeData.editMode && nodeData.onNodeDoubleClick) {
      nodeData.onNodeDoubleClick(id)
    }
  }, [nodeData.editMode, nodeData.onNodeDoubleClick, id])

  const contentPreview = useMemo(() => {
    if (!content) return null
    const plain = stripHtml(String(content)).trim()
    if (!plain) return null
    return plain
  }, [content])

  const transitionStyle = `box-shadow ${ANIMATION.hover}, transform ${ANIMATION.selection}`

  // Shared handles (4 positions, each with source + target)
  const handles = (
    <>
      <Handle type="target" position={Position.Top} id="top-tgt" style={HANDLE_STYLE_BASE} />
      <Handle type="source" position={Position.Top} id="top-src" style={HANDLE_STYLE_BASE} />
      <Handle type="target" position={Position.Right} id="right-tgt" style={HANDLE_STYLE_BASE} />
      <Handle type="source" position={Position.Right} id="right-src" style={HANDLE_STYLE_BASE} />
      <Handle type="target" position={Position.Bottom} id="bottom-tgt" style={HANDLE_STYLE_BASE} />
      <Handle type="source" position={Position.Bottom} id="bottom-src" style={HANDLE_STYLE_BASE} />
      <Handle type="target" position={Position.Left} id="left-tgt" style={HANDLE_STYLE_BASE} />
      <Handle type="source" position={Position.Left} id="left-src" style={HANDLE_STYLE_BASE} />
    </>
  )

  // Text content shared across all shapes
  const textContent = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', padding: '10px 16px', boxSizing: 'border-box' }}>
      <div
        title={label}
        style={{ fontWeight: TYPOGRAPHY.labelWeight, fontSize: TYPOGRAPHY.labelSize, color: TYPOGRAPHY.labelColor, lineHeight: '1.3', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
      >
        {label}
      </div>
      {contentPreview && (
        <div style={{ fontSize: TYPOGRAPHY.previewSize, color: TYPOGRAPHY.previewColor, lineHeight: '1.3', textAlign: 'center', marginTop: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', maxWidth: '100%', wordBreak: 'break-word' }}>
          {contentPreview}
        </div>
      )}
    </div>
  )

  const outerBase: React.CSSProperties = {
    width: dims.w,
    height: dims.h,
    position: 'relative',
    cursor: editMode && onNodeClick ? 'pointer' : 'default',
  }

  // --- Stadium / Pill (start, end) ---
  if (nodeType === 'start' || nodeType === 'end') {
    return (
      <div className="flowchart-node-wrapper" data-node-type={nodeType} style={outerBase} onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <div style={{
          width: '100%',
          height: '100%',
          borderRadius: dims.h / 2,
          background: colors.bg,
          border: `${selected ? '2.5px' : '1.5px'} solid ${colors.border}`,
          boxShadow: selected ? SHADOWS.nodeSelected(colors.border) : SHADOWS.node,
          transition: transitionStyle,
          transform: selected ? 'scale(1.02)' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {textContent}
        </div>
        {handles}
      </div>
    )
  }

  // --- Diamond (decision) ---
  if (nodeType === 'decision') {
    const side = Math.min(dims.w, dims.h) * 0.75
    const diagSize = side * Math.SQRT2
    return (
      <div className="flowchart-node-wrapper" data-node-type={nodeType} style={{ width: diagSize, height: diagSize, position: 'relative', cursor: outerBase.cursor, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <div style={{
          position: 'absolute',
          width: side,
          height: side,
          transform: selected ? 'rotate(45deg) scale(1.02)' : 'rotate(45deg)',
          background: colors.bg,
          border: `${selected ? '2.5px' : '1.5px'} solid ${colors.border}`,
          boxShadow: selected ? SHADOWS.nodeSelected(colors.border) : SHADOWS.node,
          transition: transitionStyle,
          borderRadius: 4,
        }} />
        <div style={{ position: 'relative', zIndex: 1, width: side * 1.1, maxWidth: dims.w * 0.85, textAlign: 'center' }}>
          {textContent}
        </div>
        {handles}
      </div>
    )
  }

  // --- Parallelogram (io) ---
  if (nodeType === 'io') {
    const skewPad = Math.ceil(dims.h * Math.tan(8 * Math.PI / 180) / 2) + 2
    return (
      <div className="flowchart-node-wrapper" data-node-type={nodeType} style={{ ...outerBase, width: dims.w + skewPad * 2, paddingLeft: skewPad, paddingRight: skewPad, boxSizing: 'border-box' }} onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: skewPad,
          right: skewPad,
          bottom: 0,
          transform: selected ? 'skewX(-8deg) scale(1.02)' : 'skewX(-8deg)',
          background: colors.bg,
          border: `${selected ? '2.5px' : '1.5px'} solid ${colors.border}`,
          borderRadius: 4,
          boxShadow: selected ? SHADOWS.nodeSelected(colors.border) : SHADOWS.node,
          transition: transitionStyle,
        }} />
        <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
          {textContent}
        </div>
        {handles}
      </div>
    )
  }

  // --- Rectangle (process, default) ---
  return (
    <div className="flowchart-node-wrapper" data-node-type={nodeType} style={outerBase} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      <div style={{
        width: '100%',
        height: '100%',
        borderRadius: 8,
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        boxShadow: selected ? SHADOWS.nodeSelected(colors.border) : SHADOWS.node,
        transition: transitionStyle,
        transform: selected ? 'scale(1.02)' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {textContent}
      </div>
      {handles}
    </div>
  )
}

export const FlowchartNode = memo(FlowchartNodeInner)
