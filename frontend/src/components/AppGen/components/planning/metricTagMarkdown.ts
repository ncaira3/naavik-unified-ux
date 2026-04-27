export const METRIC_TAG_REGEX =
  /<metric-type>\s*(.*?)\s*<\/metric-type>\s*:\s*<ioc>\s*(.*?)\s*<\/ioc>\s*\.\s*<metric>\s*(.*?)\s*<\/metric>/g

/** Placeholder format used during markdown import to avoid HTML parsing issues.
 *  BlockNote's markdown parser treats <metric-type> as HTML tags and strips them.
 *  We replace with placeholders before parsing, then convert placeholders to nodes after. */
const PLACEHOLDER_PREFIX = '%%MTAG:'
const PLACEHOLDER_SUFFIX = '%%'
const PLACEHOLDER_REGEX = /%%MTAG:(.*?):(.*?):(.*?)%%/g

/** Replace metric tag XML syntax with safe placeholders before BlockNote parses the markdown. */
export function preProcessMarkdownForImport(md: string): string {
  return md.replace(
    new RegExp(METRIC_TAG_REGEX.source, 'g'),
    (_match, type: string, ioc: string, metric: string) =>
      `${PLACEHOLDER_PREFIX}${type.trim()}:${ioc.trim()}:${metric.trim()}${PLACEHOLDER_SUFFIX}`
  )
}

export function serializeMetricTag(metricType: string, ioc: string, metric: string): string {
  return `<metric-type> ${metricType} </metric-type> : <ioc> ${ioc} </ioc> . <metric> ${metric} </metric>`
}

type BlockNode = Record<string, unknown>
type InlineNode = Record<string, unknown>

export function blocksToMarkdownWithMetricTags(blocks: BlockNode[]): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map((block) => blockToMarkdown(block, 0)).join('\n')
}

function blockToMarkdown(block: BlockNode, depth: number): string {
  const type = block.type as string
  const rawContent = block.content
  const content = Array.isArray(rawContent) ? (rawContent as InlineNode[]) : undefined
  const props = block.props as Record<string, unknown> | undefined
  const children = block.children as BlockNode[] | undefined
  const indent = '  '.repeat(depth)
  const text = serializeInlineContent(content)
  let line = ''

  switch (type) {
    case 'heading': {
      const level = (props?.level as number) || 1
      line = `${'#'.repeat(level)} ${text}`
      break
    }
    case 'bulletListItem':
      line = `${indent}- ${text}`
      break
    case 'numberedListItem':
      line = `${indent}1. ${text}`
      break
    case 'checkListItem': {
      const checked = props?.checked ? 'x' : ' '
      line = `${indent}- [${checked}] ${text}`
      break
    }
    case 'quote':
      line = `> ${text}`
      break
    case 'codeBlock': {
      const lang = (props?.language as string) || ''
      line = `\`\`\`${lang}\n${text}\n\`\`\``
      break
    }
    case 'table': {
      line = serializeTable(block)
      break
    }
    case 'divider':
      line = '---'
      break
    case 'paragraph':
    default:
      line = text
      break
  }

  const result = [line]
  if (children && children.length > 0) {
    for (const child of children) {
      result.push(blockToMarkdown(child, depth + 1))
    }
  }
  return result.join('\n')
}

function serializeInlineContent(content: InlineNode[] | undefined): string {
  if (!content) return ''
  return content.map((ic) => {
    if (ic.type === 'metricTag') {
      const p = ic.props as { metricType: string; ioc: string; metric: string }
      return serializeMetricTag(p.metricType, p.ioc, p.metric)
    }
    if (ic.type === 'text') {
      let text = ic.text as string
      const styles = ic.styles as Record<string, unknown> | undefined
      if (styles?.bold) text = `**${text}**`
      if (styles?.italic) text = `*${text}*`
      if (styles?.strike) text = `~~${text}~~`
      if (styles?.code) text = `\`${text}\``
      return text
    }
    if (ic.type === 'link') {
      const linkContent = ic.content as InlineNode[] | undefined
      const href = ic.href as string
      return `[${serializeInlineContent(linkContent)}](${href})`
    }
    return ''
  }).join('')
}

function serializeTable(block: BlockNode): string {
  const content = block.content as { type: string; rows: Array<{ cells: Array<InlineNode[]> }> } | undefined
  if (!content || !('rows' in content)) return ''
  const rows = content.rows || []
  if (rows.length === 0) return ''
  const lines: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].cells.map((cell: InlineNode[]) => serializeInlineContent(cell))
    lines.push(`| ${cells.join(' | ')} |`)
    if (i === 0) {
      lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    }
  }
  return lines.join('\n')
}

export function processBlocksForMetricTags(blocks: BlockNode[]): BlockNode[] {
  return blocks.map((block) => {
    const content = block.content
    const children = block.children as BlockNode[] | undefined
    const newBlock = { ...block }
    // Only process inline content arrays — skip object-style content (e.g. tableContent)
    if (Array.isArray(content)) {
      newBlock.content = processInlineContentForMetricTags(content as InlineNode[])
    }
    if (children && children.length > 0) {
      newBlock.children = processBlocksForMetricTags(children)
    }
    return newBlock
  })
}

function processInlineContentForMetricTags(content: InlineNode[]): InlineNode[] {
  const result: InlineNode[] = []
  for (const ic of content) {
    if (ic.type !== 'text') {
      result.push(ic)
      continue
    }
    const text = ic.text as string
    const styles = ic.styles as Record<string, unknown> | undefined
    // Match both the placeholder format (%%MTAG:type:ioc:metric%%) and the original XML format
    const regex = new RegExp(`${PLACEHOLDER_REGEX.source}|${METRIC_TAG_REGEX.source}`, 'g')
    let lastIndex = 0
    let match: RegExpExecArray | null
    let hasMatch = false

    while ((match = regex.exec(text)) !== null) {
      hasMatch = true
      if (match.index > lastIndex) {
        result.push({ type: 'text', text: text.slice(lastIndex, match.index), styles: styles || {} })
      }
      // Groups 1-3 from placeholder format, groups 4-6 from XML format
      const mType = (match[1] || match[4] || 'PM').trim()
      const mIoc = (match[2] || match[5] || '').trim()
      const mMetric = (match[3] || match[6] || '').trim()
      result.push({
        type: 'metricTag',
        props: {
          metricType: mType,
          ioc: mIoc,
          metric: mMetric,
        },
      })
      lastIndex = match.index + match[0].length
    }
    if (!hasMatch) {
      result.push(ic)
    } else if (lastIndex < text.length) {
      result.push({ type: 'text', text: text.slice(lastIndex), styles: styles || {} })
    }
  }
  return result
}
