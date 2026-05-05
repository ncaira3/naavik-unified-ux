import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MARKETS, getMarketById, type MarketDef } from '../config/markets';

const STORAGE_KEY = 'naavik_market';

interface MarketContextValue {
  /** The currently-selected market, or null if the user hasn't picked one yet. */
  market: MarketDef | null;
  /** Convenience: raw MARKET strings to use in SQL/API filters. */
  dbValues: string[];
  /** All markets (selectable + disabled). */
  available: MarketDef[];
  /** Set selection by id; persists to localStorage. */
  setMarket: (id: string) => void;
  /** True until we've checked localStorage on first mount. */
  ready: boolean;
  /** True if there is no persisted selection (used to trigger first-time prompt). */
  needsSelection: boolean;
  /** Open the selector again to switch markets. */
  promptForMarket: () => void;
  /** Whether the selector modal is currently open. */
  selectorOpen: boolean;
  closeSelector: () => void;
}

const MarketContext = createContext<MarketContextValue | undefined>(undefined);

export function MarketProvider({ children }: { children: ReactNode }) {
  const [marketId, setMarketId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && getMarketById(stored)?.available) {
        setMarketId(stored);
      }
    } catch { /* localStorage unavailable */ }
    setReady(true);
  }, []);

  const setMarket = useCallback((id: string) => {
    const m = getMarketById(id);
    if (!m || !m.available) return;
    setMarketId(id);
    setSelectorOpen(false);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* no-op */ }
  }, []);

  const promptForMarket = useCallback(() => setSelectorOpen(true), []);
  const closeSelector = useCallback(() => setSelectorOpen(false), []);

  const market = useMemo(() => getMarketById(marketId) ?? null, [marketId]);
  const dbValues = useMemo(() => market?.dbValues ?? [], [market]);
  const needsSelection = ready && !market;

  const value = useMemo<MarketContextValue>(() => ({
    market,
    dbValues,
    available: MARKETS,
    setMarket,
    ready,
    needsSelection,
    promptForMarket,
    selectorOpen,
    closeSelector,
  }), [market, dbValues, setMarket, ready, needsSelection, promptForMarket, selectorOpen, closeSelector]);

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used inside MarketProvider');
  return ctx;
}
