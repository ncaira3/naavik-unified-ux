/**
 * useSiteEvents — small hook that fetches local events for a given USID +
 * radius, with debouncing on radius changes so dragging the slider doesn't
 * blast the backend.
 */
import { useEffect, useRef, useState } from 'react';
import { fetchEventsBySite, type LocalEvent } from '../../services/localEvents';

interface State {
  loading: boolean;
  events: LocalEvent[];
  centerLat: number | null;
  centerLng: number | null;
  error: string | null;
}

export function useSiteEvents(
  usid: string | null,
  radiusMiles: number,
  enabled: boolean,
): State {
  const [state, setState] = useState<State>({
    loading: false,
    events: [],
    centerLat: null,
    centerLng: null,
    error: null,
  });
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || !usid) {
      setState({ loading: false, events: [], centerLat: null, centerLng: null, error: null });
      return;
    }
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      const result = await fetchEventsBySite(usid, radiusMiles);
      if (id !== requestId.current) return; // stale
      if (!result) {
        setState({
          loading: false,
          events: [],
          centerLat: null,
          centerLng: null,
          error: 'Could not load events for this site.',
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
    }, 250);
    return () => clearTimeout(timer);
  }, [usid, radiusMiles, enabled]);

  return state;
}
