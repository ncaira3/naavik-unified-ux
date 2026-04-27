/**
 * High-Level Design PDF: plan markdown + flowchart. Tail sections use bodyRaw for tables & structure.
 * @module buildHldPdf
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/** Layout and typography constants for HLD PDF (A4, mm). */
export const HLD_PDF_LAYOUT = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginMm: 14,
  lineHeightMm: 5,
  footerLineYFromBottomMm: 11,
  footerRgb: [200, 60, 140] as [number, number, number],
  titleFontPt: 20,
  subtitleFontPt: 10,
  sectionTitleFontPt: 12,
  bodyFontPt: 9.5,
  codeFontPt: 8.5,
  maxYReserveMm: 16,
  flowchartMinSpaceBeforeMm: 95,
  flowchartImageWidthRatio: 0.72,
  flowchartBottomReserveMm: 18,
  trivialOverviewMaxLen: 80,
  fallbackMarkdownChars: 4000,
  /** Max characters for plan markdown (avoids excessive memory/CPU). */
  maxPlanMarkdownChars: 500_000,
  /** Max length for project name in filename. */
  maxFilenameBaseChars: 80,
  tableMinSpaceBeforeMm: 30,
  sectionTitleSpaceMm: 14,
  blockSpacingMm: 2,
  numberedStepSingleLineMaxChars: 120,
  /** Inline code: background fill (light gray). */
  codeBackgroundRgb: [248, 250, 252] as [number, number, number],
  /** Main section heading (##) font size. */
  mainHeadingFontPt: 14,
  /** Sub-section heading (###) font size. */
  subHeadingFontPt: 11,
  /** Bullet indent per nesting level (mm). */
  bulletIndentPerLevelMm: 6,
  /** Base bullet indent (mm). */
  bulletBaseIndentMm: 3,
} as const

export type HldPdfLayout = typeof HLD_PDF_LAYOUT

/** Parsed plan section with optional raw markdown for PDF rendering. */
export interface HldPdfSection {
  title: string
  body: string
  /** Original markdown under ## section — used for PDF (tables, lists). */
  bodyRaw?: string
}

const EMPTY_BODY = '-'

/**
 * Sanitize text for jsPDF's WinAnsiEncoding.
 * Replace Unicode characters that aren't in the encoding with ASCII equivalents
 * to prevent garbled output (%¾ artifacts) and doubled-byte letter-spacing.
 */
function sanitizeForPdf(text: string): string {
  return text
    // Smart quotes → ASCII quotes
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    // Dashes
    .replace(/\u2013/g, '-')    // en-dash
    .replace(/\u2014/g, '--')   // em-dash
    .replace(/\u2015/g, '--')   // horizontal bar
    // Ellipsis
    .replace(/\u2026/g, '...')
    // Spaces
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    // Arrows
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2194/g, '<->')
    // Math
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2260/g, '!=')
    .replace(/\u00D7/g, 'x')
    // Bullets (keep standard bullet, replace others)
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '*')
    // Strip any remaining non-WinAnsi characters (above 255 after above replacements)
    .replace(/[^\x00-\xFF]/g, '')
}

const PREFERRED_ORDER = [
  'overview',
  'user intent',
  'intent',
  'components',
  'algorithm coverage',
  'algorithm',
  'process flow',
  'error handling',
  'conclusion',
] as const

function normalizeSectionTitle(title: string): string {
  return title.toLowerCase().trim()
}

function stripMarkdownForPdf(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    // Convert metric tag XML to clean text: PM: EUtranCell.pmMetric
    .replace(
      /<metric-type>\s*(.*?)\s*<\/metric-type>\s*:\s*<ioc>\s*(.*?)\s*<\/ioc>\s*\.\s*<metric>\s*(.*?)\s*<\/metric>/g,
      (_m, type: string, ioc: string, metric: string) =>
        `${cleanMetricField(type)}: ${cleanMetricField(ioc)}.${cleanMetricField(metric)}`
    )
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ''))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripInlineMarkdown(cell: string): string {
  return cell
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return [stripInlineMarkdown(trimmed)]
  let inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  if (inner.endsWith('|')) inner = inner.slice(0, -1)
  return inner.split('|').map((cell) => stripInlineMarkdown(cell))
}

