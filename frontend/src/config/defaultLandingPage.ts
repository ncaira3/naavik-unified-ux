/**
 * Default landing page on login.
 *
 * The user picks from a small whitelist in Settings → Appearance. The choice is
 * persisted in localStorage and read once on every login so the next session
 * lands on the same view.
 *
 * To add a new option: extend `LANDING_OPTIONS` with the option's viewId
 * (must match an entry in the platform app registry) and a user-facing label.
 */

const STORAGE_KEY = 'naavik_default_landing_page';

export interface LandingOption {
  viewId: string;       // matches AppRegistryEntry.id
  label: string;        // shown in Settings
  description: string;  // 1-line hint
}

export const LANDING_OPTIONS: LandingOption[] = [
  { viewId: 'home',    label: 'Naavik Chat',    description: 'Universal chat-driven home page' },
  { viewId: 'observe', label: 'Naavik Observe', description: 'Network map, RCA, telemetry dashboards' },
  { viewId: 'appgen',  label: 'Naavik AppGen',  description: 'AI-powered rApp builder' },
];

export const DEFAULT_LANDING = 'home';

const VALID_IDS = new Set(LANDING_OPTIONS.map((o) => o.viewId));

/** Read the user's saved default landing page id; falls back to `home`. */
export function getDefaultLandingPage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_IDS.has(stored)) return stored;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_LANDING;
}

/** Persist the user's default landing page choice. No-op if the id is unknown. */
export function setDefaultLandingPage(viewId: string): void {
  if (!VALID_IDS.has(viewId)) return;
  try { localStorage.setItem(STORAGE_KEY, viewId); } catch { /* no-op */ }
}
