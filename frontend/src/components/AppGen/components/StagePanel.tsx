import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Download,
  FileCode,
  Info,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TestAndValidationView } from './TestAndValidationView'
import { TestValidationView } from './TestValidationView'
import { TestingView } from './TestingView'
import { UnitTestResultsView } from './UnitTestResultsView'
import { getAuthToken } from '../lib/api'
import type { TestScenario } from './testValidation/types'
import {
  ArtifactSection,
  MetricCard,
  StageBody,
  StageCard,
  StageEmptyState,
  StageHeader,
  StageSurface,
} from './workspace/StagePrimitives'

export interface TestArtifactsPayload {
  testingArtifact: Record<string, any> | null
  refresh: () => void
}

interface StagePanelProps {
  stage: string
  artifact: Record<string, any> | null
  latestAssistantContent?: string
  sessionId?: string
  testArtifacts?: TestArtifactsPayload | null
  onRefresh?: () => void
  onFileSelect?: (filePath: string) => void
  onRunIntegrationTests?: (scenario?: TestScenario) => void
  isAgentBusy?: boolean
  isRunningIntegrationTests?: boolean
}

const STAGE_META: Record<string, { title: string; description: string }> = {
  code_audit: {
    title: 'Code Audit Report',
    description: 'Lightweight checks, safe autofixes, and remaining issues.',
  },
  testing: {
    title: 'Testing',
    description: 'Unified unit and functional testing workspace.',
  },
  unit_testing: {
    title: 'Test Results',
    description: 'Unit and functional coverage for the generated app.',
  },
  app_assembly: {
    title: 'Assembly Manifest',
    description: 'Packaged files and delivery-ready artifacts.',
  },
  integration_validation: {
    title: 'Validation Report',
    description: 'Scenario validation aligned to the approved plan.',
  },
}

export function StagePanel({
  stage,
  artifact,
  latestAssistantContent,
  sessionId,
  testArtifacts,
  onRefresh,
  onFileSelect,
  onRunIntegrationTests,
  isAgentBusy,
  isRunningIntegrationTests = false,
}: StagePanelProps) {
  const meta = STAGE_META[stage] ?? {
    title: stage,
    description: 'Stage artifact will appear here once the agent finishes its work.',
  }

  if (stage === 'testing' && testArtifacts) {
    return (
      <TestingView
        artifact={testArtifacts.testingArtifact}
        sessionId={sessionId}
        onArtifactUpdated={testArtifacts.refresh}
        onFileSelect={onFileSelect}
        onRunTests={onRunIntegrationTests}
        isRunning={isRunningIntegrationTests}
      />
    )
  }

  if ((stage === 'unit_testing' || stage === 'integration_validation') && testArtifacts) {
    return (
      <TestAndValidationView
        unitArtifact={null}
        integrationArtifact={null}
        sessionId={sessionId}
        onRefresh={testArtifacts.refresh}
        onFileSelect={onFileSelect}
        onRunIntegrationTests={onRunIntegrationTests}
        isAgentBusy={isAgentBusy}
        isRunningIntegrationTests={isRunningIntegrationTests}
      />
    )
  }

  if (!artifact) {
    if (stage === 'code_audit' && (latestAssistantContent ?? '').trim()) {
      return (
        <StageSurface>
          <StageHeader
            icon={AlertTriangle}
            title="Code Audit Report (Live)"
            description="Artifact was not persisted yet. Showing latest audit output from chat."
          />
          <StageBody>
            <StageCard eyebrow="Live Output" title="Latest audit response">
              <div className="markdown-body max-w-none rounded-2xl border border-border bg-cream-surface p-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestAssistantContent ?? ''}</ReactMarkdown>
              </div>
            </StageCard>
          </StageBody>
        </StageSurface>
      )
    }
    return <StageEmptyState icon={FileCode} title={`${meta.title} is not available yet`} description={`${meta.description} Run the stage from chat or advance the pipeline to populate this view.`} />
  }

  switch (stage) {
    case 'code_audit':
      return <AuditReportView artifact={artifact} onFileSelect={onFileSelect} />
    case 'unit_testing':
      return <UnitTestResultsView artifact={artifact} onFileSelect={onFileSelect} />
    case 'app_assembly':
      return <AssemblyView artifact={artifact} sessionId={sessionId} onFileSelect={onFileSelect} />
    case 'integration_validation':
      return (
        <TestValidationView
          artifact={artifact}
          sessionId={sessionId}
          onArtifactUpdated={onRefresh}
        />
      )
    default:
      return <GenericArtifactView artifact={artifact} title={meta.title} description={meta.description} />
  }
}

