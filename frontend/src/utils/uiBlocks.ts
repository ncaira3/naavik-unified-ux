import type { UiBlock } from '../types';

const ALLOWED_TYPES = new Set<string>([
  'section',
  'grid_layout',
  'tabs',
  'callout',
  'text',
  'chips',
  'stat_row',
  'data_table',
  'ranked_list',
  'map_inset',
  'kpi_dashboard',
  'rca_story',
  'rca_summary',
  'rca_report',
  'ticket_escalation',
  'execution_status',
  'code_view',
  'insight_chart',
]);

const MAX_DEPTH = 5;
const MAX_BLOCKS = 30;
const MAX_TEXT = 40_000;
const MAX_ROWS = 200;

function clampText(value: any, max = MAX_TEXT) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeOne(input: any, depth: number): UiBlock | null {
  if (!isPlainObject(input)) return null;
  const type = String(input.type || '').trim();
  if (!ALLOWED_TYPES.has(type)) return null;
  const id = input.id ? String(input.id).slice(0, 80) : undefined;
  const title = input.title ? clampText(input.title, 200) : undefined;
  const data = input.data;

  if (type === 'text') {
    if (!isPlainObject(data)) return null;
    return { type: 'text', id, title, data: { text: clampText(data.text) } };
  }

  if (type === 'callout') {
    if (!isPlainObject(data)) return null;
    const tone = String(data.tone || 'info');
    const safeTone = tone === 'success' || tone === 'warning' || tone === 'error' ? tone : 'info';
    return {
      type: 'callout',
      id,
      title,
      data: { tone: safeTone, title: data.title ? clampText(data.title, 200) : undefined, text: clampText(data.text) },
    };
  }

  if (type === 'chips') {
    if (!isPlainObject(data) || !Array.isArray((data as any).chips)) return null;
    const chips = (data as any).chips
      .slice(0, 12)
      .map((c: any) => ({
        label: clampText(c?.label, 80),
        value: clampText(c?.value, 600),
        description: c?.description ? clampText(c.description, 160) : undefined,
      }))
      .filter((c: any) => c.label && c.value);
    if (!chips.length) return null;
    const prompt = (data as any).prompt ? clampText((data as any).prompt, 300) : undefined;
    return { type: 'chips', id, title, data: { prompt, chips } };
  }

  if (type === 'stat_row') {
    if (!isPlainObject(data) || !Array.isArray((data as any).items)) return null;
    const items = (data as any).items
      .slice(0, 16)
      .map((it: any) => ({
        label: clampText(it?.label, 80),
        value: clampText(it?.value, 240),
        hint: it?.hint ? clampText(it.hint, 200) : undefined,
      }))
      .filter((x: any) => x.label && x.value);
    if (!items.length) return null;
    return { type: 'stat_row', id, title, data: { items } };
  }

  if (type === 'data_table') {
    if (!isPlainObject(data) || !Array.isArray((data as any).rows)) return null;
    const rows = (data as any).rows.slice(0, MAX_ROWS).map((r: any) => (isPlainObject(r) ? r : {}));
    return {
      type: 'data_table',
      id,
      title,
      data: {
        title: data.title ? clampText(data.title, 120) : undefined,
        rowTooltipField: data.rowTooltipField ? String(data.rowTooltipField).slice(0, 80) : undefined,
        rows,
      },
    };
  }

  if (type === 'ranked_list') {
    if (!isPlainObject(data) || !Array.isArray((data as any).items)) return null;
    const items = (data as any).items
      .slice(0, 20)
      .map((it: any) => ({
        title: clampText(it?.title, 120),
        subtitle: it?.subtitle ? clampText(it.subtitle, 160) : undefined,
        value: it?.value ? clampText(it.value, 80) : undefined,
        severity: it?.severity === 'high' || it?.severity === 'med' || it?.severity === 'low' ? it.severity : undefined,
      }))
      .filter((x: any) => x.title);
    if (!items.length) return null;
    return { type: 'ranked_list', id, title, data: { title: data.title ? clampText(data.title, 120) : undefined, items } };
  }

  if (type === 'section') {
    if (!isPlainObject(data) || !Array.isArray((data as any).blocks)) return null;
    if (depth >= MAX_DEPTH) return null;
    const blocks = (data as any).blocks
      .slice(0, MAX_BLOCKS)
      .map((b: any) => sanitizeOne(b, depth + 1))
      .filter(Boolean) as UiBlock[];
    if (!blocks.length) return null;
    return { type: 'section', id, title, data: { description: data.description ? clampText(data.description, 500) : undefined, blocks } };
  }

  if (type === 'grid_layout') {
    if (!isPlainObject(data) || !Array.isArray((data as any).blocks)) return null;
    if (depth >= MAX_DEPTH) return null;
    const blocks = (data as any).blocks
      .slice(0, 12)
      .map((entry: any) => {
        const span = Number(entry?.span);
        const block = sanitizeOne(entry?.block, depth + 1);
        if (!block) return null;
        return { span: Number.isFinite(span) ? Math.max(1, Math.min(12, span)) : undefined, block };
      })
      .filter(Boolean) as Array<{ span?: number; block: UiBlock }>;
    if (!blocks.length) return null;
    return { type: 'grid_layout', id, title, data: { columns: Number.isFinite(Number((data as any).columns)) ? Number((data as any).columns) : undefined, blocks } };
  }

  if (type === 'tabs') {
    if (!isPlainObject(data) || !Array.isArray((data as any).tabs)) return null;
    if (depth >= MAX_DEPTH) return null;
    const tabs = (data as any).tabs
      .slice(0, 8)
      .map((t: any) => {
        if (!isPlainObject(t)) return null;
        const tid = String(t.id || '').slice(0, 60);
        const label = clampText(t.label, 60);
        const blocks = Array.isArray(t.blocks)
          ? (t.blocks.slice(0, MAX_BLOCKS).map((b: any) => sanitizeOne(b, depth + 1)).filter(Boolean) as UiBlock[])
          : [];
        if (!tid || !label || blocks.length === 0) return null;
        return { id: tid, label, blocks };
      })
      .filter(Boolean) as Array<{ id: string; label: string; blocks: UiBlock[] }>;
    if (!tabs.length) return null;
    return { type: 'tabs', id, title, data: { tabs } };
  }

  // insight_chart: validate echartsOption exists, pass through
  if (type === 'insight_chart') {
    if (!isPlainObject(data) || !isPlainObject((data as any).echartsOption)) return null;
    return {
      type: 'insight_chart',
      id,
      title,
      data: {
        title: data.title ? clampText(data.title, 120) : undefined,
        subtitle: data.subtitle ? clampText(data.subtitle, 200) : undefined,
        source: data.source ? clampText(data.source, 200) : undefined,
        height: Number.isFinite(Number(data.height)) ? Number(data.height) : undefined,
        echartsOption: (data as any).echartsOption,
      },
    } as any;
  }

  // Bridged types: let renderer delegate to existing components. Keep data as-is.
  if (
    type === 'map_inset' ||
    type === 'kpi_dashboard' ||
    type === 'rca_story' ||
    type === 'rca_summary' ||
    type === 'rca_report' ||
    type === 'ticket_escalation' ||
    type === 'execution_status' ||
    type === 'code_view'
  ) {
    return { type: type as any, id, title, data: data as any };
  }

  return null;
}

export function sanitizeUiBlocks(input: any): UiBlock[] {
  if (!Array.isArray(input)) return [];
  const out: UiBlock[] = [];
  for (const b of input.slice(0, MAX_BLOCKS)) {
    const block = sanitizeOne(b, 0);
    if (block) out.push(block);
  }
  return out;
}

export function emitChip(value: string) {
  window.dispatchEvent(new CustomEvent('naavik:chat:chip', { detail: { value } }));
}

