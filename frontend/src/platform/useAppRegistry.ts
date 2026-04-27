import { useEffect, useState } from 'react';
import type { AppRegistryEntry } from './types';
import { DEFAULT_REGISTRY } from './appRegistry';
import api from '../services/api';

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
        console.log('[useAppRegistry] Setting registry:', registryData);
        setRegistry(registryData);
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
