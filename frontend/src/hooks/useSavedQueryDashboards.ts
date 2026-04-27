import { useState, useCallback } from 'react';

const KEY = 'naavik:saved-query-dashboards';

export interface SavedQueryDashboard {
  id: string;
  name: string;
  blocks: any[];
  prompt?: string;
  createdAt: string;
  updatedAt: string;
}

function read(): SavedQueryDashboard[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(items: SavedQueryDashboard[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function useSavedQueryDashboards() {
  const [dashboards, setDashboards] = useState<SavedQueryDashboard[]>(read);

  const save = useCallback((name: string, blocks: any[], prompt?: string): SavedQueryDashboard => {
    const now = new Date().toISOString();
    const item: SavedQueryDashboard = {
      id: `qdb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      blocks,
      prompt,
      createdAt: now,
      updatedAt: now,
    };
    const next = [item, ...read()];
    write(next);
    setDashboards(next);
    return item;
  }, []);

  const remove = useCallback((id: string) => {
    const next = read().filter((d) => d.id !== id);
    write(next);
    setDashboards(next);
  }, []);

  return { dashboards, save, remove };
}
