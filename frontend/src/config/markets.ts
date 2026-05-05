/**
 * Market configuration — single source of truth.
 *
 * Each market maps to one or more raw `MARKET` values in the remote MSSQL
 * `site_table`. Add new markets here only; UI and queries pull from this list.
 */

export interface MarketDef {
  id: string;
  label: string;
  /** Raw MARKET strings in site_table that belong to this market. */
  dbValues: string[];
  /** When false, the option is shown but not selectable (e.g. dataset not loaded yet). */
  available: boolean;
}

export const MARKETS: MarketDef[] = [
  {
    id: 'norcal',
    label: 'Northern California',
    dbValues: ['CASA', 'CASF'],
    available: true,
  },
  // Future markets — visible but disabled until data is loaded
  { id: 'socal', label: 'Southern California', dbValues: [], available: false },
  { id: 'pnw', label: 'Pacific Northwest', dbValues: [], available: false },
  { id: 'tx', label: 'Texas', dbValues: [], available: false },
  { id: 'ne', label: 'Northeast', dbValues: [], available: false },
];

export const DEFAULT_MARKET_ID = 'norcal';

export function getMarketById(id: string | null | undefined): MarketDef | undefined {
  if (!id) return undefined;
  return MARKETS.find((m) => m.id === id);
}
