/**
 * useLocalEvents — flexible events hook for the map.
 *
 * Two anchor modes:
 *   1. site mode  — pass `usid`. Backend resolves lat/lng from site_table.
 *   2. point mode — pass `{ lat, lng }`. Used when no site is selected and the
 *                   user wants to browse events around the current map centre.
 *
 * Plus a date range (startDate / endDate, YYYY-MM-DD inclusive). Defaults to
 * today → today + 7 days when omitted.
 *
 * Debounced 250 ms so dragging the radius slider or scrubbing the date doesn't
 * blast the backend.
 */
import { useEffect, useRef, useState } from 'react';
import {
  fetchEventsBySite,
  fetchEventsByPoint,
  type LocalEvent,
} from '../../services/localEvents';

export interface UseLocalEventsArgs {
  usid?: string | null;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusMiles: number;
  startDate?: string;
  endDate?: string;
  enabled: boolean;
}

interface State {
  loading: boolean;
  events: LocalEvent[];
  centerLat: number | null;
  centerLng: number | null;
  error: string | null;
}

export function useLocalEvents(args: UseLocalEventsArgs): State {
  const [state, setState] = useState<State>({
    loading: false,
    events: [],
    centerLat: null,
    centerLng: null,
    error: null,
  });
  const requestId = useRef(0);

  const {
    usid,
    centerLat,
    centerLng,
    radiusMiles,
    startDate,
    endDate,
    enabled,
  } = args;

  // Sub-stringify the inputs so the effect depends on stable primitives.
  const usidKey = usid ?? '';
  const latKey = centerLat ?? '';
  const lngKey = centerLng ?? '';

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, events: [], centerLat: null, centerLng: null, error: null });
      return;
    }
    const haveSite = !!usid;
    const havePoint = Number.isFinite(centerLat as number) && Number.isFinite(centerLng as number);
    if (!haveSite && !havePoint) {
      setState({ loading: false, events: [], centerLat: null, centerLng: null, error: null });
      return;
    }

    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const result = haveSite
          ? await fetchEventsBySite(String(usid), radiusMiles, { startDate, endDate })
          : await fetchEventsByPoint(
              Number(centerLat), Number(centerLng), radiusMiles, { startDate, endDate },
            );
        if (id !== requestId.current) return; // stale
        if (!result) {
          setState({
            loading: false,
            events: [],
            centerLat: null,
            centerLng: null,
            error: 'Could not load events.',
          });
          return;
        }
        setState({
          loading: false,
          events: result.events,
          centerLat: result.lat,
          centerLng: result.lng,
          error: null,
        });
      } catch (err) {
        if (id !== requestId.current) return;
        setState({
          loading: false,
          events: [],
          centerLat: null,
          centerLng: null,
          error: (err as Error)?.message ?? 'Unknown error',
        });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [enabled, usidKey, latKey, lngKey, radiusMiles, startDate, endDate, usid, centerLat, centerLng]);

  return state;
}