function ClickableFile({
  filePath,
  line,
  onFileSelect,
  className = '',
}: {
  filePath: string
  line?: number
  onFileSelect?: (path: string) => void
  className?: string
}) {
  if (!onFileSelect) {
    return (
      <span className={`font-mono ${className}`}>
        {filePath}
        {line ? `:${line}` : ''}
      </span>
    )
  }

  return (
    <button
      onClick={() => onFileSelect(filePath)}
      className={`font-mono text-accent hover:text-accent-hover hover:underline cursor-pointer text-left ${className}`}
      title={`Open ${filePath}`}
    >
      {filePath}
      {line ? `:${line}` : ''}
    </button>
  )
}

function AuditReportView({
  artifact,
  onFileSelect,
}: {
  artifact: Record<string, any>
  onFileSelect?: (path: string) => void
}) {
  const detected = Array.isArray(artifact.issues) ? artifact.issues : Array.isArray(artifact.findings) ? artifact.findings : []
  const fixed = Array.isArray(artifact.fixed) ? artifact.fixed : []
  const summary = typeof artifact.summary === 'object' && artifact.summary !== null ? artifact.summary : null
  const normalizeMessage = (value: unknown): string =>
    String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^fixed[:\s-]*/i, '')
      .trim()

  const locationKey = (item: any): string => {
    const file = String(item?.file || item?.path || '').trim().toLowerCase()
    const line = Number.isFinite(Number(item?.line)) ? String(Number(item.line)) : ''
    return `${file}:${line}`
  }

  const fixedByLocation = new Set(
    fixed
      .map((item: any) => locationKey(item))
      .filter((key: string) => key !== ':')
  )

  const fixedByMessage = new Set(
    fixed
      .map((item: any) => normalizeMessage(item?.message || item?.title))
      .filter(Boolean)
  )

  const isResolved = (issue: any): boolean => {
    const issueLoc = locationKey(issue)
    if (issueLoc !== ':' && fixedByLocation.has(issueLoc)) return true
    const msg = normalizeMessage(issue?.message || issue?.title)
    return Boolean(msg && fixedByMessage.has(msg))
  }

  const unresolved = detected.filter((issue: any) => !isResolved(issue))

  const unresolvedReason = (issue: any): string => {
    const explicit =
      issue?.not_fixed_reason ||
      issue?.reason ||
      issue?.fix_reason ||
      issue?.remediation_reason ||
      issue?.blocker
    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.trim()
    }

    const file = String(issue?.file || '').toLowerCase()
    if (file.startsWith('adaptors/')) {
      return 'Not fixed automatically because this file is part of read-only adapter boilerplate.'
    }

    const severity = String(issue?.severity || '').toLowerCase()
    if (severity === 'critical' || severity === 'high') {
      return 'Not fixed automatically to avoid risky behavior changes; this needs a targeted manual/codegen fix.'
    }

    return 'No safe auto-fix was available in this audit pass.'
  }

  return (
    <StageSurface>
      <StageBody>
      <StageCard eyebrow="Overview" title="Audit health">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Detected" value={detected.length} tone={detected.length > 0 ? 'warning' : 'default'} />
          <MetricCard label="Fixed" value={fixed.length} tone={fixed.length > 0 ? 'success' : 'default'} />
          <MetricCard label="Open Risk" value={unresolved.length} tone={unresolved.length > 0 ? 'danger' : 'default'} />
        </div>

        {summary && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MetricCard label="High" value={summary.high ?? 0} tone={(summary.high ?? 0) > 0 ? 'danger' : 'default'} />
            <MetricCard label="Medium" value={summary.medium ?? 0} tone={(summary.medium ?? 0) > 0 ? 'warning' : 'default'} />
            <MetricCard label="Low" value={summary.low ?? 0} tone={(summary.low ?? 0) > 0 ? 'success' : 'default'} />
          </div>
        )}
      </StageCard>

      {fixed.length > 0 && (
        <StageCard eyebrow="Resolved" title="Auto-fixed issues">
          <ArtifactSection
            title="Auto-fixed issues"
            description="These issues were detected and resolved safely during audit."
          >
            <ul className="space-y-3">
              {fixed.map((item: any, index: number) => (
                <li key={index} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 rounded-full bg-cream-surface px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Fixed
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary">{item.message || 'Issue resolved'}</p>
                      {item.file && (
                        <ClickableFile
                          filePath={item.file}
                          line={item.line}
                          onFileSelect={onFileSelect}
                          className="mt-1 block text-xs"
                        />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </ArtifactSection>
        </StageCard>
      )}

      <StageCard eyebrow="Remaining Work" title="Unresolved findings">
        <ArtifactSection
          title="Unresolved findings"
          description="Only findings that remain unresolved after auto-fixes. Each item includes why it was not fixed."
        >
          {unresolved.length > 0 ? (
            <ul className="space-y-3">
              {unresolved.map((issue: any, index: number) => (
                <li key={index} className="rounded-2xl border border-border bg-cream-surface p-4 shadow-aira-sm">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                      issue.severity === 'critical' || issue.severity === 'high'
                        ? 'bg-red-50 text-red-700'
                        : issue.severity === 'warning' || issue.severity === 'medium'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-sky-50 text-sky-700'
                    }`}>
                      {issue.severity || 'info'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary">{issue.message || issue.title}</p>
                      {issue.file && (
                        <ClickableFile
                          filePath={issue.file}
                          line={issue.line}
                          onFileSelect={onFileSelect}
                          className="mt-1 block text-xs"
                        />
                      )}
                      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <span className="font-semibold">Why not fixed:</span> {unresolvedReason(issue)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              No issues detected in the current audit run.
            </div>
          )}
        </ArtifactSection>
      </StageCard>
      </StageBody>
    </StageSurface>
  )
}

function AssemblyView({
  artifact,
  sessionId,
  onFileSelect,
}: {
  artifact: Record<string, any>
  sessionId?: string
  onFileSelect?: (path: string) => void
}) {
  const [showLogs, setShowLogs] = useState(false)
  const [showRawPayload, setShowRawPayload] = useState(false)
  const items = Array.isArray(artifact.items) ? artifact.items : []
  const packageInfo = (artifact.package_info ?? artifact.package ?? artifact.metadata ?? {}) as Record<string, any>
  const build = (artifact.build ?? {}) as Record<string, any>
  const checks = Array.isArray(artifact.checks) ? artifact.checks : []
  const notes = Array.isArray(artifact.notes) ? artifact.notes.filter(Boolean) : []
  const nextSteps = Array.isArray(artifact.next_steps) ? artifact.next_steps.filter(Boolean) : []

  const logs = useMemo(() => {
    if (Array.isArray(artifact.logs)) return artifact.logs
    if (Array.isArray(artifact.build_logs)) return artifact.build_logs
    if (typeof artifact.logs === 'string') {
      return artifact.logs
        .split('\n')
        .map((line: string, index: number) => ({ id: index, message: line, level: 'info' }))
        .filter((log: any) => String(log.message || '').trim())
    }
    return []
  }, [artifact.build_logs, artifact.logs])

  const downloads = useMemo(() => {
    if (Array.isArray(artifact.downloads)) return artifact.downloads
    const fallback: Array<Record<string, any>> = []
    if (artifact.download_url || artifact.package_url || artifact.package_path) {
      fallback.push({
        label: 'Download Package',
        type: 'package',
        url: artifact.download_url || artifact.package_url,
        path: artifact.package_path,
        enabled: true,
      })
    }
    if (artifact.code_url || artifact.code_path) {
      fallback.push({
        label: 'Download Code',
        type: 'code',
        url: artifact.code_url,
        path: artifact.code_path,
        enabled: true,
      })
    }
    return fallback
  }, [artifact.code_path, artifact.code_url, artifact.download_url, artifact.downloads, artifact.package_path, artifact.package_url])

  const appName = String(packageInfo.app_name || packageInfo.name || artifact.app_name || 'App package')
  const version = String(packageInfo.version || artifact.version || '1.0.0')
  const description = String(
    packageInfo.description || artifact.description || 'Create a deployable package for your application'
  )
  const packageFormat = String(packageInfo.format || packageInfo.target_format || artifact.format || 'csar').toUpperCase()
  const packageStatus = String(
    packageInfo.status || build.status || artifact.status || (items.length > 0 ? 'completed' : 'pending')
  ).toLowerCase()
  const progress = Number.isFinite(Number(build.progress))
    ? Math.max(0, Math.min(100, Number(build.progress)))
    : packageStatus === 'completed'
    ? 100
    : packageStatus === 'failed'
    ? 100
    : items.length > 0
    ? 75
    : 0

  const createdCount = items.filter((item: any) => String(item.status || '').toLowerCase() === 'created').length
  const updatedCount = items.filter((item: any) => String(item.status || '').toLowerCase() === 'updated').length
  const failedCount = items.filter((item: any) => String(item.status || '').toLowerCase() === 'failed').length
  const passedChecks = checks.filter((check: any) => String(check.status || '').toLowerCase() === 'passed').length
  const failedChecks = checks.filter((check: any) => String(check.status || '').toLowerCase() === 'failed').length
  const hasManifestDetails =
    items.length > 0 ||
    checks.length > 0 ||
    logs.length > 0 ||
    downloads.length > 0 ||
    notes.length > 0 ||
    nextSteps.length > 0 ||
    Object.keys(packageInfo).length > 0 ||
    Object.keys(build).length > 0
  const effectiveStatus =
    packageStatus === 'pending' && hasManifestDetails ? 'partial' : packageStatus

  const statusPillClass =
    effectiveStatus === 'completed'
      ? 'bg-emerald-50 text-emerald-700'
      : effectiveStatus === 'failed'
      ? 'bg-red-50 text-red-700'
      : effectiveStatus === 'partial'
      ? 'bg-sky-50 text-sky-700'
      : effectiveStatus === 'processing' || effectiveStatus === 'running' || effectiveStatus === 'packaging'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-cream-surface-light text-text-secondary'

  const levelClass = (level: string) => {
    const normalized = String(level || '').toLowerCase()
    if (normalized === 'success') return 'text-emerald-400'
    if (normalized === 'warning') return 'text-amber-300'
    if (normalized === 'error' || normalized === 'failed') return 'text-red-400'
    return 'text-text-primary'
  }

  const checkIcon = (status: string) => {
    const normalized = String(status || '').toLowerCase()
    if (normalized === 'passed') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    if (normalized === 'failed') return <XCircle className="h-4 w-4 text-red-600" />
    if (normalized === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-600" />
    return <CircleDashed className="h-4 w-4 text-text-muted" />
  }

  const downloadWithAuth = async (url: string, fallbackPath?: string) => {
    const token = getAuthToken()
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`)
    }

    const blob = await response.blob()
    const disposition = response.headers.get('content-disposition') || ''
    const filenameMatch = disposition.match(/filename=\"?([^\";]+)\"?/)
    const filename =
      filenameMatch?.[1] ||
      (fallbackPath ? fallbackPath.split('/').filter(Boolean).pop() : null) ||
      'download.bin'

    const objectUrl = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.URL.revokeObjectURL(objectUrl)
  }

  return (
    <StageSurface>
      <StageBody>
        <StageCard eyebrow="Package" title={appName}>
          <p className="text-sm text-text-secondary">{description}</p>
          <div className="mt-4 rounded-xl border border-border bg-cream-bg px-3 py-2 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-text-muted" />
              <span>Configure package details and create a {packageFormat} artifact for deployment.</span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MetricCard label="Manifest items" value={items.length} />
            <MetricCard label="Created" value={createdCount} tone={createdCount > 0 ? 'success' : 'default'} />
            <MetricCard label="Updated" value={updatedCount} tone={updatedCount > 0 ? 'warning' : 'default'} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <MetricCard label="Failed" value={failedCount} tone={failedCount > 0 ? 'danger' : 'default'} />
            <MetricCard label="Checks passed" value={passedChecks} tone={passedChecks > 0 ? 'success' : 'default'} />
            <MetricCard label="Checks failed" value={failedChecks} tone={failedChecks > 0 ? 'danger' : 'default'} />
          </div>
        </StageCard>

        <StageCard eyebrow="Configuration" title="Package details">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-cream-surface px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">App name</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{appName}</p>
            </div>
            <div className="rounded-xl border border-border bg-cream-surface px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Version</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{version}</p>
            </div>
            <div className="rounded-xl border border-border bg-cream-surface px-3 py-2 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Description</p>
              <p className="mt-1 text-sm text-text-primary">{description}</p>
            </div>
          </div>
        </StageCard>

        <StageCard eyebrow="Build" title="Packaging progress">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-1 font-medium ${statusPillClass}`}>{String(build.status || packageStatus)}</span>
            {build.current_stage && (
              <span className="rounded-full bg-cream-surface-light px-2.5 py-1 font-medium text-text-secondary">
                Stage: {String(build.current_stage).replace(/_/g, ' ')}
              </span>
            )}
            {build.job_id && (
              <span className="rounded-full bg-cream-surface-light px-2.5 py-1 font-medium text-text-secondary">
                Job: {String(build.job_id)}
              </span>
            )}
          </div>
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-cream-surface-light">
              <div className={`h-full rounded-full ${effectiveStatus === 'failed' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-text-muted">Progress: {progress}%</p>
          </div>

          <div className="mt-4">
            <button
              onClick={() => setShowLogs((current) => !current)}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-cream-bg px-3 py-2 text-left text-sm font-semibold text-text-secondary"
            >
              <span className="inline-flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Build logs {logs.length > 0 ? `(${logs.length})` : ''}
              </span>
              {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showLogs && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-slate-950 p-3 font-mono text-xs">
                {logs.length > 0 ? (
                  logs.map((log: any, index: number) => (
                    <div key={`${log.id ?? index}-${index}`} className={`mb-1 ${levelClass(log.level)}`}>
                      <span className="text-text-muted">[{log.timestamp || log.time || 'now'}] </span>
                      {String(log.message || log.text || log.entry || '')}
                    </div>
                  ))
                ) : (
                  <p className="text-text-muted">No build logs recorded in the current manifest.</p>
                )}
              </div>
            )}
          </div>
        </StageCard>

        {checks.length > 0 && (
          <StageCard eyebrow="Validation" title="Packaging checks">
            <div className="space-y-2">
              {checks.map((check: any, index: number) => (
                <div key={index} className="rounded-xl border border-border bg-cream-surface px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{checkIcon(String(check.status || ''))}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">{check.name || check.id || `check_${index + 1}`}</p>
                      {check.details && <p className="mt-1 text-xs text-text-muted">{check.details}</p>}
                      {(check.file || check.path) && (
                        <ClickableFile
                          filePath={check.file || check.path}
                          onFileSelect={onFileSelect}
                          className="mt-1 block text-xs"
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </StageCard>
        )}

        <StageCard eyebrow="Artifacts" title={items.length > 0 ? 'Packaged files' : 'No packaged items'}>
          {items.length > 0 ? (
            <div className="grid gap-3">
              {items.map((item: any, index: number) => {
                const itemPath = item.path || item.file || item.name
                return (
                  <div key={index} className="flex items-center gap-3 rounded-2xl border border-border bg-cream-surface p-4 shadow-aira-sm">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cream-surface-light">
                      <FileCode className="h-4 w-4 text-text-secondary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {itemPath ? (
                        <ClickableFile
                          filePath={itemPath}
                          onFileSelect={onFileSelect}
                          className="block truncate text-sm font-medium"
                        />
                      ) : (
                        <p className="text-sm font-medium text-text-primary">Unnamed artifact</p>
                      )}
                      {item.description && (
                        <p className="mt-1 text-xs text-text-muted">{item.description}</p>
                      )}
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      item.status === 'created'
                        ? 'bg-emerald-50 text-emerald-700'
                        : item.status === 'updated'
                        ? 'bg-sky-50 text-sky-700'
                        : item.status === 'failed'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-cream-surface-light text-text-secondary'
                    }`}>
                      {item.status || 'unknown'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <ArtifactSection
              title="No packaged items"
              description="The assembly stage completed without recording any manifest entries."
            >
              <div className="rounded-2xl border border-dashed border-border bg-cream-surface px-4 py-5 text-sm text-text-muted">
                Record the files generated during packaging so RF engineers can inspect what will be delivered or pushed downstream.
              </div>
            </ArtifactSection>
          )}
        </StageCard>

        <StageCard eyebrow="Deliverables" title="Downloads">
          {downloads.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {downloads.map((download: any, index: number) => {
                const enabled = download.enabled !== false
                const label = download.label || (download.type === 'code' ? 'Download Code' : 'Download Package')
                const href = download.url
                const path = download.path
                const proxyHref =
                  !href && path && sessionId
                    ? `/api/files/download?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
                    : null
                const finalHref = href || proxyHref
                if (finalHref && enabled) {
                  const isApiDownload =
                    finalHref.startsWith('/api/') ||
                    finalHref.startsWith(`${window.location.origin}/api/`)
                  return (
                    <button
                      key={index}
                      onClick={async () => {
                        try {
                          if (isApiDownload) {
                            await downloadWithAuth(finalHref, path)
                            return
                          }
                          window.open(finalHref, '_blank', 'noopener,noreferrer')
                        } catch {
                          window.alert('Download failed. Please retry after refreshing your session.')
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      <Download className="h-4 w-4" />
                      {label}
                    </button>
                  )
                }
                return (
                  <button
                    key={index}
                    onClick={() => path && onFileSelect?.(path)}
                    disabled={!enabled || !path}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-cream-surface px-3 py-2 text-sm font-medium text-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    title={download.reason || (!path ? 'No file path recorded' : undefined)}
                  >
                    <Download className="h-4 w-4" />
                    {label}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No downloads were recorded in this manifest.</p>
          )}
        </StageCard>

        {(notes.length > 0 || nextSteps.length > 0) && (
          <StageCard eyebrow="Handoff" title="Notes and next steps">
            {notes.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Notes</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                  {notes.map((note: string, index: number) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            {nextSteps.length > 0 && (
              <div className={notes.length > 0 ? 'mt-4' : ''}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Next steps</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                  {nextSteps.map((step: string, index: number) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </StageCard>
        )}
        {!hasManifestDetails && (
          <StageCard eyebrow="Reminder" title="Assembly manifest needs details">
            <div className="rounded-2xl border border-dashed border-border bg-cream-surface px-4 py-5 text-sm text-text-muted">
              Ask the assembly agent to save package metadata, checks, logs, downloads, and generated files using `write_assembly_manifest`.
            </div>
          </StageCard>
        )}
        <StageCard eyebrow="Raw" title="Raw manifest payload">
          <div className="space-y-3">
            <p className="text-xs text-text-muted">Debug view for the exact assembly artifact returned by the backend.</p>
            <button
              onClick={() => setShowRawPayload((current) => !current)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-cream-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-slate-50"
            >
              {showRawPayload ? 'Hide raw payload' : 'Show raw payload'}
            </button>
            {showRawPayload && (
              <pre className="overflow-auto rounded-2xl border border-border bg-slate-950 p-4 text-xs text-text-primary">
                {JSON.stringify(artifact, null, 2)}
              </pre>
            )}
          </div>
        </StageCard>
      </StageBody>
    </StageSurface>
  )
}

function GenericArtifactView({
  artifact,
  title,
  description,
}: {
  artifact: Record<string, any>
  title: string
  description: string
}) {
  return (
    <StageSurface>
      <StageHeader icon={Sparkles} title={title} description={description} />
      <StageBody>
      <ArtifactSection
        title="Artifact payload"
        description="Raw artifact data for this stage. Replace this with a dedicated renderer once the stage contract stabilizes."
      >
        <pre className="overflow-auto rounded-2xl border border-border bg-slate-950 p-4 text-xs text-text-primary">
          {JSON.stringify(artifact, null, 2)}
        </pre>
      </ArtifactSection>
      </StageBody>
    </StageSurface>
  )
}
