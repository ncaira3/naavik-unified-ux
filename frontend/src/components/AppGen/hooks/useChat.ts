import { useState, useEffect, useCallback, useRef } from 'react'
import {
  chatApi,
  createChatWebSocket,
  sendChatMessage,
  sendClarificationResponse,
  ChatWebSocketMessage,
  ClarificationQuestion,
  ClarificationAnswerV2,
  ClarificationResponseV2,
} from '../lib/api'

export type { ClarificationQuestion } from '../lib/api'
export type { ClarificationOption } from '../lib/api'

/** Build a short readable summary of clarification answers for the user bubble and history. */
function buildClarificationSummary(
  answers: ClarificationAnswerV2[],
  questions: ClarificationQuestion[]
): string {
  const questionMap = new Map(questions.map((q) => [q.id, q]))
  const lines: string[] = []
  for (const a of answers) {
    const q = questionMap.get(a.question_id)
    const shortQuestion = (q?.text ?? a.question_id).replace(/\s+/g, ' ').trim()
    const truncated = shortQuestion.length > 60 ? shortQuestion.slice(0, 57) + '…' : shortQuestion
    if (a.skipped) {
      lines.push(`• ${truncated} → Skipped`)
      continue
    }
    const labels: string[] = []
    if (q) {
      const keyToLabel = new Map(q.options.map((o) => [o.key, (o.value || o.key).replace(/\s+/g, ' ').trim()]))
      for (const key of a.selected_option_keys ?? []) {
        const label = keyToLabel.get(key) ?? key
        labels.push(label.length > 80 ? label.slice(0, 77) + '…' : label)
      }
    }
    if ((a.free_text ?? '').trim()) {
      labels.push(`"${(a.free_text ?? '').trim().slice(0, 60)}${(a.free_text ?? '').trim().length > 60 ? '…' : ''}"`)
    }
    lines.push(`• ${truncated} → ${labels.length ? labels.join('; ') : '—'}`)
  }
  return lines.join('\n') || 'Clarification answers submitted.'
}

export interface AgentEvent {
  event_type:
    | 'planning'
    | 'executing'
    | 'tool_start'
    | 'tool_result'
    | 'file_change'
    | 'summary'
    | 'text'
    | 'error'
    | 'clarification_needed'
    | 'waiting_for_user'
    | 'plan_update'
    | 'spec_status'
    | 'approval_required'
    | 'stage_transition'
    | 'stage_complete'
  content: string
  metadata?: Record<string, any>
  timestamp?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  events?: AgentEvent[]  // Events associated with this message
  clarificationQuestions?: ClarificationQuestion[]  // Structured questions for clickable UI
  clarificationId?: string
  agentId?: string
  /** Submitted answers for this clarification (set when user submits so read-only view can show selections). */
  clarificationAnswers?: ClarificationAnswerV2[]
}

