interface TicketEscalationCardProps {
  data: {
    siteId: string;
    neighborSiteId: string;
    ticketId: string;
    previousStatus: string;
    updatedStatus: string;
    previousPriority: string;
    updatedPriority: string;
    comment: string;
    updatedAt: string;
  };
}

export default function TicketEscalationCard({ data }: TicketEscalationCardProps) {
  return (
    <div className="mt-3 rounded-xl border border-border dark:border-slate-700 bg-white/75 dark:bg-slate-900/35 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-text-secondary dark:text-slate-300 mb-2">
        Ticket Escalation
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-border dark:border-slate-700 bg-white/80 dark:bg-slate-900/45 p-3">
          <div className="text-xs text-text-secondary dark:text-slate-300 mb-1">Impacted Site</div>
          <div className="font-semibold text-text-primary dark:text-white">{data.siteId}</div>
        </div>
        <div className="rounded-lg border border-border dark:border-slate-700 bg-white/80 dark:bg-slate-900/45 p-3">
          <div className="text-xs text-text-secondary dark:text-slate-300 mb-1">Outage Neighbor</div>
          <div className="font-semibold text-text-primary dark:text-white">{data.neighborSiteId}</div>
        </div>
        <div className="rounded-lg border border-border dark:border-slate-700 bg-white/80 dark:bg-slate-900/45 p-3">
          <div className="text-xs text-text-secondary dark:text-slate-300 mb-1">Ticket</div>
          <div className="font-semibold text-text-primary dark:text-white">{data.ticketId}</div>
        </div>
        <div className="rounded-lg border border-border dark:border-slate-700 bg-white/80 dark:bg-slate-900/45 p-3">
          <div className="text-xs text-text-secondary dark:text-slate-300 mb-1">Status / Priority</div>
          <div className="font-semibold text-text-primary dark:text-white">
            {data.previousStatus} ({data.previousPriority}) → {data.updatedStatus} ({data.updatedPriority})
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-border dark:border-slate-700 bg-white/80 dark:bg-slate-900/45 p-3">
        <div className="text-xs uppercase tracking-[0.14em] text-text-secondary dark:text-slate-300 mb-1">Escalation Comment</div>
        <div className="text-sm text-text-primary dark:text-slate-200">{data.comment}</div>
      </div>
      <div className="mt-2 text-xs text-text-secondary dark:text-slate-300">
        Updated at {data.updatedAt}
      </div>
    </div>
  );
}
