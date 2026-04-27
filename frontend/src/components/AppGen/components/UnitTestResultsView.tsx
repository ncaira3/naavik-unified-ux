import { useMemo, useState } from 'react'
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileCode,
  FlaskConical,
  XCircle,
} from 'lucide-react'
import {
  ArtifactSection,
  MetricCard,
  StageBody,
  StageCard,
  StageHeader,
  StageSurface,
} from './workspace/StagePrimitives'

const COVERAGE_THRESHOLD = 80
const TIER_LABELS: Record<string, string> = {
  unit: 'Unit Tests',
  functional: 'Functional Tests',
  integration: 'Integration Tests',
}
const TIER_ORDER = ['unit', 'functional', 'integration']

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

function CoverageBar({ coverage }: { coverage: number }) {
  const barClass =
    coverage >= COVERAGE_THRESHOLD ? 'bg-emerald-500' : coverage >= 60 ? 'bg-amber-500' : 'bg-red-500'
  const textClass =
    coverage >= COVERAGE_THRESHOLD ? 'text-emerald-700' : coverage >= 60 ? 'text-amber-700' : 'text-red-700'

  return (
    <div className="flex min-w-[108px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream-surface-light">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(coverage, 100)}%` }} />
      </div>
      <span className={`w-10 text-right text-[11px] font-medium tabular-nums ${textClass}`}>{coverage.toFixed(0)}%</span>
    </div>
  )
}

function FileCoverageRow({ entry, onFileSelect }: { entry: any; onFileSelect?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const hasMissing = Array.isArray(entry.missing_lines) && entry.missing_lines.length > 0

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-cream-surface shadow-aira-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-surface-light">
          <FileCode className="h-4 w-4 text-text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <ClickableFile filePath={entry.file} onFileSelect={onFileSelect} className="block truncate text-sm font-medium" />
        </div>
        <CoverageBar coverage={entry.coverage ?? 0} />
        {hasMissing && (
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg p-1 text-text-muted hover:bg-slate-100">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>
      {expanded && hasMissing && (
        <div className="border-t border-border bg-cream-bg px-4 py-3">
          <p className="text-xs text-text-muted">Uncovered lines</p>
          <code className="mt-1 block whitespace-pre-wrap text-xs text-red-600">{String(entry.missing_lines)}</code>
          {entry.statements !== undefined && (
            <p className="mt-2 text-xs text-text-muted">
              {entry.statements - (entry.missing || 0)} / {entry.statements} statements covered
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function TestCaseDetail({ test, onFileSelect }: { test: any; onFileSelect?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Boolean(test.message || test.assertion || test.duration || test.file)

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-cream-surface shadow-aira-sm">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${hasDetails ? 'cursor-pointer hover:bg-slate-50' : ''}`}
      >
        {test.status === 'passed' ? (
          <CheckCircle className="h-4 w-4 flex-shrink-0 text-emerald-600" />
        ) : test.status === 'failed' ? (
          <XCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
        ) : (
          <span className="h-4 w-4 flex-shrink-0 rounded-full bg-slate-300" />
        )}
        <span className="flex-1 truncate font-mono text-xs text-text-primary">{test.name}</span>
        {test.duration && <span className="text-[11px] text-text-muted">{test.duration}ms</span>}
        {hasDetails && (expanded ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />)}
      </button>
      {expanded && hasDetails && (
        <div className="space-y-2 border-t border-border bg-cream-bg px-4 py-3">
          {test.file && (
            <div className="flex items-center gap-2">
              <FileCode className="h-3.5 w-3.5 text-text-muted" />
              <ClickableFile filePath={test.file} line={test.line} onFileSelect={onFileSelect} className="text-[11px]" />
            </div>
          )}
          {(test.message || test.assertion) && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-red-100 bg-red-50 p-3 text-[11px] text-red-700">
              {test.message || test.assertion}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function TierGroup({ tier, tests, onFileSelect }: { tier: string; tests: any[]; onFileSelect?: (path: string) => void }) {
  const passed = tests.filter(test => test.status === 'passed').length
  const failed = tests.filter(test => test.status === 'failed').length
  const skipped = tests.length - passed - failed
  const [expanded, setExpanded] = useState(failed > 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-cream-surface shadow-aira-sm">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        {expanded ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
        <span className="flex-1 text-sm font-medium text-text-primary">{TIER_LABELS[tier] || tier}</span>
        <span className="text-[11px] font-medium text-emerald-700">{passed} passed</span>
        {failed > 0 && <span className="text-[11px] font-medium text-red-700">{failed} failed</span>}
        {skipped > 0 && <span className="text-[11px] font-medium text-text-muted">{skipped} skipped</span>}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border bg-cream-bg px-3 py-3">
          {tests.map((test: any, index: number) => (
            <TestCaseDetail key={index} test={test} onFileSelect={onFileSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

export interface UnitTestResultsViewProps {
  artifact: Record<string, any>
  onFileSelect?: (path: string) => void
}

export function UnitTestResultsView({ artifact, onFileSelect }: UnitTestResultsViewProps) {
  const passed = artifact.passed || 0
  const failed = artifact.failed || 0
  const skipped = artifact.skipped || 0
  const coverage = artifact.coverage
  const fileCoverage: any[] = artifact.file_coverage || []
  const details: any[] = artifact.details || []
  const testFiles: string[] = artifact.test_files || []
  const total = passed + failed + skipped
  const sortedFileCoverage = useMemo(
    () => [...fileCoverage].sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0)),
    [fileCoverage]
  )
  const hasTiers = details.some((test: any) => test.tier)
  const tierGroups = useMemo(() => {
    if (!hasTiers) return null
    const groups: Record<string, any[]> = {}
    for (const test of details) {
      const tier = test.tier || 'other'
      if (!groups[tier]) groups[tier] = []
      groups[tier].push(test)
    }
    return groups
  }, [details, hasTiers])

  return (
    <StageSurface>
      <StageHeader
        icon={FlaskConical}
        title="Unit and Functional Tests"
        description="Coverage, failing cases, and source-level evidence from the current test run."
        actions={
          coverage !== undefined ? (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              coverage >= COVERAGE_THRESHOLD ? 'bg-emerald-50 text-emerald-700' : coverage >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
            }`}>
              {coverage}% coverage
            </span>
          ) : undefined
        }
      />
      <StageBody>
        <StageCard
          eyebrow="Overview"
          title="Current test signal"
          actions={
            total > 0 ? (
              <span className="rounded-full bg-cream-surface-light px-3 py-1 text-xs font-medium text-text-secondary">
                {total} total tests
              </span>
            ) : undefined
          }
        >
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Passed" value={passed} tone={passed > 0 ? 'success' : 'default'} />
            <MetricCard label="Failed" value={failed} tone={failed > 0 ? 'danger' : 'default'} />
            <MetricCard label="Skipped" value={skipped} tone={skipped > 0 ? 'warning' : 'default'} />
            <MetricCard label="Coverage" value={coverage !== undefined ? `${coverage}%` : 'N/A'} tone={coverage === undefined ? 'default' : coverage >= COVERAGE_THRESHOLD ? 'success' : coverage >= 60 ? 'warning' : 'danger'} />
          </div>

          {total > 0 && (
            <div className="mt-4 overflow-hidden rounded-full bg-cream-surface-light">
              <div className="flex h-2">
                {passed > 0 && <div className="bg-emerald-500" style={{ width: `${(passed / total) * 100}%` }} />}
                {failed > 0 && <div className="bg-red-500" style={{ width: `${(failed / total) * 100}%` }} />}
                {skipped > 0 && <div className="bg-slate-400" style={{ width: `${(skipped / total) * 100}%` }} />}
              </div>
            </div>
          )}
        </StageCard>

        {coverage !== undefined && (
          <StageCard eyebrow="Coverage" title="Threshold comparison">
            <ArtifactSection
              title="Coverage signal"
              description="Compare the current coverage level against the target threshold."
            >
              <div className="relative h-2 overflow-visible rounded-full bg-cream-surface-light">
                <div
                  className={`h-full rounded-full ${coverage >= COVERAGE_THRESHOLD ? 'bg-emerald-500' : coverage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(coverage, 100)}%` }}
                />
                <div
                  className="absolute bottom-[-3px] top-[-3px] w-0.5 rounded bg-slate-400"
                  style={{ left: `${COVERAGE_THRESHOLD}%` }}
                  title={`${COVERAGE_THRESHOLD}% threshold`}
                />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-text-muted">
                <span>0%</span>
                <span>{COVERAGE_THRESHOLD}% target</span>
                <span>100%</span>
              </div>
            </ArtifactSection>
          </StageCard>
        )}

        {sortedFileCoverage.length > 0 && (
          <StageCard eyebrow="Source Files" title="Coverage by file">
            <ArtifactSection
              title="Source coverage"
              description={`Coverage breakdown for ${sortedFileCoverage.length} source file${sortedFileCoverage.length === 1 ? '' : 's'}.`}
            >
              <div className="space-y-3">
                {sortedFileCoverage.map((entry: any, index: number) => (
                  <FileCoverageRow key={index} entry={entry} onFileSelect={onFileSelect} />
                ))}
              </div>
            </ArtifactSection>
          </StageCard>
        )}

        {sortedFileCoverage.length === 0 && testFiles.length > 0 && (
          <StageCard eyebrow="Generated Files" title="Test assets">
            <ArtifactSection
              title="Generated test files"
              description="Test files created for the current run when file-level coverage data is not available."
            >
              <div className="space-y-3">
                {testFiles.map((file: string, index: number) => (
                  <div key={index} className="flex items-center gap-3 rounded-2xl border border-border bg-cream-surface p-4 shadow-aira-sm">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-surface-light">
                      <FileCode className="h-4 w-4 text-text-secondary" />
                    </span>
                    <ClickableFile filePath={file} onFileSelect={onFileSelect} className="text-sm font-medium" />
                  </div>
                ))}
              </div>
            </ArtifactSection>
          </StageCard>
        )}

        {details.length > 0 && (
          <StageCard eyebrow="Execution Detail" title="Test case breakdown">
            <ArtifactSection
              title="Test cases"
              description={`Detailed results for ${details.length} executed test case${details.length === 1 ? '' : 's'}.`}
            >
              <div className="space-y-3">
                {tierGroups
                  ? TIER_ORDER.filter(tier => tierGroups[tier]?.length > 0).map(tier => (
                      <TierGroup key={tier} tier={tier} tests={tierGroups[tier]} onFileSelect={onFileSelect} />
                    ))
                  : details.map((test: any, index: number) => (
                      <TestCaseDetail key={index} test={test} onFileSelect={onFileSelect} />
                    ))}
              </div>
            </ArtifactSection>
          </StageCard>
        )}

        {details.length === 0 && total === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-white/80 px-5 py-6 text-sm text-text-muted">
            No unit or functional test results are available yet. Run the testing stage to populate this view.
          </div>
        )}
      </StageBody>
    </StageSurface>
  )
}
