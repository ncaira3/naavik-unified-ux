import { lazy } from 'react';
import type { AppRegistryEntry } from './types';

// Internal app loader map — the ONLY place that knows about internal component paths
const INTERNAL_LOADERS: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {
  home:        () => import('../components/HomeView'),
  observe:     () => import('../components/ObserveView'),
  appgen:      () => import('../components/AppGen/AppGenWrapper'),
  provision:   () => import('../components/ProvisioningView'),
  docs:        () => import('../components/Docs/DocsView'),
  settings:    () => import('../components/SettingsPageView'),
};

export const LAZY_COMPONENTS: Record<string, React.LazyExoticComponent<any>> =
  Object.fromEntries(
    Object.entries(INTERNAL_LOADERS).map(([key, loader]) => [key, lazy(loader)])
  );

// Default registry — in Stage 2 this is replaced by a backend fetch
export const DEFAULT_REGISTRY: AppRegistryEntry[] = [
  {
    id: 'home',
    displayName: 'Home',
    iconName: 'Home',
    order: 0,
    containerType: 'internal',
    internalKey: 'home',
    chatStream: 'universal',
    isActive: true,
    navAliases: ['home', 'main', 'dashboard', 'chat'],
    navSemanticPatterns: [],
  },
  {
    id: 'observe',
    displayName: 'Observe',
    iconName: 'Eye',
    order: 1,
    containerType: 'internal',
    internalKey: 'observe',
    chatStream: 'observability',
    isActive: true,
    navAliases: ['observe', 'map', 'telemetry', 'dashboard'],
    navSemanticPatterns: ['monitor the network', 'see the map', 'what\'s the status', 'network status'],
  },
  {
    id: 'appgen',
    displayName: 'AppGen',
    iconName: 'Sparkles',
    order: 2,
    containerType: 'internal',
    internalKey: 'appgen',
    chatStream: 'appgen',
    isActive: true,
    navAliases: ['appgen', 'codegen', 'code generator', 'ai builder'],
    navSemanticPatterns: ['generate app', 'ai code', 'go to appgen'],
  },
  {
    id: 'provision',
    displayName: 'Provision',
    iconName: 'Radio',
    order: 4,
    containerType: 'internal',
    internalKey: 'provision',
    chatStream: 'provision',
    isActive: true,
    navAliases: ['provision', 'change', 'parameter'],
    navSemanticPatterns: ['change a parameter', 'provision', 'update settings'],
  },
  {
    id: 'docs',
    displayName: 'Docs',
    iconName: 'BookOpen',
    order: 5,
    containerType: 'internal',
    internalKey: 'docs',
    chatStream: 'universal',
    isActive: true,
    navAliases: ['docs', 'documentation', 'help', 'reference', 'guide'],
    navSemanticPatterns: ['open documentation', 'show docs', 'help me', 'where is the manual'],
  },
  {
    id: 'settings',
    displayName: 'Settings',
    iconName: 'Settings',
    order: 6,
    containerType: 'internal',
    internalKey: 'settings',
    chatStream: 'universal',
    isActive: true,
    navAliases: ['settings', 'config', 'preferences'],
    navSemanticPatterns: [],
  },
];

export function getVisibleApps(
  registry: AppRegistryEntry[],
  user: { role: string } | null,
  userAppPermissions: Record<string, boolean> = {}
): AppRegistryEntry[] {
  return registry.filter(app => {
    // Check if app is active globally
    if (!app.isActive) return false;

    // Check role requirement
    if (app.requiresRole && app.requiresRole === 'admin' && user?.role !== 'admin') {
      return false;
    }

    // Check user-specific permission (if not explicitly set, assume enabled)
    if (app.id in userAppPermissions && !userAppPermissions[app.id]) {
      return false;
    }

    return true;
  });
}
