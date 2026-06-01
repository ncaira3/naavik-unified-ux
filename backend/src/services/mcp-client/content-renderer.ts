/**
 * Render MCP `content[]` into Naavik's `ToolResult` shape.
 *
 * MCP defines `content` as an array of typed parts:
 *   { type: 'text',     text: string }
 *   { type: 'image',    data: base64, mimeType: string }
 *   { type: 'resource', resource: { uri, mimeType?, text? } }
 *   { type: 'audio',    data, mimeType }  — rare
 *
 * We map them to Naavik's `llmText` (markdown) + a primary `uiBlock` +
 * optional `extraUiBlocks`. The LLM sees `llmText` for reasoning; the user
 * sees the UI blocks alongside.
 *
 * Heuristic: if the text payload looks like a markdown table, we emit a
 * `compact_table` block so it renders natively rather than as monospace text.
 */
import type { ToolResult, UiBlockSuggestion } from '../agent-tools.registry.js';

interface RenderOpts {
  content: any[];
  /** Short label shown in callouts/captions so users know where the result
   * came from (e.g. "GitHub → create_issue"). */
  sourceLabel?: string;
}

export function renderMcpContent(opts: RenderOpts): ToolResult {
  const { content, sourceLabel } = opts;
  const llmTextParts: string[] = [];
  const extraBlocks: UiBlockSuggestion[] = [];
  let primaryBlock: UiBlockSuggestion | undefined;

  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      const text = String(part.text || '');
      if (!text) continue;
      llmTextParts.push(text);
      const maybeTable = parseMarkdownTable(text);
      if (maybeTable) {
        if (!primaryBlock) {
          primaryBlock = {
            type: 'compact_table',
            title: sourceLabel,
            data: {
              title: sourceLabel,
              rows: maybeTable.rows,
              columnOrder: maybeTable.columns,
            },
          };
        } else {
          extraBlocks.push({
            type: 'compact_table',
            data: { rows: maybeTable.rows, columnOrder: maybeTable.columns },
          });
        }
      }
    } else if (part.type === 'image' && typeof part.data === 'string') {
      // Embed images as a markdown reference so the chat bubble shows them.
      const mime = part.mimeType || 'image/png';
      llmTextParts.push(`\n\n![image](data:${mime};base64,${part.data})\n\n`);
    } else if (part.type === 'resource' && part.resource) {
      const r = part.resource;
      const inner = r.text ? `\n\n\`\`\`\n${String(r.text).slice(0, 4000)}\n\`\`\`` : '';
      llmTextParts.push(`Resource: ${r.uri}${r.mimeType ? ` (${r.mimeType})` : ''}${inner}`);
    } else if (part.type === 'audio') {
      llmTextParts.push(`(audio payload from ${sourceLabel ?? 'MCP'} — not rendered in chat)`);
    }
  }

  const llmText = llmTextParts.join('\n\n').trim() || `MCP tool ${sourceLabel ?? ''} returned no content.`;

  if (!primaryBlock) {
    // Default: render a small callout so the user sees provenance even when
    // there's no structured output.
    primaryBlock = {
      type: 'callout',
      data: {
        tone: 'info',
        title: sourceLabel ? `From ${sourceLabel}` : 'MCP result',
        text: llmText.length > 800 ? llmText.slice(0, 797) + '…' : llmText,
      },
    };
  }

  return {
    llmText,
    uiBlock: primaryBlock,
    ...(extraBlocks.length ? { extraUiBlocks: extraBlocks } : {}),
  } as any;
}

/**
 * Simple markdown-table detector. Recognises:
 *
 *   | Col 1 | Col 2 |
 *   |-------|-------|
 *   | a     | b     |
 *
 * Returns null if no table is found, or one with no body rows.
 */
function parseMarkdownTable(text: string): { columns: string[]; rows: Record<string, any>[] } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let headerIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith('|') && lines[i].endsWith('|') &&
        /^\|[\s:-]+\|/.test(lines[i + 1])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return null;
  const columns = lines[headerIdx]
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);
  if (!columns.length) return null;
  const rows: Record<string, any>[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|') || !line.endsWith('|')) break;
    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length !== columns.length) continue;
    const row: Record<string, any> = {};
    columns.forEach((c, idx) => (row[c] = cells[idx]));
    rows.push(row);
    if (rows.length >= 100) break; // safety
  }
  if (!rows.length) return null;
  return { columns, rows };
}