function isGfmTableSeparatorRow(line: string): boolean {
  const cells = line
    .trim()
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
  return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))
}

interface ParsedGfmTable {
  head: string[]
  body: string[][]
  nextLineIndex: number
}

function tryParseGfmTable(lines: string[], startIndex: number): ParsedGfmTable | null {
  const headerRow = lines[startIndex]?.trim() ?? ''
  const separatorRow = lines[startIndex + 1]?.trim() ?? ''
  if (!headerRow.includes('|') || !isGfmTableSeparatorRow(separatorRow)) return null
  const head = splitTableRow(headerRow).filter((cell) => cell.length > 0)
  if (head.length < 2) return null
  let rowIndex = startIndex + 2
  const body: string[][] = []
  while (rowIndex < lines.length) {
    const row = lines[rowIndex]?.trim() ?? ''
    if (!row) break
    if (!row.includes('|')) break
    const cells = splitTableRow(row)
    if (cells.every((cell) => /^[\s\-:|]*$/.test(cell))) {
      rowIndex++
      continue
    }
    while (cells.length < head.length) cells.push('')
    if (cells.length > head.length) cells.length = head.length
    body.push(cells)
    rowIndex++
  }
  if (body.length === 0) return null
  return { head, body, nextLineIndex: rowIndex }
}

