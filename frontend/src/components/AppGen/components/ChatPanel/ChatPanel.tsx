import { useState, useRef, useEffect } from 'react'
import {
  ArrowUp,
  Square,
  Bot,
  ChevronDown,
  ChevronsDown,
  Loader2,
  AlertCircle,
  FileText,
  Plus,
} from 'lucide-react'
import type { ChatMessage, AgentEvent } from '../../hooks/useChat'
import type { ClarificationResponseV2 } from '../../lib/api'
import { csvApi } from '../../lib/csvApi'
import type { CsvSchemaMetadata } from '../../lib/csvApi'
import { AGENT_MODES } from './constants'
import { StageMarker } from './StageMarker'
import { AuditActionCard } from './AuditActionCard'
import { ClarificationCard } from './ClarificationCard'
import { AgentActivity } from './AgentActivity'
import { MarkdownBlock } from './MarkdownBlock'
import { CsvChip } from './CsvChip'
import styles from './ChatPanel.module.css'

const STAGE_INPUT_PLACEHOLDERS: Record<string, string> = {
  planning: 'Describe the RF intent, target workflow, KPIs, or telecom scenario you want to build...',
  code_generation: 'Ask for scaffold changes, implementation details, or domain-specific logic updates...',
  coding: 'Request direct code edits, explain a file, or ask for a focused implementation change...',
  code_audit: 'Ask to inspect findings, apply safe fixes, or explain a reported issue...',
  testing: 'Request new tests, investigate failures, rerun scenario checks, or improve coverage for a workflow...',
  app_assembly: 'Ask about packaging, runtime config, preview readiness, or delivery artifacts...',
}

type MessageSegment =
  | { type: 'activity'; events: AgentEvent[] }
  | { type: 'text'; content: string }

/** Walk the events array and group into chronological segments for rendering. */
function deriveMessageSegments(events: AgentEvent[], fallbackContent: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let hasTextEvents = false

  for (const event of events) {
    if (event.event_type === 'text') {
      hasTextEvents = true
      const last = segments[segments.length - 1]
      if (last?.type === 'text') {
        last.content += event.content
      } else {
        segments.push({ type: 'text', content: event.content })
      }
    } else {
      const last = segments[segments.length - 1]
      if (last?.type === 'activity') {
        last.events.push(event)
      } else {
        segments.push({ type: 'activity', events: [event] })
      }
    }
  }

  // Backward compat: historical messages without text events use message.content
  if (!hasTextEvents && fallbackContent.trim()) {
    segments.push({ type: 'text', content: fallbackContent })
  }

  return segments
}

export interface ChatPanelProps {
  messages: ChatMessage[]
  isLoading: boolean
  isStalled?: boolean
  currentEvents: AgentEvent[]
  pendingClarificationId?: string | null
  agentId: string
  isConnected: boolean
  error: string | null
  availableAgents?: ReadonlyArray<{ id: string; label: string }>
  completedStages?: string[]
  stageBadges?: Record<string, string | undefined>
  sessionId: string
  onAgentChange: (agentId: string) => void
  onSendMessage: (message: string, csvMetadata?: Record<string, any>) => void
  onSendClarification: (response: ClarificationResponseV2) => void
  onCancel?: () => void
  /** Called when user dismisses an error (e.g. from the plan-required modal). Use to clear error state. */
  onDismissError?: () => void
}

