import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

import { MetricTag } from './metricTagSpec'
import {
  blocksToMarkdownWithMetricTags,
  processBlocksForMetricTags,
  preProcessMarkdownForImport,
} from './metricTagMarkdown'

const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    metricTag: MetricTag,
  },
})

type ParsedBlocks = Array<Record<string, unknown>>

interface BlockNotePlanEditorProps {
  markdown: string
  editable: boolean
  /** When true, hides the toolbar and uses compact min-height. Used in the flowchart node panel. */
  compact?: boolean
}

function ToolbarButton({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={`px-2 py-1 text-xs rounded transition-colors ${
        active ? 'bg-cream-surface-light text-text-primary font-semibold' : 'text-text-secondary hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function EditorToolbar({ editor }: { editor: any }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!editor) return
    const cb = () => setTick((t) => t + 1)
    const unsubSelection = editor.onSelectionChange(cb)
    const unsubChange = editor.onChange(cb)
    return () => {
      unsubSelection()
      unsubChange()
    }
  }, [editor])

  if (!editor) return null

  const activeStyles = editor.getActiveStyles?.() ?? {}
  const currentBlock = editor.getTextCursorPosition?.()?.block

  return (
    <div className="flex items-center gap-0.5 border-b border-border bg-slate-50/80 px-3 py-1.5 flex-wrap shrink-0">
      <ToolbarButton title="Bold (Ctrl+B)" active={activeStyles.bold} onClick={() => editor.toggleStyles({ bold: true })}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton title="Italic (Ctrl+I)" active={activeStyles.italic} onClick={() => editor.toggleStyles({ italic: true })}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" active={activeStyles.strike} onClick={() => editor.toggleStyles({ strike: true })}>
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton title="Code" active={activeStyles.code} onClick={() => editor.toggleStyles({ code: true })}>
        <code className="text-[11px]">&lt;/&gt;</code>
      </ToolbarButton>

      <span className="mx-1.5 h-4 w-px bg-slate-300" />

      <ToolbarButton title="Heading 1" active={currentBlock?.type === 'heading' && currentBlock?.props?.level === 1}
        onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: 'heading', props: { level: 1 } })}>
        H1
      </ToolbarButton>
      <ToolbarButton title="Heading 2" active={currentBlock?.type === 'heading' && currentBlock?.props?.level === 2}
        onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: 'heading', props: { level: 2 } })}>
        H2
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={currentBlock?.type === 'heading' && currentBlock?.props?.level === 3}
        onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: 'heading', props: { level: 3 } })}>
        H3
      </ToolbarButton>

      <span className="mx-1.5 h-4 w-px bg-slate-300" />

      <ToolbarButton title="Bullet List" active={currentBlock?.type === 'bulletListItem'}
        onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: 'bulletListItem' })}>
        &bull; List
      </ToolbarButton>
      <ToolbarButton title="Numbered List" active={currentBlock?.type === 'numberedListItem'}
        onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: 'numberedListItem' })}>
        1. List
      </ToolbarButton>
      <ToolbarButton title="Paragraph" active={currentBlock?.type === 'paragraph'}
        onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: 'paragraph' })}>
        &#182;
      </ToolbarButton>

      <span className="mx-1.5 h-4 w-px bg-slate-300" />

      <button
        onMouseDown={(e) => {
          e.preventDefault()
          editor.insertInlineContent([
            { type: 'metricTag', props: { metricType: 'PM', ioc: '', metric: '' } },
          ])
        }}
        title="Insert Metric Tag"
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors"
      >
        + Metric
      </button>
    </div>
  )
}

const SLASH_EXCLUDE = new Set([
  'image', 'video', 'audio', 'file', 'emoji',
  'toggle_heading', 'toggle_heading_2', 'toggle_heading_3',
  'toggle_list', 'heading_4', 'heading_5', 'heading_6',
])

export const BlockNotePlanEditor = forwardRef<any, BlockNotePlanEditorProps>(
  function BlockNotePlanEditor({ markdown, editable, compact }, ref) {
    const editor = useCreateBlockNote({ schema }, [])
    const lastImportedRef = useRef('')
    const [importError, setImportError] = useState<string | null>(null)

    useImperativeHandle(ref, () => editor, [editor])

    // Import markdown whenever it changes.
    // React effects fire after DOM commit, so BlockNoteView's mount callback
    // (which attaches the ProseMirror view) has already executed by this point.
    // tryParseMarkdownToBlocks is SYNCHRONOUS — no await needed.
    useEffect(() => {
      if (!editor || !markdown) return
      if (markdown === lastImportedRef.current) return

      let lastErr: unknown = null

      const doImport = () => {
        try {
          const safeMarkdown = preProcessMarkdownForImport(markdown)
          const blocks = editor.tryParseMarkdownToBlocks(safeMarkdown)
          const processed = processBlocksForMetricTags(blocks as ParsedBlocks)
          editor.replaceBlocks(editor.document, processed as typeof editor.document)
          lastImportedRef.current = markdown
          setImportError(null)
          return true
        } catch (err) {
          lastErr = err
          console.error('[BlockNotePlanEditor] import failed:', err)
          return false
        }
      }

      // Try immediately; if it fails (view not yet ready), retry after two frames
      if (!doImport()) {
        const raf = requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!doImport()) {
              const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
              setImportError(`Import error: ${msg}`)
            }
          })
        })
        return () => cancelAnimationFrame(raf)
      }
    }, [editor, markdown])

    // Attach export helper
    useEffect(() => {
      if (!editor) return
      ;(editor as any).__exportMarkdown = () => {
        return blocksToMarkdownWithMetricTags(editor.document as ParsedBlocks)
      }
    }, [editor])

    const getSlashMenuItems = useCallback(
      async (query: string) => {
        if (!editor) return []
        const allItems = getDefaultReactSlashMenuItems(editor)
        const metricItem = {
          title: 'Metric Tag',
          subtext: 'Insert a metric reference (PM/CM/KPI)',
          onItemClick: () => {
            editor.insertInlineContent([
              {
                type: 'metricTag' as const,
                props: { metricType: 'PM', ioc: '', metric: '' },
              },
            ])
          },
          aliases: ['metric', 'pm', 'cm', 'kpi', 'parameter', 'counter'],
          group: 'Domain',
          key: 'metric_tag',
        }
        const filtered = allItems.filter((item) => !SLASH_EXCLUDE.has((item as any).key))
        return filterSuggestionItems([metricItem, ...filtered], query)
      },
      [editor],
    )

    if (!editor) return null

    return (
      <div className={`${compact ? 'min-h-[80px] [&_.bn-editor]:min-h-[80px]' : 'min-h-[400px] [&_.bn-editor]:min-h-[400px]'} [&_.bn-container]:border-0 flex flex-col`}>
        {importError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-2">
            {importError}
          </div>
        )}
        {editable && !compact && <EditorToolbar editor={editor} />}
        <div className="flex-1 min-h-0">
          <BlockNoteView
            editor={editor}
            editable={editable}
            theme="light"
            slashMenu={false}
          >
            {editable && (
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={getSlashMenuItems}
              />
            )}
          </BlockNoteView>
        </div>
      </div>
    )
  },
)