function parsePlanMarkdownSections(markdown: string): HldPdfSection[] {
  const raw = (markdown || '').trim()
  if (!raw) {
    return [{ title: 'Overview', body: 'No plan content was saved for this project.', bodyRaw: '' }]
  }
  const lines = raw.split('\n')
  const sections: HldPdfSection[] = []
  let preamble: string[] = []
  let currentTitle: string | null = null
  let currentBody: string[] = []

  const flushSection = () => {
    if (currentTitle) {
      const rawBody = currentBody.join('\n').trim()
      sections.push({
        title: currentTitle,
        body: stripMarkdownForPdf(rawBody) || EMPTY_BODY,
        bodyRaw: rawBody,
      })
    }
    currentTitle = null
    currentBody = []
  }

  for (const line of lines) {
    const hm = line.match(/^##\s+(.+)$/)
    if (hm) {
      if (currentTitle === null && preamble.length) {
        const pre = preamble.join('\n').trim()
        sections.push({
          title: 'Overview',
          body: stripMarkdownForPdf(pre) || EMPTY_BODY,
          bodyRaw: pre,
        })
        preamble = []
      }
      flushSection()
      currentTitle = hm[1].trim()
    } else if (currentTitle) {
      currentBody.push(line)
    } else {
      preamble.push(line)
    }
  }
  flushSection()
  if (preamble.length && sections.length === 0) {
    const pre = preamble.join('\n').trim()
    sections.push({
      title: 'Plan',
      body: stripMarkdownForPdf(pre) || EMPTY_BODY,
      bodyRaw: pre,
    })
  } else if (preamble.length) {
    const pre = preamble.join('\n').trim()
    sections.unshift({
      title: 'Overview',
      body: stripMarkdownForPdf(pre) || EMPTY_BODY,
      bodyRaw: pre,
    })
  }
  return sections.length
    ? sections
    : [{ title: 'Plan', body: stripMarkdownForPdf(raw), bodyRaw: raw }]
}

function orderedSections(sections: HldPdfSection[]): HldPdfSection[] {
  const used = new Set<number>()
  const out: HldPdfSection[] = []
  for (const key of PREFERRED_ORDER) {
    const idx = sections.findIndex((s, i) => !used.has(i) && normalizeSectionTitle(s.title) === key)
    if (idx >= 0) {
      used.add(idx)
      out.push(sections[idx])
    }
  }
  sections.forEach((s, i) => {
    if (!used.has(i)) out.push(s)
  })
  return out
}

function buildSectionMap(sections: HldPdfSection[]): Map<string, HldPdfSection> {
  const map = new Map<string, HldPdfSection>()
  for (const section of sections) {
    map.set(normalizeSectionTitle(section.title), section)
  }
  return map
}

function getSectionBody(map: Map<string, HldPdfSection>, ...keys: string[]): string {
  for (const key of keys) {
    const s = map.get(key)
    if (s?.body && s.body !== EMPTY_BODY) return s.body
  }
  return ''
}

export function humanizeSectionTitle(title: string): string {
  const t = title.trim()
  if (!t || !/_/u.test(t)) return t
  return t
    .split('_')
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

function isTrivialOverviewBody(body: string): boolean {
  const t = body.trim()
  return t.length < HLD_PDF_LAYOUT.trivialOverviewMaxLen || /^plan$/i.test(t)
}

/**
 * Derives the HLD PDF model from plan markdown (sections, overview, user intent, tails).
 * Used by buildHldPdf and by tests.
 */
export function computeHldPdfModel(markdown: string): {
  overviewBody: string
  overviewRaw: string
  userIntentBody: string | null
  userIntentRaw: string | null
  tailSections: HldPdfSection[]
} {
  const rawSections = parsePlanMarkdownSections(markdown)
  const sections = orderedSections(rawSections)
  const map = buildSectionMap(sections)

  const overviewSec =
    sections.find((s) => normalizeSectionTitle(s.title) === 'overview') ||
    sections.find((s) => normalizeSectionTitle(s.title) === 'plan') ||
    sections[0]
  const userIntentSec = sections.find(
    (s) =>
      normalizeSectionTitle(s.title) === 'user intent' || normalizeSectionTitle(s.title) === 'intent'
  )

  let overviewBody = overviewSec?.body || EMPTY_BODY
  let overviewRaw = overviewSec?.bodyRaw ?? overviewBody
  const usedVendorProblemForOverview =
    isTrivialOverviewBody(overviewBody) &&
    (getSectionBody(map, 'vendor').length > 0 || getSectionBody(map, 'problem_statement').length > 0)

  if (usedVendorProblemForOverview) {
    const v = map.get('vendor')
    const p = map.get('problem_statement')
    overviewBody =
      [v?.body ?? '', p?.body ?? ''].filter(Boolean).join('\n\n') ||
      stripMarkdownForPdf(markdown).slice(0, HLD_PDF_LAYOUT.fallbackMarkdownChars)
    overviewRaw =
      [v?.bodyRaw ?? v?.body ?? '', p?.bodyRaw ?? p?.body ?? ''].filter(Boolean).join('\n\n') ||
      markdown.slice(0, HLD_PDF_LAYOUT.fallbackMarkdownChars)
  }

  const userIntentBody =
    userIntentSec?.body && userIntentSec.body !== EMPTY_BODY ? userIntentSec.body : null
  const userIntentRaw =
    userIntentBody && userIntentSec?.bodyRaw ? userIntentSec.bodyRaw : userIntentBody

  const sectionTitlesToSkipInTail = new Set<string>()
  if (overviewSec) sectionTitlesToSkipInTail.add(normalizeSectionTitle(overviewSec.title))
  if (userIntentSec) sectionTitlesToSkipInTail.add(normalizeSectionTitle(userIntentSec.title))
  if (usedVendorProblemForOverview) {
    sectionTitlesToSkipInTail.add('vendor')
    sectionTitlesToSkipInTail.add('problem_statement')
  }

  const tailSections = sections.filter(
    (s) => !sectionTitlesToSkipInTail.has(normalizeSectionTitle(s.title))
  )

  return {
    overviewBody,
    overviewRaw,
    userIntentBody,
    userIntentRaw: userIntentRaw ?? null,
    tailSections,
  }
}

/** jsPDF augmented by jspdf-autotable (finalY after autoTable). */
interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY?: number }
}

function drawFooterLine(doc: jsPDF, layout: HldPdfLayout): void {
  const [r, g, b] = layout.footerRgb
  doc.setDrawColor(r, g, b)
  doc.setLineWidth(0.35)
  const footerY = layout.pageHeightMm - layout.footerLineYFromBottomMm
  doc.line(layout.marginMm, footerY, layout.pageWidthMm - layout.marginMm, footerY)
}

function ensureVerticalSpace(
  doc: jsPDF,
  currentY: number,
  requiredMm: number,
  layout: HldPdfLayout
): number {
  const pageBottomY = layout.pageHeightMm - layout.maxYReserveMm
  if (currentY + requiredMm > pageBottomY) {
    doc.addPage()
    drawFooterLine(doc, layout)
    return layout.marginMm
  }
  return currentY
}

interface TextRunOptions {
  indentMm?: number
  font?: string
  style?: string
  size?: number
}

