import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dummifyId, dummifyText, transformUsid } from '../utils/dummifier';

const STORAGE_KEY = 'naavik_dummifier_enabled';

interface DummifierContextValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  toggle: () => void;
  /** Mask a single real USID → UST###### (no-op when disabled). */
  dId: (id: string | number | null | undefined) => string;
  /** Mask free-form text (replaces "USID 9817" → "Site UST#######" etc.). */
  dText: (text: string) => string;
  /**
   * Register a batch of real USIDs so the reverse map (UST → real) stays current.
   * Called by MapDataContext as sites load.
   */
  registerRealIds: (ids: Iterable<string | number | null | undefined>) => void;
  /**
   * Reverse: given a UST###### token, return the real USID (or the input unchanged
   * if we've never seen it, or if dummifier is disabled).
   */
  unmapId: (maskedOrReal: string | number | null | undefined) => string;
  /**
   * Reverse a whole string: swap every `UST######` token with the matching real USID.
   * Use this right before sending user-typed prompts to the backend so demo-mode
   * users can freely reference the masked IDs they see on screen.
   */
  unmapText: (text: string) => string;
}

const DummifierContext = createContext<DummifierContextValue | undefined>(undefined);

const UST_TOKEN_RE = /\bUST\d{4,8}\b/g;

export function DummifierProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {}
  }, [enabled]);

  // Reverse lookup: UST###### -> real USID. Kept in a ref so registering new
  // IDs doesn't cause consumers to re-render every time sites load.
  const reverseMapRef = useRef<Map<string, string>>(new Map());
  const seenRealIdsRef = useRef<Set<string>>(new Set());
  // Bumps when the map changes so we can expose a stable identity for memo
  // dependencies that care (e.g. prompt suggestions).
  const [_reverseVersion, setReverseVersion] = useState(0);

  const registerRealIds = useCallback((ids: Iterable<string | number | null | undefined>) => {
    let changed = false;
    for (const raw of ids) {
      if (raw === null || raw === undefined) continue;
      const real = String(raw);
      if (!real) continue;
      if (seenRealIdsRef.current.has(real)) continue;
      seenRealIdsRef.current.add(real);
      const masked = transformUsid(real);
      // Only register if transform actually produced a UST###### form.
      if (/^UST\d{4,8}$/.test(masked)) {
        reverseMapRef.current.set(masked, real);
        changed = true;
      }
    }
    if (changed) setReverseVersion((v) => v + 1);
  }, []);

  const unmapId = useCallback((masked: string | number | null | undefined): string => {
    if (masked === null || masked === undefined) return '';
    const s = String(masked);
    if (!enabled) return s;
    const m = s.match(/^UST\d{4,8}$/);
    if (!m) return s;
    return reverseMapRef.current.get(s) ?? s;
  }, [enabled]);

  const unmapText = useCallback((text: string): string => {
    if (!enabled || !text) return text;
    return text.replace(UST_TOKEN_RE, (tok) => reverseMapRef.current.get(tok) ?? tok);
  }, [enabled]);

  const setEnabled = useCallback((v: boolean) => setEnabledState(v), []);
  const toggle = useCallback(() => setEnabledState((p) => !p), []);

  const value = useMemo<DummifierContextValue>(() => ({
    enabled,
    setEnabled,
    toggle,
    dId: (id) => dummifyId(id, enabled),
    dText: (text) => dummifyText(text, enabled),
    registerRealIds,
    unmapId,
    unmapText,
  }), [enabled, setEnabled, toggle, registerRealIds, unmapId, unmapText]);

  return <DummifierContext.Provider value={value}>{children}</DummifierContext.Provider>;
}

export function useDummifier(): DummifierContextValue {
  const ctx = useContext(DummifierContext);
  if (!ctx) {
    return {
      enabled: false,
      setEnabled: () => {},
      toggle: () => {},
      dId: (id) => (id === null || id === undefined ? '' : String(id)),
      dText: (text) => text,
      registerRealIds: () => {},
      unmapId: (id) => (id === null || id === undefined ? '' : String(id)),
      unmapText: (text) => text,
    };
  }
  return ctx;
}
