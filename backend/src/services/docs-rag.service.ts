/**
 * Docs RAG Service
 *
 * Loads the documentation corpus (one chunk per anchored section), builds a
 * BM25 inverted index at module load, and exposes:
 *
 *   - search(query, limit)  → ranked chunks + highlighted snippet
 *   - answer(question, history?) → LLM answer grounded in the top-k chunks,
 *                                  with citations back to the doc sections.
 *
 * The corpus is intentionally small (< 50 KB) so we can keep it entirely
 * in memory — no embeddings server, no Postgres FTS roundtrip. BM25 is
 * fine for technical-prose retrieval of this size.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocChunk {
  pageId: string;
  pageTitle: string;
  group: string;
  sectionId: string;
  sectionTitle: string;
  text: string;
}

export interface SearchHit {
  pageId: string;
  pageTitle: string;
  group: string;
  sectionId: string;
  sectionTitle: string;
  score: number;
  snippet: string;
}

export interface DocsChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface DocsChatResponse {
  answer: string;
  citations: Array<{
    pageId: string;
    pageTitle: string;
    sectionId: string;
    sectionTitle: string;
  }>;
}

// ─── Tokenization & index ───────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'as', 'that', 'this', 'these', 'those', 'it', 'its', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'i', 'you', 'we', 'they', 'he', 'she', 'his', 'her', 'their', 'our',
  'me', 'us', 'them', 'my', 'your', 'so', 'if', 'then', 'than', 'into',
  'about', 'over', 'under', 'between', 'through', 'each', 'any', 'all',
  'some', 'no', 'not', 'only', 'just', 'also', 'too', 'very', 'such',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface IndexState {
  chunks: DocChunk[];
  termFreqs: Array<Map<string, number>>; // tf per chunk
  docFreqs: Map<string, number>;         // df per term
  avgLen: number;
  ready: boolean;
}

const state: IndexState = {
  chunks: [],
  termFreqs: [],
  docFreqs: new Map(),
  avgLen: 0,
  ready: false,
};

async function loadCorpus(): Promise<DocChunk[]> {
  // Walk up from this file (src/services) to backend root, then into src/data
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', 'data', 'docs-corpus.json'),
    path.join(here, '..', '..', 'src', 'data', 'docs-corpus.json'),
    path.join(process.cwd(), 'backend', 'src', 'data', 'docs-corpus.json'),
    path.join(process.cwd(), 'src', 'data', 'docs-corpus.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw);
    } catch { /* try next */ }
  }
  throw new Error('docs-corpus.json not found in any candidate path');
}

export async function initDocsRag(): Promise<void> {
  if (state.ready) return;
  const t0 = Date.now();
  const chunks = await loadCorpus();
  const termFreqs: Array<Map<string, number>> = [];
  const docFreqs = new Map<string, number>();
  let totalLen = 0;
  for (const chunk of chunks) {
    const tokens = tokenize(`${chunk.sectionTitle} ${chunk.pageTitle} ${chunk.text}`);
    totalLen += tokens.length;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    termFreqs.push(tf);
    for (const t of tf.keys()) docFreqs.set(t, (docFreqs.get(t) ?? 0) + 1);
  }
  state.chunks = chunks;
  state.termFreqs = termFreqs;
  state.docFreqs = docFreqs;
  state.avgLen = chunks.length ? totalLen / chunks.length : 0;
  state.ready = true;
  logger.info(
    `[docs-rag] indexed ${chunks.length} chunks · ${docFreqs.size} terms · avg-len ${state.avgLen.toFixed(1)} · ${Date.now() - t0}ms`,
  );
}

// BM25 with k1=1.5, b=0.75 — standard defaults.
function scoreBm25(queryTokens: string[]): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const N = state.chunks.length;
  const scores = new Array<number>(N).fill(0);

  for (const qt of queryTokens) {
    const df = state.docFreqs.get(qt);
    if (!df) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < N; i++) {
      const tf = state.termFreqs[i].get(qt);
      if (!tf) continue;
      const docLen = Array.from(state.termFreqs[i].values()).reduce((a, c) => a + c, 0);
      const norm = 1 - b + b * (docLen / (state.avgLen || 1));
      scores[i] += idf * (tf * (k1 + 1)) / (tf + k1 * norm);
    }
  }
  return scores;
}