export function ChatPanel({
  messages,
  isLoading,
  currentEvents,
  pendingClarificationId = null,
  agentId,
  isConnected,
  error,
  availableAgents = AGENT_MODES,
  completedStages = [],
  stageBadges = {},
  sessionId,
  onAgentChange,
  onSendMessage,
  onSendClarification,
  onCancel,
  onDismissError,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [csvAttachment, setCsvAttachment] = useState<CsvSchemaMetadata | null>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isPlanNotApprovedError =
    !!error && /plan\s*(is\s*)?not\s*approv|not\s*approv.*plan/i.test(error)
  const isStageBlockedError =
    !!error &&
    /cannot run .* yet|required previous stages are not completed|must be completed first|no generated source code is present/i.test(error)
  const isActionRequiredError = isPlanNotApprovedError || isStageBlockedError

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom(messages.length <= 1 ? 'auto' : 'smooth')
    }
    setShowScrollToLatest(!shouldAutoScrollRef.current)
  }, [messages, currentEvents])

  const handleMessagesScroll = () => {
    const node = scrollContainerRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom < 120
    setShowScrollToLatest(distanceFromBottom >= 120)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((input.trim() || csvAttachment) && !isLoading) {
      onSendMessage(input.trim(), csvAttachment ?? undefined)
      setInput('')
      setCsvAttachment(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleCsvSelect = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) return
    setCsvUploading(true)
    setCsvError(null)
    try {
      const metadata = await csvApi.upload(sessionId, file)
      setCsvAttachment(metadata)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CSV upload failed'
      setCsvError(message)
    } finally {
      setCsvUploading(false)
    }
  }

  const handleCsvRemove = async () => {
    try {
      await csvApi.remove(sessionId)
    } catch { /* ignore */ }
    setCsvAttachment(null)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleCsvSelect(file)
    // Reset input so re-selecting same file works
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (agentId === 'planning') setIsDragOver(true)
  }
  const handleDragLeave = () => setIsDragOver(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (agentId !== 'planning') return
    const file = e.dataTransfer.files[0]
    if (file) handleCsvSelect(file)
  }

  // No auto-load — CSV chip only appears after user uploads in this session.
  // The CSV metadata travels with the message it was sent with.

  const inputPlaceholder = STAGE_INPUT_PLACEHOLDERS[agentId] ?? 'Ask AppGen to continue...'

  return (
    <div className="relative h-full flex flex-col bg-bg-secondary">
      {/* Header */}
      <header className={`h-12 flex items-center justify-between px-4 shrink-0 ${styles.header}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${styles.avatarAssistant}`}>
            <Bot className="w-4 h-4" strokeWidth={1.8} />
          </div>
          <span className="text-sm font-semibold text-text-primary">
            AI Assistant
          </span>
        </div>
        <div
          className={`${styles.connectionPill} ${
            isConnected ? styles.connected : styles.disconnected
          }`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      {/* Error banner (only for non-action-required errors) */}
      {error && !isActionRequiredError && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl shadow-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-800">Error</p>
              <p className="text-xs text-red-700 mt-1 font-mono whitespace-pre-wrap break-words">
                {error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CSV upload error banner */}
      {csvError && (
        <div className="mx-4 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl shadow-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-800">CSV Upload Failed</p>
              <p className="text-xs text-amber-700 mt-1 whitespace-pre-wrap break-words">
                {csvError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCsvError(null)}
              className="text-amber-500 hover:text-amber-700 transition-colors flex-shrink-0"
              aria-label="Dismiss CSV error"
            >
              <span className="text-xs font-medium">Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Action Required modal */}
      {isActionRequiredError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => onDismissError?.()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-required-title"
        >
          <div
            className="bg-cream-surface rounded-xl shadow-lg border border-border max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="action-required-title"
                  className="text-lg font-semibold text-text-primary"
                >
                  Action required
                </h2>
                <p className="text-sm text-text-secondary mt-2">
                  {isPlanNotApprovedError
                    ? 'Plan not accepted yet. Please accept the plan to move forward.'
                    : error}
                </p>
                <div className="mt-5 flex justify-end">
                  {isPlanNotApprovedError ? (
                    <button
                      type="button"
                      onClick={() => {
                        onAgentChange('planning')
                        onDismissError?.()
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ui-btn text-ui-btn-fg text-sm font-medium hover:bg-ui-btn-hover transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      Go to Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDismissError?.()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ui-btn text-ui-btn-fg text-sm font-medium hover:bg-ui-btn-hover transition-colors"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
      >
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div
              className={`w-14 h-14 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-5 ${styles.emptyStateIcon}`}
            >
              <Bot className="w-7 h-7 text-text-secondary" />
            </div>
            <p className="text-lg font-semibold text-text-primary mb-1">
              Welcome to AppGen
            </p>
            <p className="text-sm text-text-secondary mb-6 max-w-xs">
              Describe the telecom intent, workflow, or app you want to build and the pipeline will guide it to code.
            </p>
            <div className="text-left max-w-sm w-full bg-cream-surface border border-border rounded-xl p-4 shadow-sm">
              <p className="text-xs font-medium text-text-secondary mb-2">
                Try asking:
              </p>
              <ul className="text-sm text-text-primary space-y-1.5">
                <li>• &quot;Plan an RF optimization app to detect overloaded LTE sectors&quot;</li>
                <li>• &quot;Explain PCI collision in telecom and how we can model it&quot;</li>
                <li>• &quot;Generate a FastAPI app for 5G KPI threshold validation&quot;</li>
              </ul>
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          if (message.role === 'system') {
            const stageTransitionEvent = message.events?.find((e) => e.event_type === 'stage_transition')
            if (stageTransitionEvent) {
              const stage = String(stageTransitionEvent.metadata?.stage || '').trim()
              if (stage) return <StageMarker key={`stage-${index}`} stage={stage} />
            }
            if (message.content.startsWith('stage_transition:')) {
              const stage = message.content.replace('stage_transition:', '')
              return <StageMarker key={`stage-${index}`} stage={stage} />
            }

            const stageCompleteEvent = message.events?.find((e) => e.event_type === 'stage_complete')
            if (stageCompleteEvent) return null
            if (message.content.startsWith('stage_complete:')) return null
            if (message.content.toLowerCase().startsWith('stage complete:')) return null
          }

          const isLastAssistant =
            index === messages.length - 1 && message.role === 'assistant'
          const isLiveMessage = isLoading && isLastAssistant

          // Derive chronological segments for assistant messages
          const segments = message.role === 'assistant'
            ? deriveMessageSegments(
                message.events ?? [],
                message.clarificationQuestions?.length ? '' : message.content
              )
            : []
          const isClarificationPending = !!(
            message.clarificationId &&
            message.clarificationId === pendingClarificationId &&
            !(message.clarificationAnswers?.length)
          )

          return (
            <div
              key={index}
              className={`flex min-w-0 ${styles.message} ${
                message.role === 'user' ? 'justify-end' : ''
              }`}
            >
              <div
                className={`min-w-0 max-w-[85%] ${
                  message.role === 'user'
                    ? styles.userBubble
                    : `text-text-primary ${styles.assistantBubble}`
                }`}
              >
                {message.role === 'assistant' ? (
                  <div className={styles.chatMessageContent}>
                    {segments.map((segment, segIdx) => {
                      if (segment.type === 'activity') {
                        return (
                          <AgentActivity
                            key={`seg-${segIdx}`}
                            events={segment.events}
                            isLive={isLiveMessage && segIdx === segments.length - 1}
                            clarificationPending={
                              isClarificationPending &&
                              segment.events.some(e => e.event_type === 'clarification_needed')
                            }
                          />
                        )
                      }
                      return (
                        <div key={`seg-${segIdx}`} className="max-w-none">
                          <MarkdownBlock content={segment.content} />
                        </div>
                      )
                    })}
                    {message.clarificationQuestions &&
                      message.clarificationQuestions.length > 0 && (
                        <ClarificationCard
                          clarificationId={message.clarificationId ?? ''}
                          questions={message.clarificationQuestions}
                          submittedAnswers={message.clarificationAnswers}
                          onSubmit={onSendClarification}
                          isActive={
                            (message.clarificationId ?? '') === (pendingClarificationId ?? '') &&
                            !isLoading
                          }
                          disabled={isLoading}
                        />
                      )}
                    {!isLiveMessage &&
                      message.events?.some(
                        (e) =>
                          e.metadata?.blocking_findings && e.metadata?.allow_fix
                      ) && (
                        <AuditActionCard
                          summary={
                            message.events?.find(
                              (e) => e.metadata?.blocking_findings
                            )?.content ?? 'Audit found issues that need review.'
                          }
                          onSendMessage={onSendMessage}
                        />
                      )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </p>
                )}
              </div>
            </div>
          )
        })}

        {isLoading &&
          (messages.length === 0 ||
            messages[messages.length - 1].role !== 'assistant') && (
            <div className={`flex ${styles.message}`}>
              <div className={`max-w-[85%] text-text-primary ${styles.assistantBubble}`}>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Thinking…</span>
                </div>
              </div>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {showScrollToLatest && (
        <div className="pointer-events-none absolute bottom-36 left-1/2 z-20 -translate-x-1/2">
          <button
            type="button"
            onClick={() => {
              shouldAutoScrollRef.current = true
              setShowScrollToLatest(false)
              scrollToBottom('smooth')
            }}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-white/95 px-4 py-2 text-xs font-medium text-text-secondary shadow-aira backdrop-blur-sm transition-colors hover:bg-white"
          >
            <ChevronsDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="relative px-4 pb-4 pt-2 shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInputChange}
          className="hidden"
          aria-label="Upload CSV file"
        />
        <div
          className={`chat-input-box relative rounded-2xl overflow-hidden ${isDragOver ? 'ring-2 ring-blue-400' : ''} ${styles.inputWrap}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            className="w-full bg-transparent px-4 pt-3 pb-1 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none min-h-[2.5rem]"
            rows={2}
            disabled={isLoading}
            aria-label="Chat message"
          />
          {csvAttachment && (
            <div className="px-4 py-1.5">
              <CsvChip
                filename={csvAttachment.filename}
                columnCount={csvAttachment.runtime_column_count}
                onRemove={handleCsvRemove}
                disabled={isLoading}
              />
            </div>
          )}
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-2">
              {agentId === 'planning' && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || csvUploading}
                  className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-bg-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-text-secondary"
                  title="Attach CSV file"
                  aria-label="Attach CSV file"
                >
                  {csvUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </button>
              )}
              <div className="relative">
                <select
                  value={agentId}
                  onChange={(e) => onAgentChange(e.target.value)}
                  disabled={isLoading}
                  className="appearance-none pl-3 pr-8 py-1.5 rounded-full border border-border bg-cream-surface text-xs font-medium text-text-primary hover:bg-bg-tertiary focus:outline-none focus:ring-2 focus:ring-border focus:ring-offset-1 disabled:opacity-50 cursor-pointer"
                  aria-label="Agent / stage"
                >
                  {availableAgents.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {`${completedStages.includes(mode.id) ? '\u2713 ' : ''}${mode.label}${stageBadges[mode.id] ? ` (${stageBadges[mode.id]})` : ''}`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-text-secondary pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {isLoading ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-9 h-9 rounded-full bg-ui-btn flex items-center justify-center hover:bg-ui-btn-hover transition-colors text-ui-btn-fg shadow-sm"
                  title="Stop"
                  aria-label="Stop generation"
                >
                  <Square className="w-3.5 h-3.5" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!(input.trim() || csvAttachment)}
                  className="w-9 h-9 rounded-full bg-ui-btn flex items-center justify-center hover:bg-ui-btn-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-ui-btn-fg shadow-sm"
                  title="Send"
                  aria-label="Send message"
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
