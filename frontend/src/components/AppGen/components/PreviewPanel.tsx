import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Radio,
} from 'lucide-react'
import { previewApi, PreviewStatus } from '../lib/api'

interface PreviewPanelProps {
  sessionId: string
}

const STATUS_POLL_MS = 2500

export function PreviewPanel({ sessionId }: PreviewPanelProps) {
  const [status, setStatus] = useState<PreviewStatus>({ status: 'not_started' })
  const [isActing, setIsActing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const nextStatus = await previewApi.getStatus(sessionId)
      setStatus(nextStatus)
      if (
        nextStatus.status === 'running' ||
        nextStatus.status === 'error' ||
        nextStatus.status === 'not_started' ||
        nextStatus.status === 'stopped'
      ) {
        stopPolling()
      }
    } catch {
      // Ignore transient polling failures while the runtime settles.
    }
  }, [sessionId, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(fetchStatus, STATUS_POLL_MS)
  }, [fetchStatus, stopPolling])

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  useEffect(() => {
    if (status.status === 'running') {
      previewApi.getAppUrl(sessionId).then(setPreviewUrl).catch(() => setPreviewUrl(null))
      return
    }
    setPreviewUrl(null)
  }, [sessionId, status.status])

  const handleStart = async () => {
    setIsActing(true)
    try {
      const nextStatus = await previewApi.start(sessionId)
      setStatus(nextStatus)
      startPolling()
    } catch (err) {
      setStatus({ status: 'error', error: String(err) })
    } finally {
      setIsActing(false)
    }
  }

  const handleStop = async () => {
    setIsActing(true)
    stopPolling()
    try {
      await previewApi.stop(sessionId)
      setStatus({ status: 'not_started' })
    } catch (err) {
      setStatus({ status: 'error', error: String(err) })
    } finally {
      setIsActing(false)
    }
  }

  const handleOpenInNewTab = async () => {
    const url = previewUrl ?? (await previewApi.getAppUrl(sessionId))
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const isBuilding = status.status === 'building' || status.status === 'starting'
  const isRunning = status.status === 'running'
  const isError = status.status === 'error'
  const isStopped = status.status === 'not_started' || status.status === 'stopped'

  const statusBadge = isBuilding
    ? { label: status.status === 'starting' ? 'Starting runtime' : 'Building preview', tone: 'bg-amber-50 text-amber-700' }
    : isRunning
    ? { label: 'Preview live', tone: 'bg-emerald-50 text-emerald-700' }
    : isError
    ? { label: 'Preview failed', tone: 'bg-red-50 text-red-700' }
    : { label: 'Ready to launch', tone: 'bg-cream-surface-light text-text-secondary' }

  return (
    <div className="h-full flex flex-col bg-[linear-gradient(180deg,_rgba(248,250,252,0.9)_0%,_rgba(255,255,255,0.96)_100%)]">
      <div className="flex items-center gap-3 border-b border-border bg-white/85 px-4 py-3 backdrop-blur-sm">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-cream-bg">
          <Radio className="h-4 w-4 text-text-secondary" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">Preview Runtime</p>
          <p className="text-xs text-text-muted">Build and inspect the assembled app before packaging handoff.</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge.tone}`}>
            {isBuilding && <Loader2 className="h-3 w-3 animate-spin" />}
            {isRunning && <CheckCircle2 className="h-3 w-3" />}
            {isError && <AlertCircle className="h-3 w-3" />}
            {isStopped && <Radio className="h-3 w-3" />}
            {statusBadge.label}
          </span>

          <button
            onClick={fetchStatus}
            title="Refresh status"
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-slate-100 hover:text-text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {isRunning && (
            <button
              onClick={handleOpenInNewTab}
              title="Open in new tab"
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-slate-100 hover:text-text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}

          {isStopped || isError ? (
            <button
              onClick={handleStart}
              disabled={isActing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={isActing || isBuilding}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {isStopped && (
          <div className="flex h-full flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border bg-white/80 px-6 py-10 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cream-surface-light">
              <Radio className="h-8 w-8 text-text-muted" />
            </span>
            <div className="max-w-md">
              <p className="text-base font-semibold text-text-primary">Preview is idle</p>
              <p className="mt-2 text-sm text-text-muted">
                Start the runtime after assembly to verify routes, inspect responses, and confirm the generated app is behaving as expected.
              </p>
            </div>
            <div className="grid w-full max-w-3xl gap-3 md:grid-cols-3">
              <PreviewHint title="Build package" detail="Use the current assembly output and runtime config." />
              <PreviewHint title="Start container" detail="Launch the packaged app in an isolated preview runtime." />
              <PreviewHint title="Inspect behavior" detail="Open the app and validate its generated workflow." />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleStart}
                disabled={isActing}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                {isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Preview
              </button>
              <span className="text-xs text-text-muted">Session: {sessionId}</span>
            </div>
          </div>
        )}

        {isBuilding && (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-white/90 px-6 py-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
            <div>
              <p className="text-base font-semibold text-text-primary">
                {status.status === 'starting' ? 'Starting rApp runtime' : 'Building Docker image'}
              </p>
              <p className="mt-2 text-sm text-text-muted">
                {status.status === 'starting'
                  ? 'Container is running. Waiting for the service health check to succeed.'
                  : 'This usually takes 30–90 seconds for a Python-based app.'}
              </p>
            </div>
            <div className="h-2 w-64 overflow-hidden rounded-full bg-cream-surface-light">
              <div className="h-full w-3/4 animate-pulse rounded-full bg-amber-500" />
            </div>
            <p className="text-xs text-text-muted">The live preview will appear here automatically once the runtime is ready.</p>
          </div>
        )}

        {isError && (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-red-200 bg-white/95 px-6 py-10 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div className="max-w-2xl">
              <p className="text-base font-semibold text-red-600">Preview failed to start</p>
              <p className="mt-2 text-sm text-text-muted">
                The packaged app did not reach a healthy runtime state. Review the failure output and retry after fixes.
              </p>
              <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-red-100 bg-cream-bg p-3 text-left text-xs text-text-secondary">
                {status.error ?? 'Unknown error'}
              </pre>
            </div>
            <button
              onClick={handleStart}
              disabled={isActing}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry
            </button>
          </div>
        )}

        {isRunning && previewUrl && (
          <div className="h-full overflow-hidden rounded-2xl border border-border bg-cream-surface shadow-aira-sm">
            <iframe
              key={previewUrl}
              src={previewUrl}
              className="h-full w-full border-0"
              title="rApp Preview"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        )}

        {isRunning && !previewUrl && (
          <div className="flex h-full items-center justify-center rounded-2xl border border-border bg-cream-surface">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewHint({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-cream-bg px-4 py-3 text-left">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-xs text-text-muted">{detail}</p>
    </div>
  )
}
