import { useState } from 'react'
import {
  Plus,
  Folder,
  FolderOpen,
  Trash2,
  Clock,
  FileText,
  HardDrive,
  Sparkles,
  Loader2,
  LogOut,
  User,
  LayoutGrid,
  List,
  ChevronRight,
} from 'lucide-react'
import type { ProjectInfo } from '../lib/api'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ProjectsPageProps {
  projects: ProjectInfo[]
  isLoading: boolean
  onCreateProject: (name: string, description?: string) => Promise<void>
  onSelectProject: (name: string) => void
  onDeleteProject: (name: string) => Promise<void>
  username?: string
  onLogout?: () => void
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatTime(isoString?: string): string {
  if (!isoString) return 'Unknown'
  const date = new Date(isoString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function ProjectsHeader({
  username,
  onLogout,
}: {
  username?: string
  onLogout?: () => void
}) {
  return (
    <header className="h-16 border-b border-cream-border/70 dark:border-pulse-border/70 bg-cream-surface/85 dark:bg-pulse-surface/85 backdrop-blur-md flex items-center justify-between px-6 sm:px-8 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg border border-cream-border dark:border-pulse-border bg-tenant-light/60 dark:bg-white/6 text-tenant-primary">
          <Sparkles className="w-5 h-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-light-primary dark:text-text-primary">AppGen</h1>
          <span className="text-xs text-text-light-secondary dark:text-text-secondary hidden sm:inline">
            AI-Powered Code Generation
          </span>
        </div>
      </div>
      {username && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-light-secondary dark:text-text-secondary">{username}</span>
          <User className="w-4 h-4 text-text-light-muted dark:text-text-muted" aria-hidden />
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 ml-2 px-3 py-1.5 rounded-lg text-sm border border-cream-border/80 dark:border-pulse-border/70 bg-white/70 hover:bg-cream-surface-light dark:bg-white/5 dark:hover:bg-white/8 text-text-light-secondary hover:text-text-light-primary dark:text-text-secondary dark:hover:text-text-primary transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          )}
        </div>
      )}
    </header>
  )
}

