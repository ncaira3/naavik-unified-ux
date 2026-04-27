import { ArrowLeft, Sparkles, FolderOpen, RefreshCw, LogOut, User } from 'lucide-react'

interface HeaderProps {
  projectName: string
  onBack: () => void
  onRefresh: () => void
  isRefreshing?: boolean
  username?: string
  onLogout?: () => void
}

export function Header({
  projectName,
  onBack,
  onRefresh,
  isRefreshing = false,
  username,
  onLogout,
}: HeaderProps) {
  return (
    <header className="h-14 border-b border-border bg-[linear-gradient(to_right,_#0f172a,_#111827_40%,_#1e293b)] text-white flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 p-1.5 rounded-md text-text-muted hover:text-white hover:bg-white/10 transition-colors"
          title="Back to Projects"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-400/15 border border-sky-300/20">
            <Sparkles className="w-4 h-4 text-sky-300" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-[0.18em] uppercase text-text-muted">AppGen v2</span>
            <span className="font-semibold text-base">Intent Workspace</span>
          </div>
        </div>

        <span className="text-text-secondary">|</span>

        <div className="hidden md:flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1">
          <FolderOpen className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-white">{projectName}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-text-muted hover:text-white hover:bg-white/10 transition-colors disabled:opacity-60"
          title="Refresh everything"
        >
          <RefreshCw className={`w-4 h-4 transition-transform ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>

        {username && (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-white/10">
            <User className="w-4 h-4 text-text-muted" />
            <span className="text-sm text-text-primary">{username}</span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1 px-2 py-1 rounded text-sm text-text-muted hover:text-white hover:bg-white/10 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
