/**
 * Off-screen flowchart capture for HLD PDF: renders React Flow, fits view, then exports viewport to PNG.
 */
import { useCallback, useEffect, useRef } from 'react'
import { toPng } from 'html-to-image'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { FlowchartCanvas } from '../components/planning/FlowchartCanvas'

/** Max time to wait for PNG capture before giving up (ms). */
const CAPTURE_TIMEOUT_MS = 15_000

function noopNodesChange() {}

function attributionFilter(domNode: globalThis.Node): boolean {
  if (domNode instanceof HTMLElement && domNode.classList.contains('react-flow__attribution')) return false
  return true
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Capture timed out')), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

async function captureViewportToPng(captureRootId: string): Promise<string | null> {
  const root = document.getElementById(captureRootId)
  const viewportElement = root?.querySelector('.react-flow__viewport') as HTMLElement | null
  if (!viewportElement) return null
  try {
    const png = await withTimeout(
      toPng(viewportElement, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        filter: attributionFilter,
      }),
      CAPTURE_TIMEOUT_MS
    )
    return png
  } catch {
    return null
  }
}

function rafTwice(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

export interface HldFlowchartCaptureProps {
  /** DOM id of the capture root (must match the container rendered by FlowchartCanvas). */
  captureRootId: string
  /** Flow nodes to render. */
  nodes: Node[]
  /** Flow edges to render. */
  edges: Edge[]
  /** Called with PNG data URL when capture finishes, or null on failure/timeout. */
  onCaptureDone: (dataUrl: string | null) => void
}

export function HldFlowchartCapture({
  captureRootId,
  nodes,
  edges,
  onCaptureDone,
}: HldFlowchartCaptureProps) {
  const finishedRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const onFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      if (finishedRef.current) return
      void (async () => {
        try {
          instance.fitView({ padding: 0.12, maxZoom: 1.25, minZoom: 0.05 })
        } catch {
          /* empty graph edge cases */
        }
        rafTwice(async () => {
          if (finishedRef.current || unmountedRef.current) return
          finishedRef.current = true
          const url = await captureViewportToPng(captureRootId)
          if (unmountedRef.current) return
          onCaptureDone(url)
        })
      })()
    },
    [captureRootId, onCaptureDone]
  )

  return (
    <div
      aria-hidden
      className="fixed left-[-12000px] top-0 h-[900px] w-[1400px] overflow-hidden bg-cream-surface"
      style={{ zIndex: -9999 }}
    >
      <FlowchartCanvas
        exportRootId={captureRootId}
        minimalChrome
        nodes={nodes}
        edges={edges}
        viewport={{ x: 0, y: 0, zoom: 0.85 }}
        onNodesChange={noopNodesChange}
        editMode={false}
        onFlowInit={onFlowInit}
      />
    </div>
  )
}
