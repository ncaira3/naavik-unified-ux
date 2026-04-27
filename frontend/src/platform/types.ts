export type AppContainerType = 'internal' | 'federated' | 'iframe';

export type ChatStream = 'universal' | 'knowledge' | 'appgen' | 'observability' | 'provision';

export interface AppRegistryEntry {
  id: string;
  displayName: string;
  iconName: string;               // lucide-react icon name, e.g. 'Home', 'Eye'
  order: number;
  containerType: AppContainerType;
  internalKey?: string;           // key into LAZY_COMPONENTS map (Stage 1)
  remoteUrl?: string;             // Stage 2: federation remote entry URL
  remoteName?: string;
  exposedModule?: string;
  iframeUrl?: string;             // Stage 3: external app URL
  iframeSandbox?: string;
  chatStream?: ChatStream;
  navAliases?: string[];          // for navigationResolver
  navSemanticPatterns?: string[];
  requiresRole?: 'admin' | 'user';
  isActive: boolean;
}

export interface UserAppPermission {
  userId: string;
  appId: string;
  isEnabled: boolean;
  grantedBy: string;
  grantedAt: string;
}

export type PlatformEvent =
  | { type: 'PROVISION_SITES_SELECTED'; payload: { sites: any[] } }
  | { type: 'MAP_PROVISIONING_LAYER_ENABLED' }
  | { type: 'MAP_FOCUS_SITE'; payload: { siteId: string } }
  | { type: 'MAP_PROVISIONING_FOCUS_CONSUMED' }
  | { type: 'NAVIGATE_TO_APP'; payload: { appId: string } };
