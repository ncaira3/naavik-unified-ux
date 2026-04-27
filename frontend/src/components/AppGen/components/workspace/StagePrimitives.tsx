import type { ComponentType, ReactNode } from 'react'

export function StageSurface({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.08),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.92)_0%,_rgba(255,255,255,0.98)_100%)]">
      {children}
    </div>
  )
}

export function StageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-white/90 px-4 py-4 backdrop-blur-sm">
      <div className="flex w-full items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-cream-bg">
            <Icon className="h-5 w-5 text-text-secondary" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-text-primary">{title}</h2>
            <p className="mt-1 text-sm text-text-muted">{description}</p>
          </div>
        </div>
        {actions}
      </div>
    </div>
  )
}

export function StageBody({ children }: { children: ReactNode }) {
  return <div className="w-full space-y-4 px-4 py-5">{children}</div>
}

export function StageCard({
  title,
  eyebrow,
  actions,
  children,
  flat = false,
}: {
  title?: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  /** When true, no rounded border/shadow — blends with parent (avoids box-in-box). */
  flat?: boolean
}) {
  const sectionClass = flat
    ? 'h-full min-h-0 flex flex-col bg-transparent'
    : 'overflow-hidden rounded-[24px] border border-slate-200/90 bg-white/92 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-sm'

  const headerClass = flat
    ? 'flex items-start justify-between gap-4 border-b border-border px-4 py-3 flex-shrink-0 bg-slate-50/80'
    : 'flex items-start justify-between gap-4 border-b border-border px-5 py-4'

  const bodyClass = flat ? 'flex-1 min-h-0 p-0' : 'p-5'

  return (
    <section className={sectionClass}>
      {(title || eyebrow || actions) && (
        <div className={headerClass}>
          <div>
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{eyebrow}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function StageEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="h-full bg-[linear-gradient(180deg,_rgba(248,250,252,0.9)_0%,_rgba(255,255,255,0.96)_100%)] p-4">
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-white/80 px-6 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cream-surface-light">
          {Icon ? <Icon className="h-8 w-8 text-text-muted" /> : <div className="h-8 w-8 rounded-xl bg-slate-300/70" />}
        </span>
        <p className="text-base font-semibold text-text-primary">{title}</p>
        <p className="mt-2 max-w-md text-sm text-text-muted">{description}</p>
      </div>
    </div>
  )
}

export function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'warning'
      ? 'border-amber-200 bg-amber-50'
      : tone === 'danger'
      ? 'border-red-200 bg-red-50'
      : 'border-border bg-cream-surface'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold text-text-primary">{value}</p>
    </div>
  )
}

export function ArtifactSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-xs text-text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}
