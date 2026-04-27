import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { getSmoothStepPath, BaseEdge } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { EDGE_STYLE, ANIMATION, TYPOGRAPHY } from './flowchartTokens'

interface EditableEdgeData {
  editMode?: boolean
  onLabelChange?: (newLabel: string) => void
  [key: string]: unknown
}

function EditableEdgeInner({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const { editMode, onLabelChange } = (data ?? {}) as EditableEdgeData
  const edgeData = data as EditableEdgeData | undefined
  const [hovered, setHovered] = useState(false)
  const [isInputActive, setIsInputActive] = useState(false)
  const [addingLabel, setAddingLabel] = useState(false)
  const labelStr = typeof label === 'string' ? label : ''
  const [draft, setDraft] = useState(labelStr)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isInputActive) setDraft(labelStr)
  }, [labelStr, isInputActive])

  useEffect(() => {
    if (isInputActive && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isInputActive])

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const commit = useCallback(() => {
    setIsInputActive(false)
    const trimmed = draft.trim()
    if (trimmed !== labelStr && onLabelChange) {
      onLabelChange(trimmed)
    } else {
      setDraft(labelStr)
    }
  }, [draft, labelStr, onLabelChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        setDraft(labelStr)
        setIsInputActive(false)
      }
    },
    [commit, labelStr]
  )

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: hovered ? EDGE_STYLE.strokeHover : (style?.stroke ?? EDGE_STYLE.stroke),
          strokeWidth: hovered ? EDGE_STYLE.strokeWidthHover : (style?.strokeWidth ?? EDGE_STYLE.strokeWidth),
          transition: `stroke ${ANIMATION.hover}, stroke-width ${ANIMATION.hover}`,
        }}
        interactionWidth={20}
      />
      {labelStr && (
        <foreignObject
          x={labelX - 50}
          y={labelY - 12}
          width={100}
          height={24}
          requiredExtensions="http://www.w3.org/1999/xhtml"
          className={editMode ? 'nodrag nopan' : ''}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
            }}
          >
            {editMode && isInputActive ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={handleKeyDown}
                className="nodrag nowheel nopan w-full border border-blue-300 bg-cream-surface rounded px-1 text-center outline-none focus:ring-1 focus:ring-blue-400"
                style={{ fontSize: 11, fontWeight: 600, color: TYPOGRAPHY.edgeLabelColor, height: 20 }}
              />
            ) : (
              <span
                onClick={editMode ? () => setIsInputActive(true) : undefined}
                className={`${editMode ? 'nodrag nopan cursor-text hover:bg-blue-50 rounded transition-colors' : ''}`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: TYPOGRAPHY.edgeLabelColor,
                  background: '#ffffff',
                  border: `0.5px solid ${EDGE_STYLE.labelBorder}`,
                  borderRadius: 3,
                  padding: '1px 6px',
                  whiteSpace: 'nowrap',
                }}
              >
                {labelStr}
              </span>
            )}
          </div>
        </foreignObject>
      )}
      {!labelStr && edgeData?.editMode && (
        <foreignObject
          x={labelX - 50}
          y={labelY - 12}
          width={100}
          height={24}
          className="pointer-events-auto"
        >
          {addingLabel ? (
            <input
              autoFocus
              defaultValue=""
              className="nodrag nopan nowheel w-full rounded border border-blue-300 bg-cream-surface px-2 py-0.5 text-center text-xs shadow-sm outline-none"
              onBlur={(e) => {
                const val = e.target.value.trim()
                if (val && edgeData?.onLabelChange) edgeData.onLabelChange(val)
                setAddingLabel(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setAddingLabel(false)
              }}
            />
          ) : (
            <div
              onDoubleClick={() => setAddingLabel(true)}
              className="w-full h-full cursor-text opacity-0 hover:opacity-100 flex items-center justify-center"
            >
              <span className="rounded bg-cream-surface-light px-2 py-0.5 text-[10px] text-text-muted">+ label</span>
            </div>
          )}
        </foreignObject>
      )}
    </g>
  )
}

export const EditableEdge = memo(EditableEdgeInner)
