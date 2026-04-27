/**
 * Chart Generator Service
 *
 * Takes SQL query result rows + the user's original question and returns a
 * complete ECharts option object. Uses the LLM when available; falls back to
 * a deterministic heuristic when not.
 */
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';

// ─── Column type inference ───────────────────────────────────────────────────

interface ColTypeInfo {
  types: Record<string, 'date' | 'number' | 'string'>;
  dateColumns: string[];
  numericColumns: string[];
  categoricalColumns: string[];
}

function detectColumnTypes(rows: Record<string, any>[]): ColTypeInfo {
  if (!rows.length) {
    return { types: {}, dateColumns: [], numericColumns: [], categoricalColumns: [] };
  }
  const cols = Object.keys(rows[0]);
  const types: Record<string, 'date' | 'number' | 'string'> = {};

  for (const col of cols) {
    const sample = rows.find((r) => r[col] != null)?.[col];
    if (sample == null) { types[col] = 'string'; continue; }

    const colLower = col.toLowerCase();
    if (
      colLower.includes('date') ||
      colLower.endsWith('_id') && /^\d{4}-\d{2}-\d{2}/.test(String(sample)) ||
      (typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sample))
    ) {
      types[col] = 'date';
    } else if (typeof sample === 'number' || (typeof sample === 'string' && !isNaN(Number(sample)) && String(sample).trim() !== '')) {
      types[col] = 'number';
    } else {
      types[col] = 'string';
    }
  }

  return {
    types,
    dateColumns: cols.filter((c) => types[c] === 'date'),
    numericColumns: cols.filter((c) => types[c] === 'number'),
    categoricalColumns: cols.filter((c) => types[c] === 'string'),
  };
}

// ─── Fallback chart builder ──────────────────────────────────────────────────