/** Segment of a line: plain text, inline code, or metric tag pill. */
interface InlineSegment {
  text: string
  isCode: boolean
  metricTag?: { type: string; ioc: string; metric: string }
}

function tokenizeInlineCode(line: string): InlineSegment[] {
  const segments: InlineSegment[] = []

  // First split by metric tag placeholders
  const mtParts = line.split(/(\x02MT\[[^\x03]*\]\x03)/g)
  for (const mtPart of mtParts) {
    if (!mtPart) continue
    const mtMatch = mtPart.match(/^\x02MT\[([^|]*)\|([^|]*)\|([^\]]*)\]\x03$/)
    if (mtMatch) {
      segments.push({
        text: `${mtMatch[1]}: ${mtMatch[2]}.${mtMatch[3]}`,
        isCode: false,
        metricTag: { type: mtMatch[1], ioc: mtMatch[2], metric: mtMatch[3] },
      })
      continue
    }
    // Then split remaining text by backtick code segments
    const codeParts = mtPart.split(/(`+[^`]*`+)/g)
    for (const part of codeParts) {
      if (!part) continue
      const isCode = /^`+/.test(part)
      const text = isCode ? part.replace(/^`+|`+$/g, '') : part
      if (text.length > 0) segments.push({ text, isCode })
    }
  }
  return segments.length > 0 ? segments : [{ text: line, isCode: false }]
}

/**
 * Draws a single line that may contain `inline code`, with wrapping. Code segments use monospace and a light background.
 * Returns the final y position after the line(s).
 */
function addLineWithInlineCode(
  doc: jsPDF,
  line: string,
  startY: number,
  layout: HldPdfLayout,
  indentMm: number = 0
): number {
  const segments = tokenizeInlineCode(line)
  const leftX = layout.marginMm + indentMm
  const maxWidthMm = layout.pageWidthMm - 2 * layout.marginMm - indentMm
  const pageBottomY = layout.pageHeightMm - layout.maxYReserveMm
  let x = leftX
  let y = startY

  for (const segment of segments) {
    doc.setFont(segment.isCode ? 'courier' : 'helvetica', 'normal')
    doc.setFontSize(segment.isCode ? layout.codeFontPt : layout.bodyFontPt)
    const remainingWidthMm = maxWidthMm - (x - leftX)
    let segmentLines: string[]
    if (x > leftX && remainingWidthMm > 5) {
      const firstChunk = doc.splitTextToSize(segment.text, remainingWidthMm) as string[]
      const firstLine = firstChunk[0] ?? ''
      const rest = segment.text.slice(firstLine.length).trimStart()
      segmentLines = rest
        ? [firstLine, ...(doc.splitTextToSize(rest, maxWidthMm) as string[])]
        : firstChunk
    } else {
      segmentLines = doc.splitTextToSize(segment.text, maxWidthMm) as string[]
    }
    for (let i = 0; i < segmentLines.length; i++) {
      if (y > pageBottomY) {
        doc.addPage()
        drawFooterLine(doc, layout)
        y = layout.marginMm
        x = leftX
      }
      if (i > 0) {
        y += layout.lineHeightMm
        x = leftX
      }
      const segmentLine = segmentLines[i]
      const drawX = i === 0 ? x : leftX
      const lineWidthMm = doc.getTextWidth(segmentLine)
      if (segment.metricTag && segmentLine.length > 0) {
        // Render metric tag as colored pill segments: [TYPE] : [IOC] . [metric]
        const mt = segment.metricTag
        const pillH = layout.lineHeightMm * 0.85
        const pillY = y - pillH * 0.72
        const pillR = 1 // corner radius
        let px = drawX

        const drawPill = (label: string, bgR: number, bgG: number, bgB: number, txR: number, txG: number, txB: number) => {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(7.5)
          const w = doc.getTextWidth(label) + 2.5
          doc.setFillColor(bgR, bgG, bgB)
          doc.roundedRect(px, pillY, w, pillH, pillR, pillR, 'F')
          doc.setTextColor(txR, txG, txB)
          doc.text(label, px + 1.25, y)
          px += w + 0.8
        }

        drawPill(mt.type, 255, 247, 237, 194, 65, 12)    // orange bg
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
        doc.setTextColor(148, 163, 184); doc.text(':', px, y); px += doc.getTextWidth(': ')
        drawPill(mt.ioc, 236, 253, 245, 5, 150, 105)     // green bg
        doc.setTextColor(148, 163, 184); doc.text('.', px, y); px += doc.getTextWidth('. ')
        drawPill(mt.metric, 239, 246, 255, 29, 78, 216)   // blue bg

        // Reset font and advance x
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(layout.bodyFontPt)
        doc.setTextColor(0, 0, 0)
        x = px
      } else if (segment.isCode && segmentLine.length > 0) {
        const codeHeightMm = layout.lineHeightMm * 0.85
        doc.setFillColor(...layout.codeBackgroundRgb)
        doc.rect(drawX, y - codeHeightMm * 0.75, lineWidthMm + 1, codeHeightMm, 'F')
        doc.setTextColor(30, 41, 59)
        doc.text(segmentLine, drawX, y)
      } else {
        doc.text(segmentLine, drawX, y)
      }
      doc.setTextColor(0, 0, 0)
      if (!segment.metricTag) x += lineWidthMm
    }
  }
  return y + layout.lineHeightMm
}

