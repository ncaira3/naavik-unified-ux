import { useEffect, useState } from 'react';
import type { AppRegistryEntry } from './types';
import { DEFAULT_REGISTRY, LAZY_COMPONENTS } from './appRegistry';
import api from '../services/api';

/**
 * Merge the backend-fetched registry with the frontend DEFAULT_REGISTRY so
 * newly added apps stay visible even if the backend DB has not been re-seeded.
 *
 * Rules:
 *  - For ids present in BOTH lists, the backend entry wins (it carries
 *    user-permission and admin-toggled state).
 *  - For ids only in DEFAULT_REGISTRY, keep the default entry — but ONLY if a
 *    matching lazy loader is registered, so we never try to mount an internal
 *    app the build doesn't ship.
 *  - For ids only on the backend, keep the backend entry (federated/iframe).
 *  - Ordering uses `order` ascending, falling back to insertion order.
 */
function mergeRegistry(remote: AppRegistryEntry[]): AppRegistryEntry[] {
  const byId = new Map<string, AppRegistryEntry>();
  for (const entry of DEFAULT_REGISTRY) {
    // Drop default-only internal apps the build cannot mount
    if (entry.containerType === 'internal' && entry.internalKey && !LAZY_COMPONENTS[entry.internalKey]) {
      continue;
    }
    byId.set(entry.id, entry);
  }
  for (const entry of remote) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

export function useAppRegistry() {
  const [registry, setRegistry] = useState<AppRegistryEntry[]>(DEFAULT_REGISTRY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistry = async () => {
    try {
      setIsLoading(true);
      setError(null);
      console.log('[useAppRegistry] Fetching registry from /platform/registry');
      const response = await api.get<AppRegistryEntry[]>('/platform/registry');
      console.log('[useAppRegistry] Response received:', response);

      if (response) {
        const registryData = Array.isArray(response) ? response : (response as any).data || [];
        const merged = mergeRegistry(registryData);
        console.log('[useAppRegistry] Setting merged registry:', merged);
        setRegistry(merged);
      } else {
        console.warn('[useAppRegistry] Response is empty, using DEFAULT_REGISTRY');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch app registry';
      console.warn('[useAppRegistry] Fetch failed, falling back to default registry:', message);
      console.warn('[useAppRegistry] Error details:', err);
      setError(message);
      // Keep using DEFAULT_REGISTRY on error
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch on mount
  useEffect(() => {
    fetchRegistry();
  }, []);

  // Re-fetch when window comes into focus
  useEffect(() => {
    const handleFocus = () => {
      fetchRegistry();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  return { registry, isLoading, error };
}
