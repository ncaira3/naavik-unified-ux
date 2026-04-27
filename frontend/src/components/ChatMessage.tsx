import { useState, useEffect, useRef, useCallback } from 'react';
import {
  User, Clock, CheckCircle2, Download, BarChart3, Eye, Search, Zap,
  Code2, MessageCircle, CheckCircle, X, FileText, Image as ImageIcon,
  Copy, Check, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { ChatMessage as ChatMessageType } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useChat } from '../context/ChatContext';
import { useDummifier } from '../context/DummifierContext';
import AgentWorkflowDisplay from './AgentWorkflowDisplay';
import { NetworkHealthReport } from './Chat/ReportComponents/NetworkHealthReport';
import InteractiveGridTable from './Chat/ReportComponents/InteractiveGridTable';
import RcaSiteStoryCard from './Chat/ReportComponents/RcaSiteStoryCard';
import TicketEscalationCard from './Chat/ReportComponents/TicketEscalationCard';
import { ActionButton } from './Chat/ActionButton';
import { WorkflowExecutionStatus } from './Chat/ReportComponents/WorkflowExecutionStatus';
import { ActionButton as ActionButtonType, ExecutionStatus } from '../types';
import InlineChart from './InlineChart';
import InlineMap from './InlineMap';
import SiteKpiDashboard from './Chat/ReportComponents/SiteKpiDashboard';
import ChatKpiDashboard from './Chat/ReportComponents/ChatKpiDashboard';
import SavedDashboardsPanel from './Chat/ReportComponents/SavedDashboardsPanel';
import type { SavedDashboard } from '../hooks/useSavedDashboards';
import KnowledgeReportCard from './Chat/ReportComponents/KnowledgeReportCard';
import InsightChartCard from './Chat/ReportComponents/InsightChartCard';
import AgGridWrapper from './AgGridWrapper';
import UiBlocksRenderer from './GenerativeUI/UiBlocksRenderer';
import QueryDashboardSaveBar from './Chat/ReportComponents/QueryDashboardSaveBar';
import type { SavedQueryDashboard } from '../hooks/useSavedQueryDashboards';