function addWrappedLines(
  doc: jsPDF,
  text: string,
  currentY: number,
  layout: HldPdfLayout,
  options: TextRunOptions = {}
): number {
  const safeText = typeof text === 'string' ? text : String(text ?? '')
  const indentMm = options.indentMm ?? 0
  const font = options.font ?? 'helvetica'
  const style = options.style ?? 'normal'
  const fontSize = options.size ?? layout.bodyFontPt
  const maxWidthMm = layout.pageWidthMm - 2 * layout.marginMm - indentMm
  doc.setFont(font, style)
  doc.setFontSize(fontSize)
  const wrappedLines = doc.splitTextToSize(safeText, maxWidthMm) as string[]
  let y = currentY
  const pageBottomY = layout.pageHeightMm - layout.maxYReserveMm
  for (const line of wrappedLines) {
    if (y > pageBottomY) {
      doc.addPage()
      drawFooterLine(doc, layout)
      y = layout.marginMm
    }
    doc.text(line, layout.marginMm + indentMm, y)
    y += layout.lineHeightMm
  }
  return y
}

/** Convert metric tag XML to clean bracketed text for PDF output. */
const METRIC_TAG_PDF_REGEX =
  /<metric-type>\s*(.*?)\s*<\/metric-type>\s*:\s*<ioc>\s*(.*?)\s*<\/ioc>\s*\.\s*<metric>\s*(.*?)\s*<\/metric>/g

/** Strip {annotation} suffixes from metric tag fields (e.g. "PM {CC}" → "PM") */
function cleanMetricField(raw: string): string {
  return raw.replace(/\s*\{[^}]*\}\s*/g, '').trim()
}

// Delimiters for styled metric tags in PDF (invisible to user, parsed by renderer)
const MT_OPEN = '\x02MT['
const MT_SEP = '|'
const MT_CLOSE = ']\x03'
function processMetricTagsForPdf(text: string): string {
  return text.replace(METRIC_TAG_PDF_REGEX, (_m, type: string, ioc: string, metric: string) =>
    `${MT_OPEN}${cleanMetricField(type)}${MT_SEP}${cleanMetricField(ioc)}${MT_SEP}${cleanMetricField(metric)}${MT_CLOSE}`
  )
}

