import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import {
  CheckCircle,
  FileText,
  GitBranch,
  Pencil,
  Save,
  XCircle,
} from 'lucide-react'
import { useSpec } from '../hooks/useSpec'
import type { SpecPatchOperation } from '../lib/api'
import { applyNodeChanges } from '@xyflow/react'
import type { Node, NodeChange } from '@xyflow/react'
import {
  applyAutoLayout,
  flowchartModelFromSpecDocument,
  nodesForHldExport,
} from './planning/specFlowchart'
import { PlanningHldDownloadButton } from './planning/PlanningHldDownloadButton'
import { FlowchartCanvas } from './planning/FlowchartCanvas'
import { BlockNotePlanEditor } from './planning/BlockNotePlanEditor'
import { useFlowchartEditor } from './planning/useFlowchartEditor'

export interface PlanningPaneHandle {
  refresh: () => Promise<void>
}

export type { FlowchartChange } from './planning/useFlowchartEditor'
import type { FlowchartChange } from './planning/useFlowchartEditor'

interface PlanningPaneProps {
  sessionId: string
  onBuildApplication: () => void
  isAgentBusy?: boolean
  onPlanEdited?: () => void
  onFlowchartEdited?: (changes: FlowchartChange[]) => void
  readOnly?: boolean
}

interface EditableSection {
  id: string
  title: string
  content: string
}

function normalizeSections(raw: unknown): EditableSection[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const section = item as Record<string, unknown>
      const title = String(section.title || '').trim()
      return {
        id: String(section.id || `section_${index + 1}`).trim() || `section_${index + 1}`,
        title,
        content: String(section.content || ''),
      }
    })
}

const SINGLE_PLAN_SECTION_ID = 'plan'

