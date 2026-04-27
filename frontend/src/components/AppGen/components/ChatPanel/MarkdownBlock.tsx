import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMemo } from 'react'

const METRIC_TAG_REGEX =
  /<metric-type>\s*(.*?)\s*<\/metric-type>\s*:\s*<ioc>\s*(.*?)\s*<\/ioc>\s*\.\s*<metric>\s*(.*?)\s*<\/metric>/g

/** Strip {annotation} suffixes like {CC} or {EUtranCell} from metric fields */
function cleanField(raw: string): string {
  return raw.replace(/\s*\{[^}]*\}\s*/g, '').trim()
}

/** Split text into segments of plain text and metric tag pills */
function parseMetricTags(text: string): Array<{ type: 'text'; value: string } | { type: 'metric'; metricType: string; ioc: string; metric: string }> {
  const segments: Array<{ type: 'text'; value: string } | { type: 'metric'; metricType: string; ioc: string; metric: string }> = []
  let lastIndex = 0
  const regex = new RegExp(METRIC_TAG_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({
      type: 'metric',
      metricType: cleanField(match[1]),
      ioc: cleanField(match[2]),
      metric: cleanField(match[3]),
    })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

/** Inline pill for metric tags in chat messages (read-only, no dropdowns) */
function MetricPill({ metricType, ioc, metric }: { metricType: string; ioc: string; metric: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
        {metricType}
      </span>
      <span className="text-[11px] text-text-muted">:</span>
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        {ioc}
      </span>
      <span className="text-[11px] text-text-muted">.</span>
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
        {metric}
      </span>
    </span>
  )
}

interface MarkdownBlockProps {
  content: string
}

export function MarkdownBlock({ content }: MarkdownBlockProps) {
  // Check if content contains metric tags
  const hasMetricTags = useMemo(() => METRIC_TAG_REGEX.test(content), [content])

  if (!hasMetricTags) {
    return (
      <div className="markdown-body max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    )
  }

  // Custom rendering: split by metric tags, render markdown for text parts and pills for metrics
  // Process line by line to maintain markdown structure
  const lines = content.split('\n')
  const processedLines = lines.map((line, lineIdx) => {
    const segments = parseMetricTags(line)
    if (segments.length === 1 && segments[0].type === 'text') {
      // No metric tags in this line — render as normal markdown
      return <ReactMarkdown key={lineIdx} remarkPlugins={[remarkGfm]}>{segments[0].value}</ReactMarkdown>
    }
    // Has metric tags — render inline with pills
    return (
      <p key={lineIdx} style={{ margin: '0.25em 0' }}>
        {segments.map((seg, i) =>
          seg.type === 'metric' ? (
            <MetricPill key={i} metricType={seg.metricType} ioc={seg.ioc} metric={seg.metric} />
          ) : (
            <span key={i}>{seg.value}</span>
          )
        )}
      </p>
    )
  })

  return <div className="markdown-body max-w-none">{processedLines}</div>
}