/** Renders markdown-ish plan body: GFM tables, headings, numbered steps, bullets (closer to app than plain text). */
function renderMarkdownPlanBody(
  doc: jsPDF,
  rawMarkdown: string,
  startY: number,
  layout: HldPdfLayout
): number {
  if (!rawMarkdown.trim()) {
    return addWrappedLines(doc, EMPTY_BODY, startY, layout, {})
  }
  // Process metric tag XML into readable text, then sanitize for WinAnsiEncoding
  const processed = sanitizeForPdf(processMetricTagsForPdf(rawMarkdown))
  const lines = processed.replace(/\r\n/g, '\n').split('\n')
  let lineIndex = 0
  let y = startY
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    if (!line.trim()) {
      lineIndex++
      continue
    }
    const table = tryParseGfmTable(lines, lineIndex)
    if (table) {
      y = ensureVerticalSpace(doc, y, layout.tableMinSpaceBeforeMm, layout)
      const numCols = table.head.length
      const isWideTable = numCols >= 6
      const tableFontSize = isWideTable ? 6 : 7.5
      const tableCellPadding = isWideTable ? 1 : 1.5

      // For wide tables, give "Path" / long-text columns more space
      const columnStyles: Record<number, { cellWidth?: number | 'auto' | 'wrap' }> = {}
      if (isWideTable) {
        const lowerHeads = table.head.map(h => h.toLowerCase())
        for (let ci = 0; ci < lowerHeads.length; ci++) {
          const h = lowerHeads[ci]
          if (h === 'path' || h === 'description') {
            columnStyles[ci] = { cellWidth: 'auto' }
          } else if (['min', 'max', 'unit'].includes(h)) {
            columnStyles[ci] = { cellWidth: 10 }
          } else if (['category', 'data type'].includes(h)) {
            columnStyles[ci] = { cellWidth: 16 }
          }
        }
      }

      autoTable(doc, {
        startY: y,
        head: [table.head],
        body: table.body,
        margin: { left: layout.marginMm, right: layout.marginMm },
        styles: {
          font: 'helvetica',
          fontSize: tableFontSize,
          cellPadding: tableCellPadding,
          overflow: 'linebreak',
          valign: 'top',
          minCellWidth: isWideTable ? 8 : undefined,
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: tableFontSize,
        },
        bodyStyles: { textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [252, 252, 253] },
        columnStyles,
        theme: 'grid',
        tableLineColor: [203, 213, 225],
        tableLineWidth: 0.15,
        tableWidth: 'auto',
      })
      const docWithTable = doc as JsPdfWithAutoTable
      y = (docWithTable.lastAutoTable?.finalY ?? y) + 5
      lineIndex = table.nextLineIndex
      continue
    }
    const textBlockLines: string[] = []
    while (lineIndex < lines.length) {
      const currentLine = lines[lineIndex]
      if (!currentLine.trim()) break
      if (tryParseGfmTable(lines, lineIndex)) break
      textBlockLines.push(currentLine)
      lineIndex++
    }
    y = renderTextBlock(doc, textBlockLines, y, layout)
  }
  return y
}