export const PlanningPane = forwardRef<PlanningPaneHandle, PlanningPaneProps>(function PlanningPane({ sessionId, onBuildApplication, isAgentBusy = false, onPlanEdited, onFlowchartEdited, readOnly = false }, ref) {
  const [tab, setTab] = useState<'spec' | 'flow'>('spec')
  const [isEditingPlan, setIsEditingPlan] = useState(false)
  /** Single-document edit: one markdown body for the whole plan (Notion/Google Docs style). */
  const [draftMarkdown, setDraftMarkdown] = useState<string>('')
  const [isSavingPlan, setIsSavingPlan] = useState(false)
  const [isApprovingPlan, setIsApprovingPlan] = useState(false)
  const [planSaveError, setPlanSaveError] = useState<string | null>(null)
  const [liveNodes, setLiveNodes] = useState<Node[]>([])
  const blockNoteRef = useRef<any>(null)
  const flowInstanceRef = useRef<any>(null)

  // Flowchart editing state — delegated to hook
  const flowEditor = useFlowchartEditor()

  const { spec, isLoading, error, approve, patch, refresh, saveFlowchart } = useSpec(sessionId)

  useImperativeHandle(ref, () => ({ refresh }), [refresh])

  useEffect(() => {
    if (!readOnly) return
    setIsEditingPlan(false)
    flowEditor.cancelEditing()
    setPlanSaveError(null)
  }, [readOnly, flowEditor])

  const sections = useMemo(
    () => normalizeSections(spec?.document?.state?.sections),
    [spec]
  )
  const fullMarkdown = spec?.document?.markdown ?? ''

  /** When leaving edit mode, clear draft. */
  useEffect(() => {
    if (!isEditingPlan) setDraftMarkdown('')
  }, [isEditingPlan])

  const version = spec?.document?.state?.version ?? 0
  const flowModel = useMemo(
    () => flowchartModelFromSpecDocument(spec?.document?.flowchart),
    [spec]
  )

  // Only re-apply auto-layout when node structure actually changes (ids or labels),
  // not on every re-render — prevents dragged positions from snapping back.
  // Skip during flowchart edit mode to prevent poll results from overwriting the draft.
  const nodesFingerprintRef = useRef('')
  useEffect(() => {
    if (flowEditor.isEditing) return
    const fingerprint = flowModel.nodes
      .map((n) => `${n.id}:${(n.data as any)?.label ?? ''}`)
      .sort()
      .join('|')
    if (fingerprint !== nodesFingerprintRef.current) {
      nodesFingerprintRef.current = fingerprint
      setLiveNodes(applyAutoLayout(flowModel.nodes, flowModel.edges))
    }
  }, [flowModel.nodes, flowModel.edges, flowEditor.isEditing])
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (flowEditor.isEditing) {
      // In edit mode, position/selection changes must update draftNodes
      flowEditor.applyNodeChanges(changes)
    } else {
      setLiveNodes((nds) => applyNodeChanges(changes, nds))
    }
  }, [flowEditor])
  const displayedFlowNodes = liveNodes.length > 0 ? liveNodes : flowModel.nodes
  const flowCanvasKey = useMemo(() => {
    // Key based on node IDs only — NOT edge IDs. Edge changes during edit mode
    // must NOT remount ReactFlow (which would reset viewport and interaction state).
    // During editing, use a stable key so structural edits don't cause remounts.
    if (flowEditor.isEditing) return 'editing'
    const nodeIds = flowModel.nodes.map((node) => node.id).sort().join('|')
    return nodeIds
  }, [flowModel.nodes, flowEditor.isEditing])

  const hasPlanContent = sections.some((section) => section.title.trim() || section.content.trim())
  const canBuild = !readOnly && !isAgentBusy && !isApprovingPlan && hasPlanContent

  const startEditingPlan = useCallback(() => {
    setPlanSaveError(null)
    setDraftMarkdown(fullMarkdown)
    setIsEditingPlan(true)
  }, [fullMarkdown])

  const cancelEditingPlan = useCallback(() => {
    setPlanSaveError(null)
    setIsEditingPlan(false)
  }, [])

  /** Build patch ops to replace the whole plan with one document (single section). */
  const buildSingleDocPatchOperations = useCallback(
    (currentSections: EditableSection[], markdown: string): SpecPatchOperation[] => {
      const operations: SpecPatchOperation[] = []
      for (const s of currentSections) {
        operations.push({ op: 'delete', section_id: s.id })
      }
      operations.push({
        op: 'add',
        section: {
          id: SINGLE_PLAN_SECTION_ID,
          title: 'Plan',
          content: markdown,
        },
      })
      return operations
    },
    []
  )

  const savePlanEdits = useCallback(async () => {
    setPlanSaveError(null)
    setIsSavingPlan(true)
    try {
      let exportedMarkdown = ''
      let exportErr: unknown = null

      // Try custom serializer first
      try {
        exportedMarkdown = blockNoteRef.current?.__exportMarkdown?.() ?? ''
      } catch (e) {
        exportErr = e
        console.error('[PlanningPane] __exportMarkdown failed:', e)
      }

      // If custom serializer failed or returned empty, try BlockNote's built-in
      if (!exportedMarkdown && blockNoteRef.current) {
        try {
          const blocks = blockNoteRef.current.document
          if (Array.isArray(blocks) && blocks.length > 0) {
            // Use BlockNote's built-in markdown serializer as fallback
            const md = blockNoteRef.current.blocksToMarkdownLossy(blocks)
            if (typeof md === 'string' && md.trim()) exportedMarkdown = md
          }
        } catch (e2) {
          console.error('[PlanningPane] blocksToMarkdownLossy fallback failed:', e2)
        }
      }

      if (!exportedMarkdown) {
        const detail = exportErr instanceof Error ? exportErr.message : 'Editor returned empty document'
        setPlanSaveError(`Save failed: ${detail}. Your edits are still in the editor — try again.`)
        return
      }

      const operations = buildSingleDocPatchOperations(sections, exportedMarkdown)
      if (!operations.length) {
        setIsEditingPlan(false)
        return
      }
      await patch(operations)
      setIsEditingPlan(false)
      onPlanEdited?.()
    } catch (err) {
      setPlanSaveError(err instanceof Error ? err.message : 'Failed to save plan edits')
    } finally {
      setIsSavingPlan(false)
    }
  }, [buildSingleDocPatchOperations, patch, sections, onPlanEdited])

  // ── Flowchart editing callbacks (delegated to useFlowchartEditor) ────

  const startEditingFlow = useCallback(() => {
    flowEditor.startEditing(displayedFlowNodes, flowModel.edges)
  }, [displayedFlowNodes, flowModel.edges, flowEditor])

  const saveFlowEdits = useCallback(async () => {
    // Capture draft positions BEFORE save clears them — prevents snap-back
    // while waiting for the next poll to fetch the updated server data
    const savedNodes = [...flowEditor.draftNodes]
    const vp = flowInstanceRef.current?.getViewport?.()
    await flowEditor.save(saveFlowchart, onFlowchartEdited, vp ?? undefined)
    // Set liveNodes to the saved positions so they display correctly
    // until the poll refreshes flowModel with the persisted data
    if (savedNodes.length > 0) {
      setLiveNodes(savedNodes)
      // Update fingerprint to match so auto-layout doesn't immediately overwrite
      nodesFingerprintRef.current = savedNodes
        .map((n) => `${n.id}:${(n.data as any)?.label ?? ''}`)
        .sort()
        .join('|')
    }
  }, [flowEditor, saveFlowchart, onFlowchartEdited])

  // Enrich edges with editMode and onLabelChange so EditableEdge can enable inline editing
  const editableEdges = useMemo(() => {
    const baseEdges = flowEditor.isEditing ? flowEditor.draftEdges : flowModel.edges
    if (!flowEditor.isEditing) return baseEdges
    return baseEdges.map(e => ({
      ...e,
      data: {
        ...(e.data ?? {}),
        editMode: true,
        onLabelChange: (newLabel: string) => flowEditor.updateEdgeLabel(e.id, newLabel),
      },
    }))
  }, [flowEditor.isEditing, flowEditor.draftEdges, flowModel.edges, flowEditor])

  const hldPlanMarkdown = isEditingPlan ? draftMarkdown : fullMarkdown
  const hldExportNodes = useMemo(() => {
    const baseNodes = flowEditor.isEditing ? flowEditor.draftNodes : flowModel.nodes
    const baseEdges = flowEditor.isEditing ? flowEditor.draftEdges : flowModel.edges
    if (baseNodes.length === 0) return []
    return nodesForHldExport(applyAutoLayout(baseNodes, baseEdges))
  }, [flowEditor.isEditing, flowEditor.draftNodes, flowEditor.draftEdges, flowModel.nodes, flowModel.edges])

  return (
    <div className="h-full flex flex-col bg-[linear-gradient(180deg,_rgba(248,250,252,0.92)_0%,_rgba(255,255,255,0.98)_100%)]">
      <div className="border-b border-border bg-white/90 px-4 py-4 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('spec')}
              disabled={flowEditor.isEditing}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                tab === 'spec'
                  ? 'bg-slate-900 text-white shadow-aira-sm'
                  : 'text-text-secondary hover:bg-slate-100 hover:text-slate-900'
              } ${flowEditor.isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                Plan
              </span>
            </button>
            <button
              onClick={() => setTab('flow')}
              disabled={isEditingPlan}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                tab === 'flow'
                  ? 'bg-slate-900 text-white shadow-aira-sm'
                  : 'text-text-secondary hover:bg-slate-100 hover:text-slate-900'
              } ${isEditingPlan ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                <GitBranch className="w-3.5 h-3.5" />
                Flowchart
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!isLoading && (
              <PlanningHldDownloadButton
                sessionId={sessionId}
                planMarkdown={hldPlanMarkdown || fullMarkdown}
                exportNodes={hldExportNodes}
                exportEdges={flowEditor.isEditing ? flowEditor.draftEdges : flowModel.edges}
                disabled={readOnly || isAgentBusy || isLoading}
              />
            )}
            {tab === 'spec' && (
              <>
                {isEditingPlan ? (
                  <>
                    <button
                      onClick={cancelEditingPlan}
                      disabled={isSavingPlan || readOnly}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-slate-100 disabled:opacity-60 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={savePlanEdits}
                      disabled={isSavingPlan || readOnly}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-60 transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {isSavingPlan ? 'Saving...' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEditingPlan}
                    disabled={isAgentBusy || readOnly}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Plan
                  </button>
                )}
              </>
            )}
            {tab === 'flow' && (
              <>
                {flowEditor.isEditing ? (
                  <>
                    <button
                      onClick={flowEditor.cancelEditing}
                      disabled={flowEditor.isSaving || readOnly}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-slate-100 disabled:opacity-60 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={saveFlowEdits}
                      disabled={flowEditor.isSaving || readOnly}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-60 transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {flowEditor.isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEditingFlow}
                    disabled={isAgentBusy || readOnly || displayedFlowNodes.length === 0}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs border border-border text-text-secondary hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Flowchart
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-auto my-4 w-full max-w-6xl rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        <div className="flex w-full flex-col min-h-0 flex-1 h-full">
        {isLoading && <div className="text-xs text-text-muted">Loading plan...</div>}
        {!isLoading && tab === 'spec' && (
          <>
            {readOnly && (
              <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 shrink-0">
                Viewing plan output only. Reopen planning before editing or approving it.
              </div>
            )}
            {planSaveError && (
              <div className="mb-3 rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-xs text-error shrink-0">
                {planSaveError}
              </div>
            )}
            {isEditingPlan ? (
              <div className="flex-1 min-h-0 rounded-2xl border border-border/80 bg-cream-surface overflow-y-auto shadow-aira-sm flex flex-col">
                <BlockNotePlanEditor
                  ref={blockNoteRef}
                  markdown={fullMarkdown}
                  editable={true}
                />
              </div>
            ) : (
              <div className="w-full">
                <div className="w-full">
                  <div className="border-t border-border bg-cream-surface px-8 py-7">
                    <BlockNotePlanEditor
                      markdown={spec?.document?.markdown || '# Plan\n\n_No content yet. Start a conversation to build your plan._'}
                      editable={false}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {!isLoading && tab === 'flow' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {flowModel.issues.length > 0 && (
              <div className="mb-3 rounded border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
                {flowModel.issues.join(' ')}
              </div>
            )}
            {flowEditor.saveError && (
              <div className="mb-3 rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-xs text-error shrink-0">
                {flowEditor.saveError}
              </div>
            )}

            {(flowEditor.isEditing ? flowEditor.draftNodes.length > 0 : displayedFlowNodes.length > 0) ? (
              <div className="flex-1 min-h-[440px] border border-border bg-cream-surface overflow-hidden shadow-aira-sm flex flex-col">
                <FlowchartCanvas
                  key={flowCanvasKey}
                  nodes={flowEditor.isEditing ? flowEditor.draftNodes : displayedFlowNodes}
                  edges={editableEdges}
                  viewport={flowModel.viewport}
                  onFlowInit={(instance) => { flowInstanceRef.current = instance }}
                  onNodesChange={onNodesChange}
                  editMode={flowEditor.isEditing}
                  onConnect={flowEditor.onConnect}
                  onNodeDelete={flowEditor.deleteNode}
                  onEdgeDelete={flowEditor.deleteEdge}
                  onCanvasClick={flowEditor.handleCanvasClick}
                  placementMode={flowEditor.placementMode}
                  deleteMode={flowEditor.deleteMode}
                  onSetPlacement={flowEditor.setPlacementMode}
                  onSetDeleteMode={flowEditor.setDeleteMode}
                  selectedNodeId={flowEditor.selectedNodeId}
                  onSelectNode={flowEditor.selectNode}
                  onUpdateNodeLabel={flowEditor.updateNodeLabel}
                  onUpdateNodeType={flowEditor.updateNodeType}
                  onUpdateNodeContent={flowEditor.updateNodeContent}
                  onDeleteNode={flowEditor.deleteNode}
                  onUndo={flowEditor.undo}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-[440px] border border-dashed border-border bg-white/80 flex items-center justify-center">
                <div className="text-center text-text-muted">
                  <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium text-text-primary">No flowchart yet</p>
                  <p className="text-xs mt-1">
                    The flowchart will appear here once the AI assistant has analyzed your intent and designed the application flow.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      <div className="border-t border-border bg-white/90 px-4 py-3 flex items-center justify-between">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <p className="text-xs text-text-muted">
            Approve the plan only after the written document and flowchart both match the intended RF workflow.
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={!canBuild}
              onClick={async () => {
                setPlanSaveError(null)
                setIsApprovingPlan(true)
                try {
                  const nextState = await approve(version)
                  if (nextState?.plan_state !== 'approved') {
                    throw new Error('Plan is not approved yet. Please approve the plan before building.')
                  }
                  onBuildApplication()
                } catch (err) {
                  setPlanSaveError(err instanceof Error ? err.message : 'Failed to approve plan')
                } finally {
                  setIsApprovingPlan(false)
                }
              }}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                canBuild
                  ? 'bg-brand hover:bg-brand-hover text-white'
                  : 'bg-cream-surface-light text-text-muted cursor-not-allowed'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {isApprovingPlan ? 'Approving...' : 'Build this application'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

