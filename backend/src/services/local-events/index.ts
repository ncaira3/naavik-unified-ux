/**
 * Local Events Aggregator — free / public sources only.
 *
 * Given a lat/lng + radius (miles), returns concerts, sports, severe-weather
 * alerts, news, and holidays inside the radius. Results are cached in Postgres
 * for 6 hours per (lat, lng, radius, day) bucket so we don't hammer the
 * upstream APIs.
 *
 * Sources (all free):
 *   - Ticketmaster Discovery   (env: TICKETMASTER_API_KEY)        concerts/sports/theater
 *   - SeatGeek                 (env: SEATGEEK_CLIENT_ID)          concerts/sports/theater
 *   - NWS (weather.gov)        no key                             severe-weather alerts
 *   - GDELT Doc 2.0            no key                             geocoded breaking news
 *   - Nager.Date               no key                             US public holidays
 *
 * Each adapter degrades silently if its key is missing — the feature still
 * works with only the keyless sources.
 */
import { pool } from '../../config/database.js';
import { logger } from '../../utils/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

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
  startsAt: string;          // ISO
  endsAt?: string;
  venueName?: string;
  lat: number;
  lng: number;
  attendance?: number;
  url?: string;
  distanceMiles?: number;
}

export interface FindOpts {
  lat: number;
  lng: number;
  radiusMiles?: number;
  startDate?: string;
  endDate?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.756;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function defaults(opts: FindOpts) {
  const radius = Math.min(50, Math.max(0.5, opts.radiusMiles ?? 5));
  const startDate = opts.startDate ?? new Date().toISOString().slice(0, 10);
  const endDate =
    opts.endDate ?? new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  return { radius, startDate, endDate };
}

// ─── Cache ──────────────────────────────────────────────────────────────────

let cacheTableReady = false;

export async function ensureLocalEventsCacheTable(): Promise<void> {
  if (cacheTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS local_events_cache (
      cache_key TEXT PRIMARY KEY,
      events JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_local_events_fetched ON local_events_cache (fetched_at);
  `);
  cacheTableReady = true;
}

function cacheKey(o: FindOpts): string {
  const d = defaults(o);
  return [o.lat.toFixed(3), o.lng.toFixed(3), d.radius, d.startDate, d.endDate].join('|');
}

async function readCache(key: string): Promise<LocalEvent[] | null> {
  try {
    const r = await pool.query(
      `SELECT events FROM local_events_cache
       WHERE cache_key = $1 AND fetched_at > NOW() - interval '6 hours'`,
      [key],
    );
    return r.rowCount ? (r.rows[0].events as LocalEvent[]) : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, events: LocalEvent[]): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO local_events_cache (cache_key, events, fetched_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (cache_key) DO UPDATE
       SET events = EXCLUDED.events, fetched_at = NOW()`,
      [key, JSON.stringify(events)],
    );
  } catch (err) {
    logger.warn('[local-events] cache write failed', err);
  }
}

// ─── Adapters ───────────────────────────────────────────────────────────────

const UA = 'NaavikUnifiedUX/1.0 (ops@aira-technology.com)';

async function fetchTicketmaster(opts: FindOpts): Promise<LocalEvent[]> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const { radius, startDate, endDate } = defaults(opts);
  const params = new URLSearchParams({
    apikey: key,
    latlong: `${opts.lat},${opts.lng}`,
    radius: String(radius),
    unit: 'miles',
    startDateTime: `${startDate}T00:00:00Z`,
    endDateTime: `${endDate}T23:59:59Z`,
    size: '100',
    sort: 'date,asc',
  });
  try {
    const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { _embedded?: { events?: any[] } };
    const events = json._embedded?.events ?? [];
    const tmCat = (segment?: string): EventCategory =>
      segment === 'Music' ? 'concert' :
      segment === 'Sports' ? 'sports' :
      segment === 'Arts & Theatre' ? 'festival' :
      'other';
    return events
      .map((e): LocalEvent | null => {
        const venue = e._embedded?.venues?.[0];
        const lat = Number(venue?.location?.latitude);
        const lng = Number(venue?.location?.longitude);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        const cap = Number(venue?.generalInfo?.capacity);
        return {
          id: `ticketmaster:${e.id}`,
          source: 'ticketmaster',
          title: e.name,
          category: tmCat(e.classifications?.[0]?.segment?.name),
          startsAt: e.dates?.start?.dateTime ?? `${e.dates?.start?.localDate}T00:00:00Z`,
          venueName: venue?.name,
          lat,
          lng,
          attendance: isFinite(cap) ? cap : undefined,
          url: e.url,
        };
      })
      .filter((e): e is LocalEvent => e !== null);
  } catch (err) {
    logger.warn('[local-events] ticketmaster fetch failed', err);
    return [];
  }
}

