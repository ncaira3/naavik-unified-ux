import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileDown } from 'lucide-react'
import { buildHldPdf, downloadHldBlob } from '../../lib/buildHldPdf'
import { HldFlowchartCapture } from '../../lib/hldFlowchartCapture'
import type { Edge, Node } from '@xyflow/react'

export interface PlanningHldDownloadButtonProps {
  sessionId: string
  /** Current plan text (saved or in-editor draft). */
  planMarkdown: string
  /** Sanitized nodes/edges for PNG capture; empty nodes → PDF without diagram. */
  exportNodes: Node[]
  exportEdges: Edge[]
  disabled?: boolean
}

interface ExportJob {
  markdown: string
  nodes: Node[]
  edges: Edge[]
  captureId: string
}

export function PlanningHldDownloadButton({
  sessionId,
  planMarkdown,
  exportNodes,
  exportEdges,
  disabled = false,
}: PlanningHldDownloadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [exportJob, setExportJob] = useState<ExportJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeCaptureIdRef = useRef<string | null>(null)
  const capturePayloadRef = useRef<{ markdown: string; captureId: string } | null>(null)

  const finishPdf = useCallback(
    (markdown: string, flowchartPng: string | null, captureId: string) => {
      if (activeCaptureIdRef.current !== captureId) {
        capturePayloadRef.current = null
        return
      }
      activeCaptureIdRef.current = null
      capturePayloadRef.current = null
      try {
        const blob = buildHldPdf({
          projectName: sessionId,
          planMarkdown: markdown,
          flowchartDataUrl: flowchartPng,
        })
        downloadHldBlob(blob, sessionId)
        setError(null)
      } catch {
        setError('Could not build the HLD PDF.')
      } finally {
        setBusy(false)
        setExportJob(null)
      }
    },
    [sessionId]
  )

  const onCaptureDone = useCallback(
    (dataUrl: string | null) => {
      const payload = capturePayloadRef.current
      if (!payload) return
      finishPdf(payload.markdown, dataUrl, payload.captureId)
    },
    [finishPdf]
  )

  const onClick = useCallback(() => {
    if (busy || disabled) return
    setError(null)
    const md = planMarkdown.trim()
    if (!md) {
      setError('Add plan content before downloading HLD.')
      return
    }
    setBusy(true)
    if (exportNodes.length > 0) {
      const captureId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      activeCaptureIdRef.current = captureId
      capturePayloadRef.current = { markdown: planMarkdown, captureId }
      setExportJob({
        markdown: planMarkdown,
        nodes: exportNodes,
        edges: exportEdges,
        captureId,
      })
    } else {
      activeCaptureIdRef.current = null
      try {
        const blob = buildHldPdf({
          projectName: sessionId,
          planMarkdown,
          flowchartDataUrl: null,
        })
        downloadHldBlob(blob, sessionId)
        setError(null)
      } catch {
        setError('Could not build the HLD PDF.')
      } finally {
        setBusy(false)
      }
    }
  }, [busy, disabled, planMarkdown, exportNodes, exportEdges, sessionId])

  const captureRootId = exportJob ? `hld-capture-${exportJob.captureId}` : ''

  const portal =
    exportJob && exportJob.nodes.length > 0
      ? createPortal(
          <HldFlowchartCapture
            captureRootId={captureRootId}
            nodes={exportJob.nodes}
            edges={exportJob.edges}
            onCaptureDone={onCaptureDone}
          />,
          document.body
        )
      : null

  return (
    <div className="flex flex-col items-end gap-1">
      {portal}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        title="Download High-Level Design PDF (current plan and flowchart)"
        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-cream-surface px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-busy={busy}
      >
        <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {busy ? 'Generating…' : 'Download HLD'}
      </button>
      {error && (
        <p
          className="max-w-[240px] text-right text-[10px] text-red-600"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      )}
    </div>
  )
}
