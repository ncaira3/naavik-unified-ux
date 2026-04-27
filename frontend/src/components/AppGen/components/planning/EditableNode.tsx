import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'

interface EditableNodeData {
  label: string
  editMode?: boolean
  onLabelChange?: (newLabel: string) => void
  [key: string]: unknown
}

function EditableNodeInner({ data }: NodeProps) {
  const { label, editMode, onLabelChange } = data as EditableNodeData
  const [isInputActive, setIsInputActive] = useState(false)
  const [draft, setDraft] = useState(label)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync draft when label changes externally (e.g. cancel revert)
  useEffect(() => {
    if (!isInputActive) setDraft(label)
  }, [label, isInputActive])

  // Auto-resize textarea to fit content (no scroll)
  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [])

  // Auto-focus, select, and size when input activates
  useEffect(() => {
    if (isInputActive && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
      autoResize()
    }
  }, [isInputActive, autoResize])

  const commit = useCallback(() => {
    setIsInputActive(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label && onLabelChange) {
      onLabelChange(trimmed)
    } else {
      setDraft(label)
    }
  }, [draft, label, onLabelChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        setDraft(label)
        setIsInputActive(false)
      }
    },
    [commit, label]
  )

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        className={`px-3 py-2 text-center text-sm text-text-primary select-none${editMode ? ' nodrag nopan' : ''}`}
        style={{ minWidth: 140, minHeight: 32 }}
        onClick={editMode ? () => setIsInputActive(true) : undefined}
      >
        {editMode && isInputActive ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autoResize() }}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className="nodrag nowheel w-full resize-none border-none bg-transparent p-0 text-center text-sm text-text-primary outline-none focus:ring-1 focus:ring-blue-400 rounded overflow-hidden"
          />
        ) : (
          <span
            className={editMode ? 'cursor-text hover:bg-blue-50/50 rounded px-1 -mx-1 transition-colors' : ''}
          >
            {label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  )
}

export const EditableNode = memo(EditableNodeInner)
