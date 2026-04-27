/** Strip markdown/list/formatting for plain display. */
export function cleanInlineText(value: string | undefined): string {
  if (!value) return ''
  return value
    .replace(/^\s*[-*]\s*/, '')
    // Convert metric tag XML to clean readable text
    .replace(
      /<metric-type>\s*(.*?)\s*<\/metric-type>\s*:\s*<ioc>\s*(.*?)\s*<\/ioc>\s*\.\s*<metric>\s*(.*?)\s*<\/metric>/g,
      (_m, type: string, ioc: string, metric: string) => {
        const clean = (s: string) => s.replace(/\s*\{[^}]*\}\s*/g, '').trim()
        return `${clean(type)}: ${clean(ioc)}.${clean(metric)}`
      }
    )
    .replace(/`+/g, '')
    .replace(/\*{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Format option label by removing key prefix from raw label. */
export function formatOptionLabel(rawLabel: string, optionKey: string): string {
  const key = cleanInlineText(optionKey)
  let label = cleanInlineText(rawLabel)
  if (key) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const prefix = new RegExp(
      `^${escapedKey}(?=$|\\s|[\\)\\].:-])[\\)\\].:-]?\\s*`,
      'i'
    )
    label = label.replace(prefix, '').trim()
  }
  return label || 'Option'
}

/** Format tool output for display (pretty-print JSON). */
export function formatToolOutput(output: unknown): string {
  if (output === null || output === undefined) return ''

  const limit = 1600
  const trimOutput = (value: string): string =>
    value.length <= limit ? value : `${value.slice(0, limit)}\n...[truncated]`

  if (typeof output === 'string') {
    const bounded = trimOutput(output)
    const trimmed = bounded.trim()
    if (!trimmed) return ''
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        return bounded
      }
    }
    return bounded
  }

  try {
    return trimOutput(JSON.stringify(output, null, 2))
  } catch {
    return String(output)
  }
}
