/**
 * Local Events API client.
 *
 * Wraps the `/api/local-events/*` endpoints. All requests are authenticated
 * via the shared `api` instance.
 */
import api from './api';

export type EventCategory =
  | 'concert' | 'sports' | 'conference' | 'festival' | 'school'
  | 'severe-weather' | 'news' | 'public-holiday' | 'observance' | 'other';

export type EventSource =
  | 'ticketmaster' | 'seatgeek' | 'nws' | 'gdelt' | 'nager';

export interface LocalEvent {
  id: string;
  source: EventSource;
  title: string;
  category: EventCategory;
  startsAt: string;
  endsAt?: string;
  venueName?: string;
  lat: number;
  lng: number;
  attendance?: number;
  url?: string;
  distanceMiles?: number;
}

export interface LocalEventsResult {
  usid?: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  events: LocalEvent[];
  count: number;
}

export interface FetchEventsOpts {
  /** YYYY-MM-DD inclusive. Defaults to today. */
  startDate?: string;
  /** YYYY-MM-DD inclusive. Defaults to today + 7d. */
  endDate?: string;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function fetchEventsBySite(
  usid: string,
  radiusMiles = 5,
  opts: FetchEventsOpts = {},
): Promise<LocalEventsResult | null> {
  try {
    const q = buildQuery({ radius: radiusMiles, startDate: opts.startDate, endDate: opts.endDate });
    const resp = await api.get<{ success: boolean; data: LocalEventsResult }>(
      `/local-events/site/${encodeURIComponent(usid)}${q}`,
    );
    return resp?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchEventsByPoint(
  lat: number,
  lng: number,
  radiusMiles = 5,
  opts: FetchEventsOpts = {},
): Promise<LocalEventsResult | null> {
  try {
    const q = buildQuery({
      lat, lng, radius: radiusMiles,
      startDate: opts.startDate, endDate: opts.endDate,
    });
    const resp = await api.get<{ success: boolean; data: { events: LocalEvent[]; count: number } }>(
      `/local-events/near${q}`,
    );
    if (!resp?.data) return null;
    return {
      lat,
      lng,
      radiusMiles,
      events: resp.data.events,
      count: resp.data.count,
    };
  } catch {
    return null;
  }
}

export async function fetchActiveProviders(): Promise<EventSource[]> {
  try {
    const resp = await api.get<{ success: boolean; data: { providers: EventSource[] } }>(
      '/local-events/providers',
    );
    return resp?.data?.providers ?? [];
  } catch {
    return [];
  }
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

export const CATEGORY_COLOR: Record<EventCategory, string> = {
  concert: '#a855f7',
  sports: '#f97316',
  conference: '#0ea5e9',
  festival: '#ec4899',
  school: '#10b981',
  'severe-weather': '#ef4444',
  news: '#64748b',
  'public-holiday': '#f59e0b',
  observance: '#94a3b8',
  other: '#6b7280',
};

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  concert: 'Concert',
  sports: 'Sports',
  conference: 'Conference',
  festival: 'Festival',
  school: 'School',
  'severe-weather': 'Weather',
  news: 'News',
  'public-holiday': 'Holiday',
  observance: 'Observance',
  other: 'Other',
};

export function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
