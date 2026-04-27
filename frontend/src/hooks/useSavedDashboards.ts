/**
 * useSavedDashboards — persists KPI dashboards to localStorage.
 * Each saved dashboard is a named, fully-configured snapshot the user can
 * reopen at any time.
 *
 * Uses a module-level singleton so all hook instances always share the same
 * state — writes from one component are immediately reflected in every other
 * component that calls this hook (within the same tab).
 */
import { useState, useCallback, useEffect } from 'react';

export interface SavedDashboard {
  id: string;
  name: string;
  siteIds: string[];           // one or more sites
  kpiNames: string[];          // [] = all standard KPIs
  timeframe: 'daily' | 'hourly';
  daysBack: number;
  endDate: string;             // YYYY-MM-DD anchor date
  createdAt: string;           // ISO timestamp
  updatedAt: string;
}

const STORAGE_KEY = 'naavik:saved_dashboards_v1';

function load(): SavedDashboard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedDashboard[];
  } catch {
    return [];
  }
}

function persist(dashboards: SavedDashboard[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
  } catch {
    // localStorage full — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton — one source of truth for all hook instances
// ---------------------------------------------------------------------------
let _dashboards: SavedDashboard[] = load();
const _listeners = new Set<(d: SavedDashboard[]) => void>();

function notify(next: SavedDashboard[]) {
  _dashboards = next;
  _listeners.forEach((fn) => fn(next));
}

function mutate(updater: (prev: SavedDashboard[]) => SavedDashboard[]) {
  const next = updater(_dashboards);
  persist(next);
  notify(next);
}

export function useSavedDashboards() {
  const [dashboards, setDashboards] = useState<SavedDashboard[]>(() => _dashboards);

  useEffect(() => {
    // Subscribe to in-tab changes
    _listeners.add(setDashboards);

    // Also keep in sync if another tab writes
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const fresh = load();
        notify(fresh);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      _listeners.delete(setDashboards);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const saveDashboard = useCallback((draft: Omit<SavedDashboard, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const next: SavedDashboard = {
      ...draft,
      id: `db_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    };
    mutate((prev) => [next, ...prev]);
    return next;
  }, []);

  const updateDashboard = useCallback((id: string, patch: Partial<Omit<SavedDashboard, 'id' | 'createdAt'>>) => {
    mutate((prev) =>
      prev.map((d) => d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d)
    );
  }, []);

  const deleteDashboard = useCallback((id: string) => {
    mutate((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const getDashboard = useCallback((id: string) => {
    return dashboards.find((d) => d.id === id) ?? null;
  }, [dashboards]);

  return { dashboards, saveDashboard, updateDashboard, deleteDashboard, getDashboard };
}