const EVENT_CONTENT_LIMIT = 600
const EVENT_OUTPUT_LIMIT = 1600

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated]`
}

function sanitizeEvent(event: AgentEvent): AgentEvent {
  const next: AgentEvent = {
    ...event,
    content:
      typeof event.content === 'string'
        ? truncateText(event.content, EVENT_CONTENT_LIMIT)
        : event.content,
  }

  if (!event.metadata) {
    return next
  }

  const metadata = { ...event.metadata }
  const output = metadata.output
  if (typeof output === 'string' && output.length > EVENT_OUTPUT_LIMIT) {
    metadata.output = truncateText(output, EVENT_OUTPUT_LIMIT)
    metadata.output_truncated = true
    metadata.output_length = Math.max(
      Number(metadata.output_length) || 0,
      output.length
    )
  }

  next.metadata = metadata
  return next
}

interface UseChatOptions {
  sessionId?: string
  agentId?: string
  onResponseComplete?: () => void
  onFileChange?: (event: AgentEvent) => void  // Called when agent modifies files
}

type PendingOutbound =
  | { kind: 'message'; content: string; csvMetadata?: Record<string, any> }
  | { kind: 'clarification'; response: ClarificationResponseV2; summary: string }

export function useChat(options: UseChatOptions = {}) {
  const { sessionId = 'default', agentId = 'planning', onResponseComplete, onFileChange } = options
  const stallThresholdMs = agentId === 'planning' ? 45000 : 15000
  
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStalled, setIsStalled] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentEvents, setCurrentEvents] = useState<AgentEvent[]>([])
  /** Only the clarification we're currently waiting on (this session). Cleared on submit and when loading history. */
  const [pendingClarificationId, setPendingClarificationId] = useState<string | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const pendingOutboundRef = useRef<PendingOutbound | null>(null)
  const hasPendingOutboundRef = useRef(false)
  const currentResponseRef = useRef<string>('')
  const currentEventsRef = useRef<AgentEvent[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const lastProgressAtRef = useRef<number | null>(null)
  const isLoadingRef = useRef(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const isDisposedRef = useRef(false)
  const onResponseCompleteRef = useRef(onResponseComplete)
  const onFileChangeRef = useRef(onFileChange)

  messagesRef.current = messages
  isLoadingRef.current = isLoading

  useEffect(() => {
    onResponseCompleteRef.current = onResponseComplete
    onFileChangeRef.current = onFileChange
  }, [onResponseComplete, onFileChange])

  const markProgress = useCallback(() => {
    lastProgressAtRef.current = Date.now()
    setIsStalled(false)
  }, [])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback((callback: () => void, delayMs: number) => {
    clearReconnectTimer()
    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null
      if (!isDisposedRef.current) {
        callback()
      }
    }, delayMs)
  }, [clearReconnectTimer])

  const interruptActiveRun = useCallback((message: string) => {
    isLoadingRef.current = false
    const partialContent = currentResponseRef.current.trim()
    const interruptedEvents: AgentEvent[] = [
      ...currentEventsRef.current,
      { event_type: 'error', content: message },
    ]

    setMessages(prev => {
      const next = prev.map(m => ({ ...m }))
      const lastMessage = next[next.length - 1]

      if (lastMessage?.role === 'assistant') {
        lastMessage.content = partialContent
          ? `${partialContent}\n\n_${message}_`
          : `❌ ${message}`
        lastMessage.events = interruptedEvents
      } else {
        next.push({
          role: 'assistant',
          content: partialContent
            ? `${partialContent}\n\n_${message}_`
            : `❌ ${message}`,
          events: interruptedEvents,
        })
      }

      return next
    })

    currentResponseRef.current = ''
    currentEventsRef.current = []
    setCurrentEvents([])
    setIsLoading(false)
    setIsStalled(false)
    lastProgressAtRef.current = null
  }, [])

  const connect = useCallback(() => {
    if (isDisposedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    const ws = createChatWebSocket(
      sessionId,
      agentId,
      (data: ChatWebSocketMessage) => {
        switch (data.type) {
          case 'chunk': {
            markProgress()
            const chunkText = data.content || ''
            currentResponseRef.current += chunkText

            // Track text in events array for chronological interleaving with tool events
            if (chunkText) {
              const evts = currentEventsRef.current
              const lastEvt = evts[evts.length - 1]
              if (lastEvt?.event_type === 'text') {
                // Extend the current text event (merge consecutive chunks)
                currentEventsRef.current = [
                  ...evts.slice(0, -1),
                  { ...lastEvt, content: lastEvt.content + chunkText },
                ]
              } else {
                // Start a new text event (after tool events or at the beginning)
                currentEventsRef.current = [
                  ...evts,
                  { event_type: 'text' as const, content: chunkText },
                ]
              }
            }

            // Use functional update to avoid stale closure issues
            setMessages(prev => {
              const newMessages = prev.map(m => ({ ...m }))
              const lastMessage = newMessages[newMessages.length - 1]
              if (lastMessage?.role === 'assistant') {
                lastMessage.content = currentResponseRef.current
                lastMessage.events = [...currentEventsRef.current]
              } else {
                newMessages.push({
                  role: 'assistant',
                  content: currentResponseRef.current,
                  events: [...currentEventsRef.current],
                  agentId,
                })
              }
              return newMessages
            })
            break
          }
          
          case 'clarification': {
            markProgress()
            // Structured clarification questions with clickable options
            const questions = (data.questions || []) as ClarificationQuestion[]
            const clarificationId = data.clarification_id || ''
            setPendingClarificationId(clarificationId || null)
            const markdown = data.content || ''
            currentResponseRef.current += markdown

            // Also add a clarification_needed event to the timeline
            const clarEvent: AgentEvent = {
              event_type: 'clarification_needed',
              content: `${questions.length} question${questions.length !== 1 ? 's' : ''} for you`,
            }
            currentEventsRef.current = [...currentEventsRef.current, clarEvent]
            setCurrentEvents([...currentEventsRef.current])

            setMessages(prev => {
              const newMessages = prev.map(m => ({ ...m }))
              const lastMessage = newMessages[newMessages.length - 1]
              if (lastMessage?.role === 'assistant') {
                lastMessage.content = currentResponseRef.current
                lastMessage.events = [...currentEventsRef.current]
                lastMessage.clarificationQuestions = questions
                lastMessage.clarificationId = clarificationId
              } else {
                newMessages.push({
                  role: 'assistant',
                  content: currentResponseRef.current,
                  events: [...currentEventsRef.current],
                  clarificationQuestions: questions,
                  clarificationId,
                  agentId,
                })
              }
              return newMessages
            })
            break
          }

          case 'event': {
            markProgress()
            const event = sanitizeEvent(data.event as AgentEvent)
            if (event) {
              // Stage transition events become system messages (markers)
              if (event.event_type === 'stage_transition') {
                const stage = event.metadata?.stage || ''
                setMessages(prev => [...prev, {
                  role: 'system' as const,
                  content: `stage_transition:${stage}`,
                }])
                break
              }

              // Stage complete events become system messages (proceed buttons)
              if (event.event_type === 'stage_complete') {
                const nextStage = event.metadata?.next_stage || ''
                const summary = event.metadata?.summary || event.content || ''
                setMessages(prev => [...prev, {
                  role: 'system' as const,
                  content: `stage_complete:${nextStage}:${summary}`,
                  events: [event],
                }])
                break
              }

              currentEventsRef.current = [...currentEventsRef.current, event]
              setCurrentEvents([...currentEventsRef.current])

              // Update the message with new events (shallow-clone for React detection)
              setMessages(prev => {
                const newMessages = prev.map(m => ({ ...m }))
                const lastMessage = newMessages[newMessages.length - 1]
                if (lastMessage?.role === 'assistant') {
                  lastMessage.events = [...currentEventsRef.current]
                } else {
                  newMessages.push({
                    role: 'assistant',
                    content: currentResponseRef.current,
                    events: [...currentEventsRef.current],
                    agentId,
                  })
                }
                return newMessages
              })

              // Trigger file change callback for real-time updates
              if (event.event_type === 'file_change' && onFileChangeRef.current) {
                onFileChangeRef.current(event)
              }
            }
            break
          }
          
          case 'complete': {
            markProgress()
            // Snapshot refs into local variables BEFORE clearing them.
            // setMessages's functional updater runs asynchronously (during
            // React's next render), so if we clear the refs first the
            // updater would read empty arrays.
            const finalContent = currentResponseRef.current
            const finalEvents = [...currentEventsRef.current]

            setMessages(prev => {
              const newMessages = prev.map(m => ({ ...m }))
              const lastMessage = newMessages[newMessages.length - 1]
              const hasFinalPayload =
                finalContent.trim().length > 0 || finalEvents.length > 0
              const isSameAgentMessage =
                lastMessage?.role === 'assistant' &&
                (!lastMessage.agentId || lastMessage.agentId === agentId)
              if (hasFinalPayload && isSameAgentMessage && lastMessage?.role === 'assistant') {
                lastMessage.content = finalContent
                lastMessage.events = finalEvents
              }
              return newMessages
            })

            // Now safe to clear refs
            currentResponseRef.current = ''
            currentEventsRef.current = []
            setCurrentEvents([])
            setIsLoading(false)
            isLoadingRef.current = false
            setIsStalled(false)
            lastProgressAtRef.current = null
            if (onResponseCompleteRef.current) {
              onResponseCompleteRef.current()
            }
            break
          }
          
          case 'error': {
            markProgress()
            const errorMsg = data.content || 'Unknown error'
            // Snapshot refs before clearing (same race-condition fix as 'complete')
            const errContent = currentResponseRef.current
            const errEvents: AgentEvent[] = [
              ...currentEventsRef.current,
              { event_type: 'error', content: errorMsg },
            ]

            setError(errorMsg)
            setIsLoading(false)
            isLoadingRef.current = false
            // Also add error as assistant message so it shows in chat
            setMessages(prev => {
              const newMessages = prev.map(m => ({ ...m }))
              const lastMessage = newMessages[newMessages.length - 1]
              if (lastMessage?.role === 'assistant') {
                lastMessage.content = errContent || `❌ Error: ${errorMsg}`
                lastMessage.events = errEvents
              } else {
                newMessages.push({
                  role: 'assistant',
                  content: `❌ Error: ${errorMsg}`,
                  events: errEvents,
                })
              }
              return newMessages
            })
            currentResponseRef.current = ''
            currentEventsRef.current = []
            setCurrentEvents([])
            setIsStalled(false)
            lastProgressAtRef.current = null
            break
          }
          
          case 'pong':
            break
        }
      },
      () => {
        setIsConnected(false)
        setError('Connection error')
        if (isLoadingRef.current && !hasPendingOutboundRef.current) {
          interruptActiveRun('Connection interrupted. The current run was stopped.')
        }
      },
      () => {
        setIsConnected(false)
        wsRef.current = null
        if (isLoadingRef.current && !hasPendingOutboundRef.current) {
          setError('Connection lost. The current run was interrupted.')
          interruptActiveRun('Connection lost. The current run was interrupted.')
        }
        if (!isDisposedRef.current) {
          scheduleReconnect(connect, 2000)
        }
      }
    )

    ws.onopen = () => {
      setIsConnected(true)
      setError(null)
      const pending = pendingOutboundRef.current
      if (pending) {
        if (pending.kind === 'message') {
          sendChatMessage(ws, pending.content, agentId, pending.csvMetadata)
        } else {
          sendClarificationResponse(ws, pending.response, pending.summary, agentId)
        }
        pendingOutboundRef.current = null
        hasPendingOutboundRef.current = false
      }
    }

    wsRef.current = ws
  }, [sessionId, agentId, interruptActiveRun, markProgress, scheduleReconnect])

  const loadHistory = useCallback(async () => {
    setPendingClarificationId(null)
    try {
      const result = await chatApi.getHistory(sessionId)
      const mapped = result.messages.map((msg) => {
        const meta = (msg.metadata || {}) as Record<string, any>
        const clarification = (meta.clarification || {}) as Record<string, any>
        const role = msg.role as 'user' | 'assistant'
        const clarificationResponse = role === 'user' ? (meta.clarification_response as { answers?: ClarificationAnswerV2[] } | undefined) : undefined
        return {
          role,
          content: msg.content,
          events: ((meta.events || []) as AgentEvent[]).map(sanitizeEvent),
          agentId: (meta.agent_id || undefined) as string | undefined,
          clarificationQuestions: (clarification.questions || meta.clarificationQuestions || undefined) as ClarificationQuestion[] | undefined,
          clarificationId: (clarification.clarification_id || undefined) as string | undefined,
          clarificationAnswers: undefined as ClarificationAnswerV2[] | undefined,
          _agentId: (meta.agent_id || '') as string,
          _clarificationResponse: clarificationResponse,
        }
      }) as (Omit<ChatMessage, 'clarificationAnswers'> & { clarificationAnswers?: ClarificationAnswerV2[]; _agentId?: string; _clarificationResponse?: { answers?: ClarificationAnswerV2[] } })[]

      // After reload: user messages for clarification have answers in metadata. Attach to previous assistant
      // so the card shows selections; if content is still the placeholder, derive summary for the bubble.
      for (let i = 0; i < mapped.length; i++) {
        const m = mapped[i]
        if (m.role !== 'user' || !m._clarificationResponse?.answers) continue
        const prev = mapped[i - 1]
        if (!prev || prev.role !== 'assistant' || !prev.clarificationQuestions?.length) continue
        const answers = m._clarificationResponse.answers as ClarificationAnswerV2[]
        prev.clarificationAnswers = answers
        if (m.content === '[clarification_response]') {
          m.content = buildClarificationSummary(answers, prev.clarificationQuestions)
        }
        delete (m as Record<string, unknown>)._clarificationResponse
      }
      const final = mapped.map(({ _clarificationResponse: _, _agentId: __, ...rest }) => rest) as ChatMessage[]
      setMessages(final)
      // If the last message is an assistant clarification with no follow-up, treat it as still pending so the user can submit after reload
      const last = final[final.length - 1]
      const lastAgentId = (mapped[mapped.length - 1] as { _agentId?: string } | undefined)?._agentId || ''
      if (
        last?.role === 'assistant' &&
        last.clarificationId &&
        (last.clarificationQuestions?.length ?? 0) > 0 &&
        lastAgentId === agentId
      ) {
        setPendingClarificationId(last.clarificationId)
      }
    } catch {
      // history load failed — non-blocking
    }
  }, [sessionId])

  const sendMessage = useCallback((content: string, csvMetadata?: Record<string, any>, displayOverride?: string) => {
    if ((!content.trim() && !csvMetadata) || isLoading) return

    let displayContent = displayOverride ?? content.trim()
    if (csvMetadata) {
      const csvLabel = `📎 ${(csvMetadata as any).filename ?? 'CSV file'}`
      displayContent = displayContent ? `${displayContent}\n\n${csvLabel}` : csvLabel
    }
    setMessages(prev => [...prev, { role: 'user', content: displayContent, events: [] }])
    setIsLoading(true)
    isLoadingRef.current = true
    markProgress()
    setError(null)
    currentResponseRef.current = ''
    currentEventsRef.current = []
    setCurrentEvents([])

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendChatMessage(wsRef.current, content, agentId, csvMetadata)
    } else {
      pendingOutboundRef.current = { kind: 'message', content, csvMetadata }
      hasPendingOutboundRef.current = true
      connect()
    }
  }, [agentId, isLoading, markProgress])

  const sendClarificationAnswers = useCallback((response: ClarificationResponseV2) => {
    if (isLoading) return
    setPendingClarificationId(null)
    const prev = messagesRef.current
    let lastAssistantIdx = -1
    for (let i = prev.length - 1; i >= 0; i--) {
      if (prev[i].role === 'assistant') {
        lastAssistantIdx = i
        break
      }
    }
    const questions = lastAssistantIdx >= 0 ? prev[lastAssistantIdx].clarificationQuestions : undefined
    const summary = buildClarificationSummary(response.answers, questions ?? [])

    setMessages(prevMsgs => {
      const next = prevMsgs.map(m => ({ ...m }))
      if (lastAssistantIdx >= 0 && next[lastAssistantIdx].clarificationId != null) {
        next[lastAssistantIdx] = {
          ...next[lastAssistantIdx],
          clarificationAnswers: response.answers,
        }
      }
      return [
        ...next,
        {
          role: 'user',
          content: summary,
          events: [],
        },
      ]
    })
    setIsLoading(true)
    isLoadingRef.current = true
    markProgress()
    setError(null)
    currentResponseRef.current = ''
    currentEventsRef.current = []
    setCurrentEvents([])

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendClarificationResponse(wsRef.current, response, summary, agentId)
    } else {
      pendingOutboundRef.current = { kind: 'clarification', response, summary }
      hasPendingOutboundRef.current = true
      connect()
    }
  }, [agentId, isLoading, markProgress])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const cancelRequest = useCallback(() => {
    if (!isLoading) return

    const finalContent = currentResponseRef.current
    const finalEvents = [...currentEventsRef.current]

    if (finalContent) {
      setMessages(prev => {
        const newMessages = prev.map(m => ({ ...m }))
        const lastMessage = newMessages[newMessages.length - 1]
        if (lastMessage?.role === 'assistant') {
          lastMessage.content = finalContent + '\n\n_[Cancelled]_'
          lastMessage.events = finalEvents
        }
        return newMessages
      })
    }

    currentResponseRef.current = ''
    currentEventsRef.current = []
    setCurrentEvents([])
    setIsLoading(false)
    isLoadingRef.current = false
    setIsStalled(false)
    lastProgressAtRef.current = null

    // Close and reconnect to abort the backend stream
    wsRef.current?.close()
    wsRef.current = null
    scheduleReconnect(connect, 300)

    // Add the "what should Naavik do instead?" prompt message
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: 'Current run stopped. You can continue from the draft or retry with a narrower request.',
        events: [],
      },
    ])
  }, [isLoading, connect, scheduleReconnect])

  const clearHistory = useCallback(async () => {
    try {
      await chatApi.clearHistory(sessionId)
      setMessages([])
    } catch {
      // clear failed — non-blocking
    }
  }, [sessionId])

  // Load persisted history once per session (not on agent/stage switch).
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Keep websocket aligned with the active agent. Reconnect on agent change.
  useEffect(() => {
    isDisposedRef.current = false
    connect()
    return () => {
      isDisposedRef.current = true
      clearReconnectTimer()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect, clearReconnectTimer])

  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!isLoading) {
      setIsStalled(false)
      return
    }

    const interval = setInterval(() => {
      const lastProgressAt = lastProgressAtRef.current
      if (!lastProgressAt) return
      const stalled = Date.now() - lastProgressAt > stallThresholdMs
      setIsStalled(stalled)
    }, 1000)

    return () => clearInterval(interval)
  }, [isLoading, stallThresholdMs])

  return {
    messages,
    isLoading,
    isStalled,
    isConnected,
    error,
    currentEvents,
    pendingClarificationId,
    sendMessage,
    sendClarificationAnswers,
    cancelRequest,
    clearHistory,
    clearError,
  }
}