function renderTextBlock(
  doc: jsPDF,
  blockLines: string[],
  startY: number,
  layout: HldPdfLayout
): number {
  const block = blockLines.join('\n').trim()
  if (!block) return startY

  const contentWidthMm = layout.pageWidthMm - 2 * layout.marginMm
  let y = startY

  for (const line of blockLines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue
    const headingMatch = trimmedLine.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const hashes = headingMatch[1]
      const headingText = headingMatch[2].replace(/\*\*/g, '')
      y = ensureVerticalSpace(doc, y, 10, layout)
      const headingSize =
        hashes.length === 1
          ? layout.mainHeadingFontPt
          : hashes.length === 2
            ? layout.sectionTitleFontPt
            : layout.subHeadingFontPt
      y = addWrappedLines(doc, headingText, y, layout, {
        font: 'helvetica',
        style: 'bold',
        size: headingSize,
      })
      y += 1
      continue
    }
    const numberedBoldMatch = trimmedLine.match(/^(\d+)[\).]\s+\*\*(.+?)\*\*(.*)$/)
    if (numberedBoldMatch) {
      y = ensureVerticalSpace(doc, y, 8, layout)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(layout.bodyFontPt)
      const fullLine = `${numberedBoldMatch[1]}) ${numberedBoldMatch[2]}${numberedBoldMatch[3]}`
      const wrapped = doc.splitTextToSize(fullLine, contentWidthMm) as string[]
      for (const wrappedLine of wrapped) {
        y = ensureVerticalSpace(doc, y, layout.lineHeightMm, layout)
        doc.text(wrappedLine, layout.marginMm, y)
        y += layout.lineHeightMm
      }
      y += 1
      continue
    }
    const numberedPlainMatch = trimmedLine.match(/^(\d+)[\).]\s+(.+)$/)
    if (numberedPlainMatch && trimmedLine.length < layout.numberedStepSingleLineMaxChars) {
      y = ensureVerticalSpace(doc, y, 8, layout)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(layout.bodyFontPt)
      doc.text(`${numberedPlainMatch[1]}) `, layout.marginMm, y)
      const numberPrefixWidthMm = doc.getTextWidth(`${numberedPlainMatch[1]}) `)
      doc.setFont('helvetica', 'normal')
      const rest = stripInlineMarkdown(numberedPlainMatch[2])
      const continuationLines = doc.splitTextToSize(
        rest,
        contentWidthMm - numberPrefixWidthMm
      ) as string[]
      doc.text(continuationLines[0] ?? '', layout.marginMm + numberPrefixWidthMm, y)
      let continuationY = y
      for (let k = 1; k < continuationLines.length; k++) {
        continuationY += layout.lineHeightMm
        continuationY = ensureVerticalSpace(doc, continuationY, layout.lineHeightMm, layout)
        doc.text(continuationLines[k], layout.marginMm + 4, continuationY)
      }
      y = continuationY + layout.lineHeightMm
      continue
    }
    if (numberedPlainMatch && trimmedLine.length >= layout.numberedStepSingleLineMaxChars) {
      const rest = stripInlineMarkdown(numberedPlainMatch[2])
      y = ensureVerticalSpace(doc, y, 8, layout)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(layout.bodyFontPt)
      doc.text(`${numberedPlainMatch[1]}) `, layout.marginMm, y)
      const numberPrefixWidthMm = doc.getTextWidth(`${numberedPlainMatch[1]}) `)
      doc.setFont('helvetica', 'normal')
      y = addWrappedLines(doc, rest, y, layout, { indentMm: numberPrefixWidthMm })
      y += 1
      continue
    }
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (bulletMatch) {
      const leadingSpaces = bulletMatch[1].length
      const level = Math.min(Math.floor(leadingSpaces / 2), 5)
      const indentMm =
        layout.bulletBaseIndentMm + level * layout.bulletIndentPerLevelMm
      const bulletContent = bulletMatch[2].replace(/\*\*/g, '').trim()
      y = ensureVerticalSpace(doc, y, layout.lineHeightMm, layout)
      y = addLineWithInlineCode(doc, `* ${bulletContent}`, y, layout, indentMm)
      continue
    }
    if (/^(If|Else|Then|Compute)\b/i.test(trimmedLine) || /^-\s+If\b/i.test(trimmedLine)) {
      const pseudoCodeLine = stripInlineMarkdown(trimmedLine.replace(/^-\s+/, ''))
      y = addWrappedLines(doc, pseudoCodeLine, y, layout, {
        indentMm: 4,
        font: 'courier',
        size: layout.codeFontPt,
      })
      continue
    }
    const boldOnlyMatch = trimmedLine.match(/^\*\*([^*]+)\*\*$/)
    if (boldOnlyMatch) {
      y = ensureVerticalSpace(doc, y, 8, layout)
      y = addWrappedLines(doc, boldOnlyMatch[1], y, layout, { style: 'bold', size: 10 })
      continue
    }
    y = ensureVerticalSpace(doc, y, layout.lineHeightMm, layout)
    y = addLineWithInlineCode(doc, trimmedLine.replace(/\*\*/g, ''), y, layout, 0)
  }
  return y + layout.blockSpacingMm
}

