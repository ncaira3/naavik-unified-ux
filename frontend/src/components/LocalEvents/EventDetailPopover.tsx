/**
 * EventDetailPopover — floating card with full event details, anchored to a
 * screen coordinate. Rendered via portal so the map's overflow can't clip it.
 *
 * The map gives us the screen position of the active marker through Mapbox's
 * `project()` API; this component is purely presentational.
 */
import { createPortal } from 'react-dom';
import { CalendarClock, MapPin, Users, ExternalLink, AlertTriangle } from 'lucide-react';
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  formatEventTime,
  type LocalEvent,
} from '../../services/localEvents';

interface Props {
  event: LocalEvent | null;
  anchor: { x: number; y: number } | null;
}

export default function EventDetailPopover({ event, anchor }: Props) {
  if (!event || !anchor) return null;

  const color = CATEGORY_COLOR[event.category] ?? '#6b7280';
  // Keep within viewport — clamp 8px from any edge
  const padX = 8;
  const padY = 8;
  const cardW = 280;
  const cardH = 180;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Default position: above the marker
  let left = anchor.x - cardW / 2;
  let top = anchor.y - cardH - 16;
  if (top < padY) {
    // No room above — flip below
    top = anchor.y + 16;
  }
  left = Math.max(padX, Math.min(vw - cardW - padX, left));
  top = Math.max(padY, Math.min(vh - cardH - padY, top));

  return createPortal(
    <div
      className="fixed pointer-events-none z-[1000]"
      style={{ left, top, width: cardW }}
    >
      <div className="pointer-events-auto rounded-xl border border-border bg-cream-bg/96 p-3 shadow-2xl backdrop-blur-sm dark:border-pulse-border dark:bg-pulse-surface/96">
        <div className="mb-1 flex items-baseline gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white"
            style={{ background: color }}
          >
            {CATEGORY_LABEL[event.category]}
          </span>
          {event.category === 'severe-weather' ? (
            <AlertTriangle className="h-3 w-3 text-red-500" strokeWidth={2.4} />
          ) : null}
          {event.distanceMiles != null ? (
            <span className="ml-auto text-[10.5px] text-text-muted">
              {event.distanceMiles.toFixed(1)} mi
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-text-primary">
          {event.title}
        </p>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-text-secondary">
          <p className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            {formatEventTime(event.startsAt)}
          </p>
          {event.venueName ? (
            <p className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{event.venueName}</span>
            </p>
          ) : null}
          {event.attendance ? (
            <p className="flex items-center gap-1">
              <Users className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              ~{event.attendance.toLocaleString()} attendees
            </p>
          ) : null}
        </div>
        {event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
          >
            View source <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.4} />
          </a>
        ) : null}
        <p className="mt-1.5 text-[9.5px] uppercase tracking-[0.06em] text-text-muted">
          {event.source}
        </p>
      </div>
    </div>,
    document.body,
  );
}
