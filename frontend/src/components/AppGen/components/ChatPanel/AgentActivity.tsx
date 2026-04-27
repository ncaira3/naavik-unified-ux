import { useState, useEffect } from 'react'
import {
  Loader2,
  HelpCircle,
  CheckCircle,
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { AgentEvent } from '../../hooks/useChat'
import { AgentStep } from './AgentStep'
import styles from './ChatPanel.module.css'

/** Short label for the minimal "current step" line when live and collapsed. */
function getCurrentStepLabel(event: AgentEvent): string {
  switch (event.event_type) {
    case 'planning':
      return 'Planning…'
    case 'executing':
      return event.metadata?.summary ?? 'Executing…'
    case 'tool_start': {
      const tool = event.metadata?.tool ?? 'Tool'
      const path = event.metadata?.path
      return path ? `${tool} → ${path}` : `Running ${tool}…`
    }
    case 'tool_result': {
      const ok = event.metadata?.success !== false
      const tool = event.metadata?.tool ?? 'Tool'
      return `${tool} ${ok ? '✓' : '✗'}`
    }
    case 'file_change':
      return 'File changed'
    case 'summary':
      return 'Complete'
    case 'clarification_needed':
      return 'Clarification needed'
    case 'error':
      return 'Error'
    default:
      return 'Working…'
  }
}

interface AgentActivityProps {
  events: AgentEvent[]
  isLive?: boolean
  /** When true, this message's clarification is still awaiting user answer. When false or unset, treat as answered / not applicable. */
  clarificationPending?: boolean
}

export function AgentActivity({
  events,
  isLive = false,
  clarificationPending = false,
}: AgentActivityProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (!isLive) setIsExpanded(false)
  }, [isLive])

  if (!events?.length) return null

  const stepCount = events.length
  const hasErrors = events.some((e) => e.event_type === 'error')
  const hasClarification = events.some((e) => e.event_type === 'clarification_needed')
  const waitingForAnswer = hasClarification && clarificationPending
  const isComplete = events.some((e) => e.event_type === 'summary')
  const toolCount = events.filter((e) => e.event_type === 'tool_start').length
  const lastEvent = events[events.length - 1]
  const currentStepLabel = isLive ? getCurrentStepLabel(lastEvent) : null

  const cardClass = [
    styles.activityCard,
    isLive && styles.activityCardLive + ' ' + styles.live,
    waitingForAnswer && !isLive && styles.activityCardClarification,
    hasErrors && !isLive && styles.activityCardError,
    isComplete && !waitingForAnswer && !hasErrors && !isLive && styles.activityCardComplete,
  ]
    .filter(Boolean)
    .join(' ')

  const StatusIcon = isLive
    ? Loader2
    : hasClarification
      ? HelpCircle
      : isComplete
        ? CheckCircle
        : hasErrors
          ? AlertCircle
          : Bot

  const iconClass = [
    styles.activityTriggerIcon,
    isLive && styles.activityTriggerIconLive,
    waitingForAnswer && !isLive && styles.activityTriggerIconClarification,
    isComplete && !isLive && styles.activityTriggerIconComplete,
    hasErrors && !isLive && styles.activityTriggerIconError,
    !isLive && !waitingForAnswer && !isComplete && !hasErrors && styles.activityTriggerIconDefault,
  ]
    .filter(Boolean)
    .join(' ')

  const statusLabel = isLive
    ? 'Working…'
    : waitingForAnswer
      ? 'Waiting for your answer…'
      : 'Agent activity'

  const metaText =
    stepCount === 1
      ? '1 step'
      : `${stepCount} steps` + (toolCount > 0 ? ` · ${toolCount} tool ${toolCount === 1 ? 'call' : 'calls'}` : '')

  return (
    <div className={cardClass}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={styles.activityTrigger}
      >
        <span className={iconClass}>
          {isLive ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <StatusIcon className="w-4 h-4" />
          )}
        </span>
        <span className={styles.activityTriggerLabel}>{statusLabel}</span>
        <span className={styles.activityTriggerMeta}>{metaText}</span>
        {isLive && currentStepLabel && !isExpanded && (
          <span className={styles.activityCurrentStep} title={currentStepLabel}>
            · {currentStepLabel}
          </span>
        )}
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className={styles.activityBody}>
          <div className={styles.activitySteps}>
            {events.map((event, i) => (
              <AgentStep key={i} event={event} />
            ))}
          </div>
          {isLive && (
            <div className={styles.activityLiveFooter}>
              <div className={styles.activityDots}>
                <span className={styles.activityDot} />
                <span className={styles.activityDot} />
                <span className={styles.activityDot} />
              </div>
              <span>Processing…</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