function addSectionTitle(
  doc: jsPDF,
  title: string,
  currentY: number,
  layout: HldPdfLayout
): number {
  let y = currentY
  const pageBottomY = layout.pageHeightMm - layout.maxYReserveMm
  if (y > pageBottomY - layout.sectionTitleSpaceMm) {
    doc.addPage()
    drawFooterLine(doc, layout)
    y = layout.marginMm
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(layout.sectionTitleFontPt)
  doc.setTextColor(15, 23, 42)
  doc.text(title, layout.marginMm, y)
  doc.setTextColor(0, 0, 0)
  return y + 8
}

function addFlowchartImage(
  doc: jsPDF,
  dataUrl: string,
  startY: number,
  layout: HldPdfLayout
): number {
  let y = startY
  if (y > layout.pageHeightMm - layout.flowchartMinSpaceBeforeMm) {
    doc.addPage()
    drawFooterLine(doc, layout)
    y = layout.marginMm
  }
  y = addSectionTitle(doc, 'Flowchart', y, layout)
  y -= 2
  try {
    const imageWidthMm = layout.pageWidthMm - 2 * layout.marginMm
    const imageHeightMm = Math.min(
      imageWidthMm * layout.flowchartImageWidthRatio,
      layout.pageHeightMm - y - layout.flowchartBottomReserveMm
    )
    doc.addImage(dataUrl, 'PNG', layout.marginMm, y, imageWidthMm, imageHeightMm, undefined, 'FAST')
    y += imageHeightMm + 10
  } catch {
    y = addWrappedLines(doc, '(Flowchart image could not be embedded.)', y, layout, {})
  }
  return y
}

export interface BuildHldPdfInput {
  /** Project or session name; used in PDF subtitle and filename (sanitized). */
  projectName: string
  /** Plan content in markdown (GFM). Truncated if over maxPlanMarkdownChars. */
  planMarkdown: string
  /** PNG data URL for flowchart image, or null to omit. */
  flowchartDataUrl: string | null
}

/**
 * Sanitizes a string for use in a downloaded filename (ASCII alphanumeric, underscore, hyphen).
 * @param name - Raw project/session name
 * @param maxLen - Max length (default from layout)
 * @returns Safe filename base
 */
export function sanitizeHldFilename(name: string, maxLen: number = HLD_PDF_LAYOUT.maxFilenameBaseChars): string {
  const safe = (name ?? '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen)
  return safe || 'HLD'
}

/**
 * Builds the HLD PDF blob from plan markdown and optional flowchart image.
 * @param input - Project name, plan markdown, and optional flowchart data URL
 * @returns PDF Blob (throws on unexpected jsPDF/autoTable failure)
 */
export function buildHldPdf(input: BuildHldPdfInput): Blob {
  const layout = HLD_PDF_LAYOUT
  const planMarkdown =
    typeof input.planMarkdown === 'string' &&
    input.planMarkdown.length > layout.maxPlanMarkdownChars
      ? input.planMarkdown.slice(0, layout.maxPlanMarkdownChars) + '\n\n_(content truncated)_'
      : (input.planMarkdown ?? '')
  const model = computeHldPdfModel(planMarkdown)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y: number = layout.marginMm
  const projectLabel = (input.projectName ?? '').trim() || 'Project'

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(layout.titleFontPt)
  doc.setTextColor(15, 23, 42)
  doc.text('High-Level Design Document', layout.marginMm, y)
  y += 10

  doc.setFontSize(layout.subtitleFontPt)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(80, 80, 80)
  doc.text(`Project: ${projectLabel}`, layout.marginMm, y)
  doc.setTextColor(0, 0, 0)
  y += 9

  y = addSectionTitle(doc, 'Overview', y, layout)
  y = renderMarkdownPlanBody(doc, model.overviewRaw || model.overviewBody, y, layout)
  y += 4

  if (model.userIntentBody && model.userIntentRaw) {
    y = addSectionTitle(doc, 'User Intent', y, layout)
    y = renderMarkdownPlanBody(doc, model.userIntentRaw, y, layout)
    y += 4
  }

  if (input.flowchartDataUrl) {
    y = addFlowchartImage(doc, input.flowchartDataUrl, y, layout)
  } else {
    y = addSectionTitle(doc, 'Flowchart', y, layout)
    y = addWrappedLines(
      doc,
      'No flowchart nodes in this export. Add a flowchart in the Flowchart tab to include a diagram.',
      y,
      layout,
      {}
    )
    y += 4
  }

  for (const section of model.tailSections) {
    const normalizedTitle = normalizeSectionTitle(section.title)
    if (normalizedTitle === 'overview' || normalizedTitle === 'plan') continue
    y = ensureVerticalSpace(doc, y, 16, layout)
    y = addSectionTitle(doc, humanizeSectionTitle(section.title), y, layout)
    const sectionBodyRaw = section.bodyRaw ?? section.body
    y = renderMarkdownPlanBody(doc, sectionBodyRaw, y, layout)
    y += 5
  }

  const totalPages = doc.getNumberOfPages()
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    doc.setPage(pageNum)
    drawFooterLine(doc, layout)
  }

  return doc.output('blob')
}

/**
 * Triggers a browser download of the HLD PDF blob.
 * @param blob - PDF Blob from buildHldPdf
 * @param filenameBase - Base for filename (e.g. project/session id); sanitized via sanitizeHldFilename
 */
export function downloadHldBlob(blob: Blob, filenameBase: string): void {
  const safe = sanitizeHldFilename(filenameBase)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}_HLD.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
