import { useMemo, useState } from 'react'
import { Eye, EyeOff, Heading, Keyboard, List, Pilcrow } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownPlanEditor({
  value,
  onChange,
  height,
}: {
  value: string
  onChange: (value: string) => void
  height: number
}) {
  const [showPreview, setShowPreview] = useState(true)
  const editorHeight = Math.max(280, height)
  const shortcuts = useMemo(
    () => [
      { key: 'Cmd/Ctrl+B', description: 'Wrap selection with `**bold**`' },
      { key: 'Cmd/Ctrl+I', description: 'Wrap selection with `*italic*`' },
      { key: 'Tab', description: 'Insert two spaces for nested list indentation' },
    ],
    []
  )

  const insertSnippet = (snippet: string) => {
    const prefix = value.length > 0 && !value.endsWith('\n') ? '\n' : ''
    onChange(`${value}${prefix}${snippet}`)
  }

  const wrapSelection = (
    textarea: HTMLTextAreaElement,
    prefix: string,
    suffix = prefix
  ) => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)
    const nextValue = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`
    onChange(nextValue)

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.selectionStart = start + prefix.length
      textarea.selectionEnd = end + prefix.length
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      wrapSelection(textarea, '**')
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      wrapSelection(textarea, '*')
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`
      onChange(nextValue)
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.selectionStart = start + 2
        textarea.selectionEnd = start + 2
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-cream-surface">
      <div className="flex items-center justify-between border-b border-border bg-cream-bg px-3 py-2">
        <div className="flex items-center gap-2">
          <ToolbarButton label="Heading" onClick={() => insertSnippet('## Section Title\nShort description here.\n')}>
            <Heading className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Bullets" onClick={() => insertSnippet('- First item\n- Second item\n- Third item\n')}>
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Paragraph" onClick={() => insertSnippet('Add a clear implementation note or requirement here.\n')}>
            <Pilcrow className="h-4 w-4" />
          </ToolbarButton>
        </div>
        <button
          type="button"
          onClick={() => setShowPreview((current) => !current)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-cream-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-slate-100"
        >
          {showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>

      <div className="flex items-center justify-between border-b border-border bg-cream-surface px-4 py-2">
        <p className="text-xs text-text-muted">
          Keep the plan explicit: intent, requirements, architecture, telecom assumptions, and runtime constraints.
        </p>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Keyboard className="h-3.5 w-3.5" />
          {shortcuts.map((shortcut) => (
            <span key={shortcut.key} title={shortcut.description} className="rounded-full bg-cream-surface-light px-2 py-1 font-medium">
              {shortcut.key}
            </span>
          ))}
        </div>
      </div>

      <div className={`grid min-h-0 flex-1 ${showPreview ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="min-h-0 border-r border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            Markdown
          </div>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-full w-full resize-none border-0 px-4 py-3 font-mono text-sm leading-6 text-text-primary focus:outline-none"
            style={{ minHeight: editorHeight }}
            placeholder="Write your plan here using Markdown. Capture intent, architecture, requirements, safety constraints, and telecom-specific assumptions."
            spellCheck={false}
          />
        </div>

        {showPreview && (
          <div className="min-h-0 bg-slate-50/70">
            <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              Preview
            </div>
            <div
              className="markdown-body h-full overflow-y-auto px-5 py-4"
              style={{ minHeight: editorHeight }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || '_Preview will appear here as you edit the plan._'}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ToolbarButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-cream-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-slate-100"
      title={label}
    >
      {children}
      {label}
    </button>
  )
}
