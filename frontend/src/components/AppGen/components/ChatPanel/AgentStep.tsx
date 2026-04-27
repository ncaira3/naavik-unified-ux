import { useState } from 'react'
import {
  Bot,
  Wrench,
  FileCode,
  AlertCircle,
  CheckCircle,
  Lightbulb,
  Play,
  HelpCircle,
} from 'lucide-react'
import type { AgentEvent } from '../../hooks/useChat'
import { formatToolOutput } from './utils'
import styles from './ChatPanel.module.css'

interface AgentStepProps {
  event: AgentEvent
}

const EVENT_CONFIG: Record<
  string,
  { icon: typeof Bot; color: string; bg: string; label: string }
> = {
  planning: {
    icon: Lightbulb,
    color: '#7c3aed',
    bg: '#f5f3ff',
    label: 'Planning',
  },
  executing: {
    icon: Play,
    color: '#2563eb',
    bg: '#eff6ff',
    label: 'Executing',
  },
  tool_start: {
    icon: Wrench,
    color: '#d97706',
    bg: '#fffbeb',
    label: 'Tool',
  },
  tool_result: {
    icon: CheckCircle,
    color: '#16a34a',
    bg: '#f0fdf4',
    label: 'Tool ✓',
  },
  file_change: {
    icon: FileCode,
    color: '#0891b2',
    bg: '#ecfeff',
    label: 'File changed',
  },
  summary: {
    icon: CheckCircle,
    color: '#16a34a',
    bg: '#f0fdf4',
    label: 'Complete',
  },
  clarification_needed: {
    icon: HelpCircle,
    color: '#d97706',
    bg: '#fffbeb',
    label: 'Clarification needed',
  },
  error: {
    icon: AlertCircle,
    color: '#dc2626',
    bg: '#fef2f2',
    label: 'Error',
  },
}

const DEFAULT_CONFIG = {
  icon: Bot,
  color: '#64748b',
  bg: '#f1f5f9',
  label: 'Event',
}

export function AgentStep({ event }: AgentStepProps) {
  const [isContentExpanded, setIsContentExpanded] = useState(false)

  const config = (() => {
    if (event.event_type === 'tool_result') {
      const ok = event.metadata?.success !== false
      return {
        ...EVENT_CONFIG.tool_result,
        icon: ok ? CheckCircle : AlertCircle,
        color: ok ? '#16a34a' : '#dc2626',
        bg: ok ? '#f0fdf4' : '#fef2f2',
        label: `${event.metadata?.tool ?? 'Tool'} ${ok ? '✓' : '✗'}`,
      }
    }
    if (event.event_type === 'executing' && event.metadata?.summary) {
      return { ...EVENT_CONFIG.executing, label: event.metadata.summary }
    }
    if (event.event_type === 'tool_start') {
      return {
        ...EVENT_CONFIG.tool_start,
        label: event.metadata?.tool ?? 'Tool',
      }
    }
    return EVENT_CONFIG[event.event_type] ?? DEFAULT_CONFIG
  })()

  const Icon = config.icon
  let displayContent = event.content ?? ''

  if (event.event_type === 'tool_result') {
    const fullToolOutput = formatToolOutput(event.metadata?.output)
    if (fullToolOutput) {
      displayContent = fullToolOutput
    } else if (!displayContent) {
      displayContent =
        event.metadata?.success === false
          ? 'Tool execution failed'
          : 'Tool execution completed'
    }
  }

  if (event.event_type === 'tool_start' && event.metadata?.path) {
    displayContent = `${event.metadata.tool ?? 'Tool'} → ${event.metadata.path}`
  } else if (event.event_type === 'tool_start' && !displayContent) {
    displayContent = event.metadata?.tool ?? 'Running tool…'
  }

  const isLong = displayContent.length > 200
  const truncated =
    isLong && !isContentExpanded ? displayContent.slice(0, 200) + '…' : displayContent

  return (
    <div className={styles.stepRow}>
      <div
        className={styles.stepIcon}
        style={{ backgroundColor: config.bg, color: config.color }}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className={styles.stepBody}>
        <div className={styles.stepLabel} style={{ color: config.color }}>
          {config.label}
        </div>
        {truncated && (
          <p className={styles.stepContent}>{truncated}</p>
        )}
        {isLong && (
          <button
            type="button"
            onClick={() => setIsContentExpanded(!isContentExpanded)}
            className={styles.stepExpand}
          >
            {isContentExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}