const PALETTE = ['#6366f1', '#22d3ee', '#f59e0b', '#34d399', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#4ade80', '#f472b6', '#818cf8', '#67e8f9', '#fcd34d', '#6ee7b7'];
const BASE_GRID = { left: 48, right: 16, top: 28, bottom: 48, containLabel: true };
const DATA_ZOOM = [
  { type: 'slider', bottom: 16, height: 22, start: 0, end: 100, borderColor: 'transparent', fillerColor: 'rgba(99,102,241,0.12)', handleStyle: { color: '#6366f1' }, dataBackground: { lineStyle: { color: 'rgba(99,102,241,0.3)' }, areaStyle: { color: 'rgba(99,102,241,0.06)' } } },
  { type: 'inside', start: 0, end: 100 },
];

function truncLabel(s: string, max = 14): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildFallbackChart(
  rows: Record<string, any>[],
  question: string,
  colTypes: ColTypeInfo,
): ChartResult {
  const { dateColumns, numericColumns, categoricalColumns } = colTypes;
  const title = question.slice(0, 70);

  // ── Time-series → line chart ──────────────────────────────────────────────
  if (dateColumns.length && numericColumns.length) {
    const dateCol = dateColumns[0];
    const valueCol = numericColumns[0];
    const sorted = [...rows].sort((a, b) =>
      String(a[dateCol]).localeCompare(String(b[dateCol])),
    );

    // If there's also a categorical column → pivot into one series per category (cell_name, etc.)
    if (categoricalColumns.length) {
      const catCol = categoricalColumns[0];
      const allCats = Array.from(new Set(rows.map((r) => String(r[catCol])))).slice(0, 20);
      const allDates = Array.from(new Set(sorted.map((r) => String(r[dateCol]).slice(0, 10)))).sort();
      const lookup = new Map<string, number>();
      for (const r of sorted) {
        lookup.set(`${String(r[dateCol]).slice(0, 10)}__${String(r[catCol])}`, Number(r[valueCol]) || 0);
      }
      const manyDates = allDates.length > 10;
      const multiSeries = allCats.length > 1;
      return {
        chartType: 'line',
        title,
        preferTable: false,
        echartsOption: {
          color: PALETTE,
          tooltip: { trigger: 'axis', axisPointer: { type: 'cross', crossStyle: { color: '#94a3b8' } } },
          legend: {
            bottom: multiSeries ? 48 : 0,
            type: 'scroll',
            textStyle: { fontSize: 11 },
          },
          grid: { ...BASE_GRID, bottom: multiSeries ? 92 : 56 },
          xAxis: {
            type: 'category',
            data: allDates,
            axisLabel: { fontSize: 10, interval: 0, rotate: manyDates ? 35 : 0 },
            boundaryGap: false,
          },
          yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
          dataZoom: multiSeries ? DATA_ZOOM : undefined,
          series: allCats.map((cat, i) => ({
            name: truncLabel(cat, 22),
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 4,
            showSymbol: false,
            emphasis: { focus: 'series' },
            lineStyle: { width: 1.5 },
            color: PALETTE[i % PALETTE.length],
            data: allDates.map((d) => {
              const v = lookup.get(`${d}__${cat}`);
              return v !== undefined ? v : null;
            }),
          })),
        },
      };
    }

    // Simple time-series (date + value columns only)
    const valueCols = numericColumns.slice(0, 4);
    const xData = sorted.map((r) => String(r[dateCol]).slice(0, 10));
    const manyDates = xData.length > 10;
    return {
      chartType: 'line',
      title,
      preferTable: false,
      echartsOption: {
        color: PALETTE,
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross', crossStyle: { color: '#94a3b8' } } },
        legend: valueCols.length > 1 ? { bottom: 48, textStyle: { fontSize: 11 } } : undefined,
        grid: { ...BASE_GRID, bottom: manyDates ? 92 : 56 },
        xAxis: {
          type: 'category',
          data: xData,
          boundaryGap: false,
          axisLabel: { fontSize: 10, interval: 0, rotate: manyDates ? 35 : 0 },
        },
        yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
        dataZoom: DATA_ZOOM,
        series: valueCols.map((col, i) => ({
          name: col.replace(/_/g, ' '),
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          showSymbol: false,
          emphasis: { focus: 'series' },
          lineStyle: { width: 1.5 },
          color: PALETTE[i % PALETTE.length],
          data: sorted.map((r) => (r[col] != null ? Number(r[col]) : null)),
        })),
      },
    };
  }

  // ── Category + value → bar chart ─────────────────────────────────────────
  if (categoricalColumns.length && numericColumns.length) {
    const catCol = categoricalColumns[0];
    const valCol = numericColumns[0];
    const limited = rows.slice(0, 20);
    const horizontal = limited.some((r) => String(r[catCol]).length > 10);

    return {
      chartType: 'bar',
      title,
      preferTable: false,
      echartsOption: {
        color: PALETTE,
        tooltip: { trigger: 'axis' },
        grid: { ...BASE_GRID, bottom: horizontal ? 16 : 48, left: horizontal ? 120 : 48 },
        ...(horizontal
          ? {
              xAxis: { type: 'value', axisLabel: { fontSize: 11 } },
              yAxis: {
                type: 'category',
                data: limited.map((r) => truncLabel(String(r[catCol]))),
                axisLabel: { fontSize: 11 },
                inverse: true,
              },
            }
          : {
              xAxis: {
                type: 'category',
                data: limited.map((r) => truncLabel(String(r[catCol]))),
                axisLabel: { fontSize: 11, rotate: limited.length > 8 ? 30 : 0 },
              },
              yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
            }),
        series: [
          {
            name: valCol.replace(/_/g, ' '),
            type: 'bar',
            data: limited.map((r) => Number(r[valCol]) || 0),
            itemStyle: { borderRadius: [4, 4, 0, 0] },
          },
        ],
      },
    };
  }

  // ── Pure numeric aggregate across columns → horizontal bar ───────────────
  if (numericColumns.length > 1 && rows.length === 1) {
    const items = numericColumns.slice(0, 8).map((col) => ({
      name: col.replace(/_/g, ' '),
      value: Number(rows[0][col]) || 0,
    }));
    return {
      chartType: 'bar',
      title,
      preferTable: false,
      echartsOption: {
        color: PALETTE,
        tooltip: {},
        grid: { ...BASE_GRID, left: 120 },
        xAxis: { type: 'value' },
        yAxis: {
          type: 'category',
          data: items.map((i) => i.name),
          axisLabel: { fontSize: 11 },
          inverse: true,
        },
        series: [{ type: 'bar', data: items.map((i) => i.value), itemStyle: { borderRadius: [0, 4, 4, 0] } }],
      },
    };
  }

  // ── Default: prefer table ─────────────────────────────────────────────────
  return {
    chartType: 'table',
    title,
    preferTable: true,
    echartsOption: {},
  };
}

// ─── Public types ────────────────────────────────────────────────────────────

export interface ChartResult {
  echartsOption: Record<string, any>;
  chartType: string;
  title: string;
  subtitle?: string;
  preferTable: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

const LLM_PROMPT_TEMPLATE = `You are a data-visualization expert. Given database query results and the user's original question, output the best ECharts 5 option object.

User question: "{QUESTION}"
Row count: {ROW_COUNT}
Columns (name → type): {COLUMNS}
Data ({SAMPLE_COUNT} rows — use ALL of these as the chart data, do not truncate):
{SAMPLE}

Chart selection rules:
- date + numeric columns → line chart (smooth:true, xAxis.type="category" with date strings, boundaryGap:false)
- date + categorical + numeric → multi-series line: pivot by category (one series per unique category value) — cap at 20 series
- categorical + numeric → bar chart (horizontal if label length > 10)
- proportions / composition (≤ 8 groups) → pie with radius:["40%","70%"]
- two numeric columns → scatter
- single aggregate row → horizontal bar (one bar per column)
- if rows ≤ 6 and no chart makes sense, set preferTable:true

ECharts rules:
- color palette: ["#6366f1","#22d3ee","#f59e0b","#34d399","#f87171","#a78bfa","#38bdf8","#fb923c","#4ade80","#f472b6","#818cf8","#67e8f9","#fcd34d","#6ee7b7"]
- tooltip: {trigger:"axis", axisPointer:{type:"cross", crossStyle:{color:"#94a3b8"}}}
- grid: {left:48,right:16,top:28,bottom:92,containLabel:true}
- For ALL line charts add: dataZoom:[{type:"slider",bottom:16,height:22,start:0,end:100,borderColor:"transparent",fillerColor:"rgba(99,102,241,0.12)",handleStyle:{color:"#6366f1"}},{type:"inside",start:0,end:100}]
- legend: {bottom:48, type:"scroll", textStyle:{fontSize:11}} when > 1 series
- axis labels fontSize:11, DO NOT include any formatter functions (JSON cannot contain functions)
- series line style: smooth:true, showSymbol:false, symbol:"circle", symbolSize:4, lineStyle:{width:1.5}, emphasis:{focus:"series"}
- series itemStyle.borderRadius for bars: [4,4,0,0] (vertical) or [0,4,4,0] (horizontal)
- CRITICAL: ALWAYS put data in series[].data arrays — NEVER use the dataset/encode API
- CRITICAL: Every series object MUST have a data array with one entry per x-axis category. Use null for missing values.
- CRITICAL for multi-series pivot: collect all unique category values → sort → build one series per value → for each date, look up that category's value (null if absent)

Respond with ONLY valid JSON (no markdown fences):
{
  "chartType": "line|bar|pie|scatter",
  "title": "concise chart title (max 70 chars)",
  "subtitle": "optional one-line subtitle",
  "preferTable": false,
  "echartsOption": { ...complete ECharts 5 option object... }
}`;

export class ChartGeneratorService {
  /**
   * Main entry point. Attempts LLM-based generation, falls back to heuristic.
   */
  static async generateChartOption(
    rows: Record<string, any>[],
    question: string,
  ): Promise<ChartResult> {
    if (!rows.length) {
      return {
        chartType: 'bar',
        title: 'No data returned',
        preferTable: false,
        echartsOption: {
          title: { text: 'No data', textStyle: { fontSize: 13 } },
          tooltip: {},
          xAxis: { type: 'category', data: [] },
          yAxis: { type: 'value' },
          series: [],
        },
      };
    }

    const colTypes = detectColumnTypes(rows);

    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key') {
      try {
        return await this.generateWithLLM(rows, question, colTypes);
      } catch (err) {
        logger.warn('[chart-gen] LLM generation failed, using fallback', err);
      }
    }

    return buildFallbackChart(rows, question, colTypes);
  }

  private static async generateWithLLM(
    rows: Record<string, any>[],
    question: string,
    colTypes: ColTypeInfo,
  ): Promise<ChartResult> {
    const cols = Object.keys(rows[0]);
    // Pass all rows (up to 500). Per-cell 30-day queries = ~30×cells rows — still small JSON.
    const sample = rows.slice(0, 500);

    const prompt = LLM_PROMPT_TEMPLATE
      .replace('{QUESTION}', question)
      .replace('{ROW_COUNT}', String(rows.length))
      .replace('{COLUMNS}', cols.map((c) => `${c} → ${colTypes.types[c]}`).join(', '))
      .replace('{SAMPLE_COUNT}', String(sample.length))
      .replace('{SAMPLE}', JSON.stringify(sample, null, 2));

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.05,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);

    if (!parsed.echartsOption || typeof parsed.echartsOption !== 'object') {
      throw new Error('LLM returned no echartsOption');
    }

    return {
      chartType: String(parsed.chartType || 'bar'),
      title: String(parsed.title || question).slice(0, 80),
      subtitle: parsed.subtitle ? String(parsed.subtitle) : undefined,
      preferTable: Boolean(parsed.preferTable),
      echartsOption: fixCategoryXAxis(parsed.echartsOption),
    };
  }
}

/**
 * When the LLM (or fallback) emits a category xAxis with many items it often
 * forgets interval:0, so ECharts auto-skips labels and only ~9 show. Force
 * interval:0 + rotation for axes with > 10 categories.
 */
function fixCategoryXAxis(option: Record<string, any>): Record<string, any> {
  const xAxis = option.xAxis;
  if (!xAxis) return option;

  const axes = Array.isArray(xAxis) ? xAxis : [xAxis];
  let changed = false;

  for (const ax of axes) {
    if (ax?.type !== 'category') continue;
    const dataLen: number = Array.isArray(ax.data) ? ax.data.length : 0;
    if (dataLen <= 10) continue;

    ax.axisLabel = {
      fontSize: 10,
      rotate: 35,
      ...(ax.axisLabel || {}),
      interval: 0,
    };
    changed = true;
  }

  if (changed && option.grid) {
    const grids = Array.isArray(option.grid) ? option.grid : [option.grid];
    for (const g of grids) {
      if (typeof g.bottom === 'number' && g.bottom < 64) g.bottom = 64;
    }
  }

  return option;
}