// Title-boost: if the query matches a section title closely, push it up.
function titleBoost(queryTokens: string[], chunk: DocChunk): number {
  const titleTokens = new Set(tokenize(`${chunk.sectionTitle} ${chunk.pageTitle}`));
  let hits = 0;
  for (const q of queryTokens) if (titleTokens.has(q)) hits++;
  return hits * 0.6;
}

function buildSnippet(text: string, queryTokens: string[], maxLen = 220): string {
  const lowered = text.toLowerCase();
  // Find first occurrence of any query token to anchor the snippet
  let anchor = -1;
  for (const q of queryTokens) {
    const i = lowered.indexOf(q);
    if (i >= 0 && (anchor < 0 || i < anchor)) anchor = i;
  }
  if (anchor < 0) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '');
  const start = Math.max(0, anchor - 60);
  const end = Math.min(text.length, start + maxLen);
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  return head + text.slice(start, end) + tail;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function searchDocs(query: string, limit = 8): Promise<SearchHit[]> {
  if (!state.ready) await initDocsRag();
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const scores = scoreBm25(qTokens);
  const ranked = scores
    .map((s, i) => ({
      score: s + titleBoost(qTokens, state.chunks[i]),
      idx: i,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ score, idx }) => {
    const c = state.chunks[idx];
    return {
      pageId: c.pageId,
      pageTitle: c.pageTitle,
      group: c.group,
      sectionId: c.sectionId,
      sectionTitle: c.sectionTitle,
      score,
      snippet: buildSnippet(c.text, qTokens),
    };
  });
}

export async function chatWithDocs(
  question: string,
  history: DocsChatTurn[] = [],
): Promise<DocsChatResponse> {
  if (!state.ready) await initDocsRag();

  const q = String(question || '').trim();
  if (!q) {
    return { answer: 'Ask a question about Naavik features, modules, or settings.', citations: [] };
  }

  // Retrieve top chunks
  const hits = await searchDocs(q, 6);

  if (!hits.length) {
    return {
      answer:
        'I could not find anything in the documentation that matches that question. Try rephrasing, or browse the sections on the left — the most-asked topics are Observe, AppGen, Provision, and the Conversational Agent.',
      citations: [],
    };
  }

  // Build grounded context block
  const contextBlock = hits
    .map((h, i) => `[${i + 1}] ${h.pageTitle} → ${h.sectionTitle}\n${state.chunks.find((c) => c.pageId === h.pageId && c.sectionId === h.sectionId)?.text ?? ''}`)
    .join('\n\n');

  const systemPrompt = [
    'You are the Naavik documentation assistant.',
    'Answer ONLY from the documentation context provided below. Do not invent features, file paths, KPI names, or behaviour.',
    'If the answer is not present in the context, say so plainly and suggest which section the user could browse.',
    'Keep answers concise: 3–6 sentences for explanatory questions; a short bulleted list when listing multiple items.',
    'Cite the sections you used with bracketed numbers in the form [1], [2] matching the order of the context entries.',
    'Use a professional, technical tone. No emojis.',
    '',
    'DOCUMENTATION CONTEXT:',
    contextBlock,
  ].join('\n');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Include the last few history turns for coherence
  for (const turn of history.slice(-6)) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: String(turn.content || '').slice(0, 2000) });
    }
  }
  messages.push({ role: 'user', content: q });

  let answer = '';
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.DOCS_RAG_MODEL || 'gpt-4o-mini',
      messages,
      temperature: 0.2,
      max_tokens: 500,
    });
    answer = completion.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error('[docs-rag] OpenAI call failed', err);
    answer =
      'The docs assistant is temporarily unavailable. The top matching sections are listed below — open any of them directly.';
  }

  // Use only the citations that the model actually referenced in [n] form;
  // fall back to all retrieved hits if the model didn't cite anything.
  const cited = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= hits.length) cited.add(n - 1);
  }
  const citationOrder = cited.size ? Array.from(cited) : hits.map((_, i) => i);
  const citations = citationOrder.map((i) => ({
    pageId: hits[i].pageId,
    pageTitle: hits[i].pageTitle,
    sectionId: hits[i].sectionId,
    sectionTitle: hits[i].sectionTitle,
  }));

  return { answer, citations };
}

export function getDocsCorpusStats() {
  return {
    ready: state.ready,
    chunks: state.chunks.length,
    terms: state.docFreqs.size,
    avgLen: state.avgLen,
  };
}