function CreateProjectForm({
  newName,
  newDesc,
  creating,
  createError,
  onNameChange,
  onDescChange,
  onSubmit,
  onCancel,
  onKeyDown,
}: {
  newName: string
  newDesc: string
  creating: boolean
  createError: string | null
  onNameChange: (v: string) => void
  onDescChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <section
      className="mb-8 p-6 sm:p-8 bg-cream-surface dark:bg-pulse-surface rounded-2xl border border-cream-border/80 dark:border-pulse-border/70 shadow-card"
      aria-labelledby="create-project-heading"
    >
      <h2 id="create-project-heading" className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-5">
        Create New Project
      </h2>
      <div className="space-y-5">
        <div>
          <label htmlFor="project-name" className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-1.5">
            Project Name
          </label>
          <input
            id="project-name"
            type="text"
            value={newName}
            onChange={(e) =>
              onNameChange(e.target.value.replace(/[^a-zA-Z0-9\-_]/g, ''))
            }
            onKeyDown={onKeyDown}
            placeholder="my-awesome-app"
            className="w-full bg-cream-bg dark:bg-pulse-bg border border-cream-border dark:border-pulse-border rounded-lg px-4 py-2.5 text-text-light-primary dark:text-text-primary placeholder:text-text-light-muted dark:placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-tenant-primary/35 focus:border-tenant-primary/40 transition-shadow"
            autoFocus
            autoComplete="off"
            aria-describedby="project-name-hint"
          />
          <p id="project-name-hint" className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
            Letters, numbers, hyphens, and underscores only
          </p>
        </div>
        <div>
          <label htmlFor="project-desc" className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-1.5">
            Description <span className="font-normal text-text-light-secondary dark:text-text-secondary">(optional)</span>
          </label>
          <input
            id="project-desc"
            type="text"
            value={newDesc}
            onChange={(e) => onDescChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="A brief description of your project"
            className="w-full bg-cream-bg dark:bg-pulse-bg border border-cream-border dark:border-pulse-border rounded-lg px-4 py-2.5 text-text-light-primary dark:text-text-primary placeholder:text-text-light-muted dark:placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-tenant-primary/35 focus:border-tenant-primary/40 transition-shadow"
            autoComplete="off"
          />
        </div>
        {createError && (
          <p className="text-sm text-red-600" role="alert">
            {createError}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!newName.trim() || creating}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed bg-tenant-primary hover:bg-tenant-primary/90 text-tenant-on-primary border border-tenant-primary/40 shadow-sm"
          >
            {creating ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            Create &amp; Open
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-sm font-medium rounded-lg transition-colors focus:outline-none border border-cream-border dark:border-pulse-border bg-white/70 hover:bg-cream-surface-light dark:bg-white/5 dark:hover:bg-white/8 text-text-light-secondary hover:text-text-light-primary dark:text-text-secondary dark:hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  )
}

function ProjectCard({
  project,
  onSelect,
  onDelete,
}: {
  project: ProjectInfo
  onSelect: () => void
  onDelete: () => void
}) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
      onDelete()
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="group relative p-5 sm:p-6 bg-cream-surface/88 dark:bg-pulse-surface/70 rounded-2xl border border-cream-border/80 dark:border-pulse-border/60 hover:border-slate-300/70 dark:hover:border-white/18 hover:bg-white/92 dark:hover:bg-white/7 cursor-pointer transition-colors duration-200 shadow-base focus:outline-none"
      aria-label={`Open project ${project.name}`}
    >
      <button
        type="button"
        onClick={handleDelete}
        className="absolute top-3 right-3 p-2 rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-text-light-muted hover:text-red-600 hover:bg-red-50 dark:text-text-muted dark:hover:bg-red-500/10 transition-all focus:outline-none focus:ring-2 focus:ring-red-200"
        title="Delete project"
        aria-label={`Delete project ${project.name}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-tenant-light/70 dark:bg-white/6 border border-cream-border dark:border-pulse-border flex items-center justify-center shrink-0">
          <FolderOpen className="w-5 h-5 text-tenant-primary" aria-hidden />
        </div>
        <h3 className="font-semibold text-text-light-primary dark:text-text-primary truncate flex-1 min-w-0 pt-0.5">
          {project.name}
        </h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-4 text-xs text-text-light-secondary dark:text-text-secondary">
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {project.file_count} files
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {formatSize(project.size)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-light-secondary dark:text-text-secondary">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Updated {formatTime(project.modified_at)}
        </div>
      </div>

      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <ChevronRight className="w-5 h-5 text-tenant-primary" aria-hidden />
      </div>
    </article>
  )
}

/** Compact list row for list view — single line with icon, name, meta, chevron. */
function ProjectListRow({
  project,
  onSelect,
  onDelete,
}: {
  project: ProjectInfo
  onSelect: () => void
  onDelete: () => void
}) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
      onDelete()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="group flex items-center gap-4 py-3 px-4 rounded-xl border border-transparent hover:border-cream-border dark:hover:border-pulse-border hover:bg-cream-surface dark:hover:bg-pulse-surface-light transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-tenant-primary/30 focus:ring-offset-2"
      aria-label={`Open project ${project.name}`}
    >
      <div className="w-10 h-10 rounded-lg bg-tenant-light/70 dark:bg-white/6 border border-cream-border/70 dark:border-pulse-border/70 flex items-center justify-center shrink-0">
        <FolderOpen className="w-5 h-5 text-tenant-primary" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-text-light-primary dark:text-text-primary truncate block">
          {project.name}
        </span>
        <span className="text-xs text-text-light-secondary dark:text-text-secondary">
          {project.file_count} files · {formatSize(project.size)} · Updated {formatTime(project.modified_at)}
        </span>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        className="p-2 rounded-lg opacity-0 group-hover:opacity-100 text-text-light-muted hover:text-red-600 hover:bg-red-50 dark:text-text-muted dark:hover:bg-red-500/10 transition-all shrink-0 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-200"
        title="Delete project"
        aria-label={`Delete project ${project.name}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <ChevronRight className="w-5 h-5 text-text-light-muted dark:text-text-muted group-hover:text-tenant-primary shrink-0 transition-colors" aria-hidden />
    </div>
  )
}

function EmptyState({
  onCreateClick,
}: {
  onCreateClick: () => void
}) {
  return (
    <div className="text-center py-16 px-4">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-cream-surface dark:bg-white/6 border border-cream-border dark:border-pulse-border backdrop-blur-sm mb-6 shadow-base">
        <Folder className="w-10 h-10 text-text-light-muted dark:text-text-muted" aria-hidden />
      </div>
      <h3 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-2">
        No projects yet
      </h3>
      <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-8 max-w-sm mx-auto">
        Create your first project to get started with AI-powered code generation.
      </p>
      <button
        type="button"
        onClick={onCreateClick}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all focus:outline-none bg-tenant-primary hover:bg-tenant-primary/90 text-tenant-on-primary border border-tenant-primary/40 shadow-sm"
      >
        <Plus className="w-5 h-5" aria-hidden />
        Create Your First Project
      </button>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------

export function ProjectsPage({
  projects,
  isLoading,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
  username,
  onLogout,
}: ProjectsPageProps) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      await onCreateProject(newName.trim(), newDesc.trim() || undefined)
      onSelectProject(newName.trim())
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create project'
      )
    } finally {
      setCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
    if (e.key === 'Escape') {
      setShowCreateForm(false)
      setNewName('')
      setNewDesc('')
      setCreateError(null)
    }
  }

  const resetCreateForm = () => {
    setShowCreateForm(false)
    setNewName('')
    setNewDesc('')
    setCreateError(null)
  }

  return (
    <div className="h-screen flex flex-col bg-cream-bg dark:bg-pulse-bg">
      <ProjectsHeader username={username} onLogout={onLogout} />

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          {/* Title + CTA + view toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-text-light-primary dark:text-text-primary tracking-tight">
                Your Projects
              </h2>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mt-1">
                Select a project to open or create a new one
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!showCreateForm && projects.length > 0 && (
                <div className="flex rounded-lg border border-cream-border dark:border-pulse-border p-0.5 bg-cream-surface dark:bg-pulse-surface" role="tablist" aria-label="View mode">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-tenant-primary/35 focus:ring-offset-1 ${
                      viewMode === 'grid' ? 'bg-cream-surface-light dark:bg-pulse-surface-light text-tenant-primary shadow-sm' : 'text-text-light-secondary hover:text-text-light-primary dark:text-text-secondary dark:hover:text-text-primary'
                    }`}
                    aria-pressed={viewMode === 'grid'}
                    aria-label="Grid view"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-tenant-primary/35 focus:ring-offset-1 ${
                      viewMode === 'list' ? 'bg-cream-surface-light dark:bg-pulse-surface-light text-tenant-primary shadow-sm' : 'text-text-light-secondary hover:text-text-light-primary dark:text-text-secondary dark:hover:text-text-primary'
                    }`}
                    aria-pressed={viewMode === 'list'}
                    aria-label="List view"
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              )}
              {!showCreateForm && (
                <button
                  type="button"
                  onClick={() => setShowCreateForm(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all focus:outline-none shrink-0 bg-tenant-primary hover:bg-tenant-primary/90 text-tenant-on-primary border border-tenant-primary/40 shadow-sm"
                >
                  <Plus className="w-4 h-4" aria-hidden />
                  New project
                </button>
              )}
            </div>
          </div>

          {showCreateForm && (
            <CreateProjectForm
              newName={newName}
              newDesc={newDesc}
              creating={creating}
              createError={createError}
              onNameChange={setNewName}
              onDescChange={setNewDesc}
              onSubmit={handleCreate}
              onCancel={resetCreateForm}
              onKeyDown={handleKeyDown}
            />
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-24" role="status" aria-label="Loading projects">
              <Loader2 className="w-10 h-10 text-tenant-primary animate-spin" aria-hidden />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onCreateClick={() => setShowCreateForm(true)} />
          ) : viewMode === 'list' ? (
            <ul className="space-y-1 list-none p-0 m-0 max-w-3xl">
              {projects.map((project) => (
                <li key={project.name}>
                  <ProjectListRow
                    project={project}
                    onSelect={() => onSelectProject(project.name)}
                    onDelete={() => onDeleteProject(project.name)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 list-none p-0 m-0">
              {projects.map((project) => (
                <li key={project.name}>
                  <ProjectCard
                    project={project}
                    onSelect={() => onSelectProject(project.name)}
                    onDelete={() => onDeleteProject(project.name)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}