interface ChatMessageProps {
  message: ChatMessageType;
  onActionExecute?: (action: ActionButtonType) => Promise<ExecutionStatus>;
  onChoiceClick?: (messageId: string, choiceId: string) => void;
  onRowAction?: (action: string, row: Record<string, any>) => void;
  onOpenSavedDashboard?: (dashboard: SavedDashboard) => void;
  onOpenQueryDashboard?: (dashboard: SavedQueryDashboard) => void;
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i} className="italic text-text-muted">{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="bg-cream-surface-light dark:bg-slate-800/80 text-text-primary px-1.5 py-0.5 rounded text-[0.78em] font-mono border border-border dark:border-slate-700/50">{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listBuffer: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = (key: string) => {
    if (!listBuffer) return;
    if (listBuffer.type === 'ul') {
      nodes.push(
        <ul key={key} className="my-2 space-y-1.5">
          {listBuffer.items.map((item, idx) => (
            <li key={idx} className="flex gap-2.5 text-sm leading-relaxed text-text-primary">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-text-muted flex-shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
    } else {
      nodes.push(
        <ol key={key} className="my-2 space-y-1.5 pl-1">
          {listBuffer.items.map((item, idx) => (
            <li key={idx} className="flex gap-2.5 text-sm leading-relaxed text-text-primary">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cream-surface-light dark:bg-white/10 text-text-primary text-[11px] font-semibold flex items-center justify-center mt-[1px] border border-border dark:border-white/10">
                {idx + 1}
              </span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
    }
    listBuffer = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      flushList(`list-pre-${i}`);
      const lang = line.slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const codeStr = codeLines.join('\n');
      nodes.push(<InlineCodeBlock key={`code-${i}`} code={codeStr} lang={lang} />);
      i++;
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      flushList(`list-h3-${i}`);
      nodes.push(<h3 key={`h3-${i}`} className="text-sm font-semibold text-text-primary mt-4 mb-1.5 tracking-tight">{renderInline(line.slice(4))}</h3>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      flushList(`list-h2-${i}`);
      nodes.push(<h2 key={`h2-${i}`} className="text-base font-semibold text-text-primary mt-4 mb-2 tracking-tight">{renderInline(line.slice(3))}</h2>);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      flushList(`list-h1-${i}`);
      nodes.push(<h1 key={`h1-${i}`} className="text-lg font-bold text-text-primary mt-4 mb-2 tracking-tight">{renderInline(line.slice(2))}</h1>);
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      flushList(`list-hr-${i}`);
      nodes.push(<hr key={`hr-${i}`} className="border-slate-700/50 my-3" />);
      i++; continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList(`list-bq-${i}`);
      nodes.push(
        <blockquote key={`bq-${i}`} className="border-l-2 border-text-muted pl-3 my-2 text-sm text-text-muted italic">
          {renderInline(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    // Bullet list
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (!listBuffer || listBuffer.type !== 'ul') {
        flushList(`list-ul-${i}`);
        listBuffer = { type: 'ul', items: [] };
      }
      listBuffer.items.push(line.slice(2));
      i++; continue;
    }

    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      if (!listBuffer || listBuffer.type !== 'ol') {
        flushList(`list-ol-${i}`);
        listBuffer = { type: 'ol', items: [] };
      }
      listBuffer.items.push(numMatch[2]);
      i++; continue;
    }

    // Empty line
    if (!line.trim()) {
      flushList(`list-empty-${i}`);
      nodes.push(<div key={`br-${i}`} className="h-1.5" />);
      i++; continue;
    }

    // Plain paragraph
    flushList(`list-p-${i}`);
    nodes.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed text-text-primary">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  flushList('list-final');
  return nodes;
}

// ─── Inline code block (in markdown body) ─────────────────────────────────────

function InlineCodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="my-2 rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900/70">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700/50 bg-slate-800/60">
        <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-slate-200 transition px-1.5 py-0.5 rounded hover:bg-slate-700/60"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono text-text-primary leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Streaming code block (for visualization type code/code_view) ─────────────

const CHARS_PER_SECOND = 800;

function StreamingCodeBlock({ code, onComplete }: { code: string; onComplete?: () => void }) {
  const [visibleLen, setVisibleLen] = useState(0);
  const [copied, setCopied] = useState(false);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const completedRef = useRef(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!code) return;
    startRef.current = performance.now();
    completedRef.current = false;
    const step = (now: number) => {
      const elapsed = now - startRef.current;
      const target = Math.min(Math.floor((elapsed / 1000) * CHARS_PER_SECOND), code.length);
      setVisibleLen(target);
      if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
      if (target < code.length) {
        rafRef.current = requestAnimationFrame(step);
      } else if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [code, onComplete]);

  const visible = code.slice(0, visibleLen);
  const done = visibleLen >= code.length;

  const copy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900/70">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700/50 bg-slate-800/60">
        <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">Generated Code</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-slate-200 transition px-1.5 py-0.5 rounded hover:bg-slate-700/60"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        ref={preRef}
        className="p-3 overflow-x-auto text-xs font-mono text-text-primary max-h-[420px] overflow-y-auto leading-relaxed"
      >
        <code>{visible}</code>
        {!done && <span className="inline-block w-[5px] h-[13px] bg-green-400 ml-[1px] animate-pulse align-middle rounded-sm" />}
      </pre>
    </div>
  );
}

// ─── Agent name badge ─────────────────────────────────────────────────────────
// Each agent gets a distinct dot colour from the glassmorphism chart palette
// (--naavik-chart-N CSS vars, defined in index.css for both themes), but the
// pill background and text use neutral tokens so contrast is consistent and
// the pill never looks tinted weirdly against the warm cream page.

const AGENT_DOT_COLOR: Record<string, string> = {
  'Observation Agent':    'var(--naavik-chart-2)',  // cyan
  'Reasoning Agent':      'var(--naavik-chart-1)',  // violet
  'Network Ops Agent':    'var(--naavik-chart-3)',  // amber
  'AppGen Agent':         'var(--naavik-chart-4)',  // emerald
  'Recommendation Agent': 'var(--naavik-chart-5)',  // rose
};

function extractAgentName(content: string): { agentName: string | null; cleanContent: string } {
  const match = content.match(/^\*\*([^*]{3,40})\*\*\s*[»>]\s*/);
  if (match) return { agentName: match[1], cleanContent: content.slice(match[0].length) };
  return { agentName: null, cleanContent: content };
}

function AgentBadge({ name }: { name: string }) {
  const dotColor = AGENT_DOT_COLOR[name] || 'rgb(var(--naavik-text-muted-rgb))';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide
                 border border-border bg-cream-surface-light text-text-primary
                 dark:border-white/10 dark:bg-white/5 dark:text-text-primary"
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
        aria-hidden
      />
      {name}
    </span>
  );
}

// ─── Message action bar ───────────────────────────────────────────────────────

function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const copy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 mt-2">
      <button
        onClick={copy}
        title={copied ? 'Copied!' : 'Copy response'}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-text-muted hover:text-slate-300 hover:bg-slate-700/50 transition text-[11px]"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <button
        onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
        title="Good response"
        className={`p-1.5 rounded-lg transition ${feedback === 'up' ? 'text-emerald-400 bg-emerald-500/10' : 'text-text-muted hover:text-slate-300 hover:bg-slate-700/50'}`}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
        title="Poor response"
        className={`p-1.5 rounded-lg transition ${feedback === 'down' ? 'text-rose-400 bg-rose-500/10' : 'text-text-muted hover:text-slate-300 hover:bg-slate-700/50'}`}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── ExplainProcess modal ─────────────────────────────────────────────────────

function ExplainProcessModal({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const originalIntentLabel = '"Show me degraded sites"';
  const outcomeLabel = '(Traffic Steering App) ...';
  const stepCards = [
    { number: 1, title: 'Naavik Observation & Reasoning Agent', subtitle: 'Observe and Analyze', Icon: Eye },
    { number: 2, title: 'Naavik Recommendation Agent', subtitle: 'Solution Recommendation', Icon: Search },
    { number: 3, title: 'Naavik Control and Network Ops Agent', subtitle: 'Closed Loop Execution', Icon: Zap },
    { number: 4, title: 'Naavik AppGen Agent', subtitle: 'E2E Automation', Icon: Code2 },
  ] as const;

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-3 md:p-4 ${
        isDark ? 'bg-black/62 backdrop-blur-[10px]' : 'bg-slate-900/42 backdrop-blur-[8px]'
      }`}
      onClick={onClose}
    >
      <div
        className={`process-explain-modal relative w-[min(96vw,1860px)] rounded-3xl border overflow-hidden ${
          isDark
            ? 'bg-[#070b14]/95 border-white/10 shadow-[0_30px_80px_rgba(2,6,23,0.78)]'
            : 'bg-white/[0.96] border-border shadow-[0_30px_80px_rgba(15,23,42,0.22)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-4 right-4 rounded-lg p-2 transition ${
            isDark ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-text-muted hover:text-slate-700 hover:bg-slate-100'
          }`}
          aria-label="Close process modal"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="px-8 py-8 md:px-10 md:py-9">
          <h2 className={`text-center text-[2rem] md:text-[2.35rem] font-semibold tracking-tight ${isDark ? 'text-white' : 'text-text-primary'}`}>
            Naavik Module Flow
          </h2>
          <p className={`mt-2 text-center text-base md:text-lg font-medium ${isDark ? 'text-text-muted' : 'text-text-secondary'}`}>
            AI-powered orchestration across the complete operations lifecycle
          </p>

          <div className="relative mt-10">
            <div className={`absolute left-8 right-8 top-[38px] h-[2px] ${isDark ? 'bg-red-400/35' : 'bg-red-500/30'}`} />
            <span className="process-flow-dot" aria-hidden />
            <div className="grid grid-cols-6 gap-3 md:gap-4 items-start">
              <div className="flex flex-col items-center process-step-node">
                <div className={`w-16 h-16 md:w-[72px] md:h-[72px] rounded-full border flex items-center justify-center shadow ${isDark ? 'bg-slate-900/80 border-white/15 text-text-primary' : 'bg-cream-surface-light border-border text-text-secondary'}`}>
                  <MessageCircle className="w-7 h-7 md:w-8 md:h-8" />
                </div>
                <div className={`mt-3 text-xl md:text-2xl font-semibold ${isDark ? 'text-text-primary' : 'text-text-secondary'}`}>Intent</div>
                <div className={`mt-1 text-xs md:text-sm font-medium ${isDark ? 'text-text-muted' : 'text-text-muted'}`}>{originalIntentLabel}</div>
              </div>

              {stepCards.map(({ number, title, subtitle, Icon }, idx) => (
                <div key={number} className="relative process-step-card" style={{ animationDelay: `${idx * 120}ms` }}>
                  <span className="absolute -top-4 left-3 inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-white text-lg font-bold text-white bg-red-500 shadow-lg">
                    {number}
                  </span>
                  <div className={`rounded-2xl border px-4 pt-7 pb-4 min-h-[188px] flex flex-col items-center text-center ${isDark ? 'bg-slate-900/70 border-white/15' : 'bg-cream-bg border-border'}`}>
                    <Icon className={`w-8 h-8 ${isDark ? 'text-red-300' : 'text-red-600'}`} />
                    <h3 className={`mt-3 text-[1rem] md:text-[1.06rem] leading-snug font-semibold ${isDark ? 'text-white' : 'text-text-primary'}`}>{title}</h3>
                    <div className={`mt-2 w-10 h-[2px] ${isDark ? 'bg-white/20' : 'bg-cream-surface-light'}`} />
                    <p className={`mt-2 text-[0.94rem] font-medium ${isDark ? 'text-text-muted' : 'text-text-secondary'}`}>{subtitle}</p>
                  </div>
                </div>
              ))}

              <div className="flex flex-col items-center process-step-node">
                <div className={`w-16 h-16 md:w-[72px] md:h-[72px] rounded-full border flex items-center justify-center shadow ${isDark ? 'bg-emerald-900/30 border-emerald-300/40 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-600'}`}>
                  <CheckCircle className="w-7 h-7 md:w-8 md:h-8" />
                </div>
                <div className={`mt-3 text-xl md:text-2xl font-semibold ${isDark ? 'text-text-primary' : 'text-text-secondary'}`}>Outcome</div>
                <div className={`mt-1 text-xs md:text-sm font-medium ${isDark ? 'text-text-muted' : 'text-text-muted'}`}>{outcomeLabel}</div>
              </div>
            </div>
          </div>

          <p className={`mt-7 text-center text-[0.98rem] md:text-[1.03rem] ${isDark ? 'text-text-muted' : 'text-text-secondary'}`}>
            Each module autonomously executes its specialized function while coordinating with the entire system
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TYPING_SPEED_MS = 4;
const ANIMATE_MAX_LENGTH = 400;

export default function ChatMessageComponent({ message, onActionExecute, onChoiceClick, onRowAction, onOpenSavedDashboard, onOpenQueryDashboard }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const { theme } = useTheme();
  const { hasCompletedAnimation, markAnimationComplete } = useChat();
  const { dText } = useDummifier();
  const isDark = theme === 'dark';
  const [visibleLength, setVisibleLength] = useState(0);
  const [showExplainProcess, setShowExplainProcess] = useState(false);
  const hasCodeViz = message.visualization?.type === 'code' || message.visualization?.type === 'code_view';
  const [codeStreamDone, setCodeStreamDone] = useState(false);
  const onCodeComplete = useCallback(() => setCodeStreamDone(true), []);
  const buttonsDisabled = hasCodeViz && !codeStreamDone;
  const isHistorical = hasCompletedAnimation(message.id);
  const shouldAnimate = !isUser && message.content.length > 20 && message.content.length <= ANIMATE_MAX_LENGTH && !isHistorical;

  useEffect(() => {
    if (!shouldAnimate) {
      setVisibleLength(message.content.length);
      return;
    }
    setVisibleLength(0);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setVisibleLength(i);
      if (i >= message.content.length) {
        clearInterval(interval);
        markAnimationComplete(message.id);
      }
    }, TYPING_SPEED_MS);
    return () => clearInterval(interval);
  }, [message.id, message.content.length, shouldAnimate, markAnimationComplete]);

  const rawContentBase = shouldAnimate ? message.content.slice(0, visibleLength) : message.content;
  const rawContent = dText(rawContentBase);
  const isCursorVisible = shouldAnimate && visibleLength < message.content.length;

  const { agentName, cleanContent } = isUser ? { agentName: null, cleanContent: rawContent } : extractAgentName(rawContent);
  const hasRichMarkdown = !isUser && (cleanContent.includes('\n') || cleanContent.includes('**') || cleanContent.includes('- ') || cleanContent.includes('`'));

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'} animate-slide-in`}>
      {/* Assistant avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-white/10 border border-white/10 shadow-sm mt-1">
          <img src="/aira-logo.png" alt="Aira" className="w-4 h-4 object-contain" />
        </div>
      )}

      <div className={`${isUser ? 'max-w-[min(74vw,860px)] ml-auto' : 'flex-1 min-w-0 group'}`}>
        <div className={`space-y-1.5 ${isUser ? 'text-right' : ''}`}>

          {/* User attachments */}
          {isUser && Array.isArray(message.attachments) && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {message.attachments.map((att, i) => (
                <div
                  key={`${att.name}_${i}`}
                  className="flex items-center gap-2 rounded-full border border-border dark:border-slate-600 bg-white/80 dark:bg-slate-700/50 px-3 py-1 text-xs text-text-secondary dark:text-slate-200 shadow-sm"
                  title={att.name}
                >
                  {att.kind === 'image' ? (
                    <span className="inline-flex items-center gap-1">
                      {att.dataUrl ? <img src={att.dataUrl} alt="" className="w-4 h-4 rounded object-cover" /> : <ImageIcon className="w-4 h-4" />}
                      <span className="max-w-[220px] truncate">{att.name}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      <span className="max-w-[220px] truncate">{att.name}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* User bubble */}
          {isUser && rawContent.trim().length > 0 && (
            <div className="inline-block px-4 py-2.5 rounded-2xl bg-cream-surface-light dark:bg-slate-700/80 text-text-primary dark:text-slate-100 border border-slate-300/60 dark:border-slate-600/60">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{rawContent}</p>
            </div>
          )}

          {/* Agent badge */}
          {!isUser && agentName && (
            <div className="mb-1.5">
              <AgentBadge name={agentName} />
            </div>
          )}

          {/* Assistant text content */}
          {!isUser && cleanContent.trim().length > 0 && !message.visualization && (
            <div className="text-sm leading-relaxed text-text-primary dark:text-slate-200">
              {hasRichMarkdown
                ? <>{renderMarkdown(cleanContent)}{isCursorVisible && <span className="inline-block w-2 h-4 ml-0.5 bg-text-primary animate-pulse align-middle rounded-sm" />}</>
                : <p className="text-sm leading-relaxed">{cleanContent}{isCursorVisible && <span className="inline-block w-2 h-4 ml-0.5 bg-text-primary animate-pulse align-middle rounded-sm" />}</p>
              }
            </div>
          )}

          {/* UI blocks */}
          {!isUser && Array.isArray(message.uiBlocks) && message.uiBlocks.length > 0 && (
            <div className="mt-3">
              <UiBlocksRenderer blocks={message.uiBlocks} />
              {message.uiBlocks.some((b: any) => b.type === 'insight_chart' || b.type === 'data_table' || b.type === 'stat_row') && (
                <QueryDashboardSaveBar blocks={message.uiBlocks} prompt={message.content || undefined} />
              )}
            </div>
          )}

          {/* Explain Process trigger */}
          {!isUser && message.content.includes('rApp packaging complete and ready to deploy') && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowExplainProcess(true)} className="naavik-btn-info">
                Explain Process
              </button>
            </div>
          )}

          {/* Visualizations */}
          {!isUser && message.visualization && (
            <div className="mt-3">
              {message.visualization.type === 'chart' && (
                <InlineChart data={message.visualization.data} {...message.visualization.config} />
              )}
              {(message.visualization.type === 'map' || message.visualization.type === 'map_inset') && (
                <InlineMap sites={message.visualization.data} {...message.visualization.config} />
              )}
              {message.visualization.type === 'table' && (() => {
                const rawRows: any[] = Array.isArray(message.visualization.data) ? message.visualization.data : [];
                const safeRows = rawRows.map((r) => (r as Record<string, any>) ?? {});
                const columns = safeRows.length > 0 ? Object.keys(safeRows[0]) : [];
                const colDefs = columns.map((key) => ({
                  field: key, headerName: key, flex: 1, minWidth: 90,
                  valueFormatter: (p: any) => { const v = p.value; return typeof v === 'number' ? v.toFixed(2) : String(v ?? '-'); },
                }));
                return (
                  <div className="mt-2 rounded-[12px] overflow-hidden border border-gray-700/40">
                    <AgGridWrapper columnDefs={colDefs} rowData={safeRows} height={Math.min(38 * safeRows.length + 36 + 2, 360)} />
                  </div>
                );
              })()}
              {message.visualization.type === 'grid' && (
                <InteractiveGridTable
                  rows={Array.isArray(message.visualization.data?.rows) ? message.visualization.data.rows : []}
                  title={message.visualization.data?.title || 'Grid Results'}
                  showSelection={message.visualization.data?.showSelection !== false}
                  rowTooltipField={message.visualization.data?.rowTooltipField}
                  onRowAction={onRowAction}
                />
              )}
              {message.visualization.type === 'rca_story' && (
                <RcaSiteStoryCard
                  key={`${message.id}-${message.visualization.data?.sourceSite?.siteId}`}
                  data={message.visualization.data}
                  onChoiceClick={onChoiceClick ? (choiceId: string) => onChoiceClick(message.id, choiceId) : undefined}
                />
              )}
              {message.visualization.type === 'ticket_escalation' && (
                <TicketEscalationCard data={message.visualization.data} />
              )}
              {message.visualization.type === 'kpi_dashboard' && (
                <SiteKpiDashboard siteId={message.visualization.data.siteId} />
              )}
              {message.visualization.type === 'chat_kpi_dashboard' && (
                <ChatKpiDashboard
                  siteId={message.visualization.data.siteId}
                  availableSiteIds={message.visualization.data.availableSiteIds}
                  endDate={message.visualization.data.endDate}
                  kpiNames={message.visualization.data.kpiNames}
                  timeframe={message.visualization.data.timeframe ?? 'daily'}
                  daysBack={message.visualization.data.daysBack ?? 14}
                />
              )}
              {message.visualization.type === 'saved_dashboards' && (
                <SavedDashboardsPanel
                  onOpen={(db) => onOpenSavedDashboard?.(db)}
                  onOpenQueryDashboard={(qdb) => onOpenQueryDashboard?.(qdb)}
                  onCreateNew={message.visualization.data?.onCreateNew}
                />
              )}
              {message.visualization.type === 'open_query_dashboard' && Array.isArray(message.visualization.data?.blocks) && (
                <div>
                  <UiBlocksRenderer blocks={message.visualization.data.blocks} />
                  <QueryDashboardSaveBar blocks={message.visualization.data.blocks} prompt={message.visualization.data?.name} />
                </div>
              )}
              {message.visualization.type === 'knowledge_report' && (
                <KnowledgeReportCard
                  question={message.visualization.data.question}
                  answer={message.visualization.data.answer}
                  topic={message.visualization.data.topic}
                />
              )}
              {message.visualization.type === 'insight_chart' && (
                <InsightChartCard data={message.visualization.data} />
              )}
              {(message.visualization.type === 'code' || message.visualization.type === 'code_view') && (
                <StreamingCodeBlock code={message.visualization.data} onComplete={onCodeComplete} />
              )}
            </div>
          )}

          {/* Query Results */}
          {!isUser && message.queryResult && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-text-secondary dark:text-gray-400 bg-cream-bg dark:bg-gray-800 px-3 py-2 rounded-lg">
                <span>
                  {message.queryResult.rowCount} row{message.queryResult.rowCount !== 1 ? 's' : ''}
                  {message.queryResult.executionTime && ` • ${message.queryResult.executionTime}ms`}
                </span>
                <div className="flex gap-2">
                  <button className="flex items-center gap-1 hover:text-sky-400 transition" title="Export CSV">
                    <Download className="w-3 h-3" /> Export
                  </button>
                  <button className="flex items-center gap-1 hover:text-sky-400 transition" title="Visualize">
                    <BarChart3 className="w-3 h-3" /> Visualize
                  </button>
                </div>
              </div>
              {message.queryResult.sql && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-slate-100">View SQL</summary>
                  <pre className="bg-slate-900 text-text-primary p-3 rounded-lg overflow-x-auto mt-2 text-xs"><code>{message.queryResult.sql}</code></pre>
                </details>
              )}
              <div className="overflow-x-auto rounded-lg border border-border dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs">
                  <thead className="bg-cream-bg dark:bg-gray-800">
                    <tr>
                      {message.queryResult.rows.length > 0 && Object.keys(message.queryResult.rows[0]).map(key => (
                        <th key={key} className="px-3 py-2 text-left font-medium text-text-secondary dark:text-gray-400">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-cream-surface dark:bg-slate-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {message.queryResult.rows.slice(0, 10).map((rawRow, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        {Object.values(rawRow as Record<string, any>).map((val: any, cidx) => (
                          <td key={cidx} className="px-3 py-2 text-text-primary dark:text-slate-100">
                            {typeof val === 'number' ? val.toFixed(2) : String(val ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {message.queryResult.rows.length > 10 && (
                  <div className="bg-cream-bg dark:bg-gray-800 px-3 py-2 text-xs text-text-muted">
                    Showing 10 of {message.queryResult.rows.length} rows
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Network health report */}
          {!isUser && message.reportData && typeof message.reportData === 'object' && (message.reportData as any).type === 'network_health' && (
            <NetworkHealthReport data={message.reportData as any} />
          )}

          {/* Choice buttons */}
          {!isUser && Array.isArray(message.choiceButtons) && message.choiceButtons.length > 0 && onChoiceClick && (
            <div className="flex flex-wrap gap-2 mt-4">
              {message.choiceButtons.map((choice) => {
                const isDestructive = choice.label.toLowerCase().includes('cancel') || choice.label.toLowerCase().includes('no action') || choice.label.toLowerCase().includes('no further');
                const isPrimary = choice.label.toLowerCase().includes('implement') || choice.label.toLowerCase().includes('execute') || choice.label.toLowerCase().includes('authorize') || choice.label.toLowerCase().includes('escalate');
                const isNav = choice.choiceId.startsWith('nav_') || choice.label.toLowerCase().includes('open naavik');
                return (
                  <button
                    key={choice.choiceId}
                    onClick={() => onChoiceClick(message.id, choice.choiceId)}
                    disabled={buttonsDisabled}
                    className={`
                      px-4 py-2 rounded-lg font-medium text-sm transition-all duration-150 border
                      ${isDestructive
                        ? 'bg-transparent border-border dark:border-slate-600/60 text-text-muted hover:border-text-muted hover:text-text-secondary hover:bg-cream-surface-light dark:hover:bg-slate-700/30'
                        : isPrimary
                          ? 'bg-text-primary border-text-primary text-cream-surface dark:bg-text-primary dark:border-text-primary dark:text-cream-bg hover:opacity-90 shadow-sm'
                          : isNav
                            ? 'bg-cream-surface-light dark:bg-slate-700/50 border-border dark:border-slate-600/50 text-text-primary hover:bg-cream-surface dark:hover:bg-slate-700 hover:border-text-muted'
                            : 'bg-cream-surface dark:bg-slate-800/60 border-border dark:border-slate-600/50 text-text-primary hover:bg-cream-surface-light dark:hover:bg-slate-700/80'
                      }
                      ${buttonsDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}
                    `}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Action buttons */}
          {!isUser && Array.isArray(message.actionButtons) && message.actionButtons.length > 0 && onActionExecute && (
            <div className="flex flex-wrap gap-3 mt-4">
              {message.actionButtons.map((action, idx) => (
                <ActionButton
                  key={action?.actionId ?? (action as any)?.action_id ?? `action-${idx}`}
                  action={action}
                  onExecute={onActionExecute}
                />
              ))}
            </div>
          )}

          {/* Execution status */}
          {!isUser && message.executionStatus && typeof message.executionStatus === 'object' && (
            <WorkflowExecutionStatus status={message.executionStatus} />
          )}

          {/* Intent badge + timing */}
          {message.intent && !isUser && (
            <div className="flex items-center gap-2 text-xs mt-2">
              <div className="badge-live flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Intent: {message.intent.intent}</span>
              </div>
              <div className="badge-success flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{message.intent.executionTime}ms</span>
              </div>
            </div>
          )}

          {/* Agent workflow */}
          {message.workflow && !isUser && (
            <AgentWorkflowDisplay workflow={message.workflow} />
          )}

          {/* Message actions (copy, feedback) - only for assistant with content */}
          {!isUser && cleanContent.trim().length > 0 && (
            <MessageActions content={message.content} />
          )}

          {/* User timestamp */}
          {isUser && (
            <div className="text-xs text-text-light-muted dark:text-text-muted text-right mt-1">
              {message.timestamp instanceof Date
                ? message.timestamp.toLocaleTimeString()
                : new Date(message.timestamp as string | number).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 bg-cream-surface-light dark:bg-pulse-surface-light border border-cream-border dark:border-pulse-border rounded-lg flex items-center justify-center">
          <User className="w-4 h-4 text-text-light-secondary dark:text-text-secondary" />
        </div>
      )}

      {showExplainProcess && !isUser && (
        <ExplainProcessModal isDark={isDark} onClose={() => setShowExplainProcess(false)} />
      )}
    </div>
  );
}