async function fetchSeatGeek(opts: FindOpts): Promise<LocalEvent[]> {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) return [];
  const { radius, startDate, endDate } = defaults(opts);
  const params = new URLSearchParams({
    client_id: clientId,
    lat: String(opts.lat),
    lon: String(opts.lng),
    range: `${radius}mi`,
    'datetime_utc.gte': `${startDate}T00:00:00`,
    'datetime_utc.lte': `${endDate}T23:59:59`,
    per_page: '50',
    sort: 'datetime_utc.asc',
  });
  try {
    const res = await fetch(`https://api.seatgeek.com/2/events?${params}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { events?: any[] };
    const sgCat = (t?: string): EventCategory =>
      !t ? 'other' :
      t.includes('concert') || t === 'music_festival' ? 'concert' :
      t === 'theater' ? 'festival' :
      t === 'comedy' ? 'concert' :
      'sports';
    return (json.events ?? [])
      .map((e): LocalEvent | null => {
        const lat = Number(e.venue?.location?.lat);
        const lng = Number(e.venue?.location?.lon);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        const cap = Number(e.venue?.capacity);
        return {
          id: `seatgeek:${e.id}`,
          source: 'seatgeek',
          title: e.title,
          category: sgCat(e.type),
          startsAt: (e.datetime_utc as string) + 'Z',
          venueName: e.venue?.name,
          lat,
          lng,
          attendance:
            typeof e.score === 'number' && isFinite(cap)
              ? Math.round(e.score * cap)
              : isFinite(cap) ? cap : undefined,
          url: e.url,
        };
      })
      .filter((e): e is LocalEvent => e !== null);
  } catch (err) {
    logger.warn('[local-events] seatgeek fetch failed', err);
    return [];
  }
}

async function fetchNws(opts: FindOpts): Promise<LocalEvent[]> {
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${opts.lat},${opts.lng}`,
      { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: any[] };
    return (json.features ?? []).map((f): LocalEvent => ({
      id: `nws:${f.properties.id}`,
      source: 'nws',
      title: f.properties.headline ?? f.properties.event,
      category: 'severe-weather',
      startsAt: f.properties.onset ?? f.properties.sent,
      endsAt: f.properties.ends ?? f.properties.expires,
      venueName: f.properties.senderName,
      lat: opts.lat,
      lng: opts.lng,
      url: f.properties.uri,
    }));
  } catch (err) {
    logger.warn('[local-events] nws fetch failed', err);
    return [];
  }
}

async function fetchGdelt(opts: FindOpts): Promise<LocalEvent[]> {
  const { radius } = defaults(opts);
  const params = new URLSearchParams({
    query: `near:${opts.lat},${opts.lng},${radius}mi`,
    mode: 'ArtList',
    maxrecords: '30',
    format: 'json',
    sort: 'datedesc',
    timespan: '48h',
  });
  try {
    const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { articles?: any[] };
    return (json.articles ?? [])
      .map((a): LocalEvent | null => {
        const lat = Number(a.geo?.lat);
        const lng = Number(a.geo?.lng);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        return {
          id: `gdelt:${a.url}`,
          source: 'gdelt',
          title: a.title,
          category: 'news',
          startsAt: a.seendate ?? new Date().toISOString(),
          lat,
          lng,
          url: a.url,
        };
      })
      .filter((e): e is LocalEvent => e !== null);
  } catch (err) {
    logger.warn('[local-events] gdelt fetch failed', err);
    return [];
  }
}

async function fetchHolidays(opts: FindOpts): Promise<LocalEvent[]> {
  const { startDate, endDate } = defaults(opts);
  const year = startDate.slice(0, 4);
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/US`);
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{ date: string; localName: string; name: string }>;
    return json
      .filter((h) => h.date >= startDate && h.date <= endDate)
      .map((h): LocalEvent => ({
        id: `nager:${h.date}-${h.name}`,
        source: 'nager',
        title: `${h.localName} (US public holiday)`,
        category: 'public-holiday',
        startsAt: `${h.date}T00:00:00Z`,
        endsAt: `${h.date}T23:59:59Z`,
        lat: opts.lat,
        lng: opts.lng,
      }));
  } catch (err) {
    logger.warn('[local-events] nager fetch failed', err);
    return [];
  }
}

// ─── Aggregator ─────────────────────────────────────────────────────────────

export async function findLocalEvents(opts: FindOpts): Promise<LocalEvent[]> {
  if (!isFinite(opts.lat) || !isFinite(opts.lng)) return [];
  await ensureLocalEventsCacheTable();
  const key = cacheKey(opts);
  const cached = await readCache(key);
  if (cached) {
    logger.info(`[local-events] cache HIT for ${key} · ${cached.length} events`);
    return cached;
  }

  const t0 = Date.now();
  const results = await Promise.allSettled([
    fetchTicketmaster(opts),
    fetchSeatGeek(opts),
    fetchNws(opts),
    fetchGdelt(opts),
    fetchHolidays(opts),
  ]);

  const all: LocalEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  const { radius } = defaults(opts);
  const enriched = all
    .map((e) => ({
      ...e,
      distanceMiles: haversineMiles(opts.lat, opts.lng, e.lat, e.lng),
    }))
    .filter((e) => e.distanceMiles <= radius);

  // Dedupe by (lowercased-title + day + category) — providers double-list.
  // Prefer the record with attendance set; fall back to first-seen.
  const byKey = new Map<string, LocalEvent>();
  for (const e of enriched) {
    const dedupeKey = `${e.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${e.startsAt.slice(0, 10)}|${e.category}`;
    const existing = byKey.get(dedupeKey);
    if (!existing) byKey.set(dedupeKey, e);
    else if ((e.attendance ?? 0) > (existing.attendance ?? 0)) byKey.set(dedupeKey, e);
  }

  const out = Array.from(byKey.values()).sort((a, b) => {
    const t = a.startsAt.localeCompare(b.startsAt);
    return t !== 0 ? t : (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0);
  });

  await writeCache(key, out);
  logger.info(
    `[local-events] ${out.length} events near (${opts.lat.toFixed(3)},${opts.lng.toFixed(3)}) · ${Date.now() - t0}ms`,
  );
  return out;
}

export function getActiveProviders(): EventSource[] {
  const active: EventSource[] = ['nws', 'gdelt', 'nager'];
  if (process.env.TICKETMASTER_API_KEY) active.push('ticketmaster');
  if (process.env.SEATGEEK_CLIENT_ID) active.push('seatgeek');
  return active;
}
