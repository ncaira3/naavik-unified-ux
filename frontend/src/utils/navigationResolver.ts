import type { AppSpaceView } from '../components/AppSpaceLayout';
import type { ChatMessage } from '../types';
import type { AppRegistryEntry } from '../platform/types';

export interface NavigationResolution {
  targetView: AppSpaceView;
  acknowledgmentText: string;
  matchTier: 'explicit' | 'semantic' | 'context';
}

export interface NavigationResolverInput {
  query: string;
  recentMessages: ChatMessage[];
  currentView?: AppSpaceView;
  registry?: AppRegistryEntry[];
}

interface AppDefinition {
  view: AppSpaceView;
  displayName: string;
  aliases: string[];
  semanticPatterns: string[];
  antiPatterns: string[];
  contextKeywords: string[];
}

const DEFAULT_APP_DEFINITIONS: AppDefinition[] = [
  {
    view: 'observe',
    displayName: 'Network Observe',
    aliases: ['observe', 'observability', 'map', 'map view', 'network map', 'telemetry', 'network observe', 'network view', 'network dashboard', 'monitoring dashboard'],
    semanticPatterns: ['monitor the network', 'monitor network', 'watch the network', 'look at the network', 'see the network', 'view the network', 'visualize the network', 'see the map', 'network overview', 'network dashboard', 'check network health', 'inspect the network'],
    antiPatterns: ['what', 'why', 'which', 'how', 'when', 'who', 'is there', 'are there', 'can you', 'could you', 'tell me', 'explain', 'show me why', 'show me what', 'analyze', 'analysis', 'report', 'find', 'detect', 'identify', 'investigate', 'rca', 'root cause', 'anomal', 'degraded', 'offender', 'alarm', 'ticket'],
    contextKeywords: ['observe', 'map', 'telemetry', 'network', 'site', 'kpi', 'rca', 'monitoring'],
  },
  {
    view: 'appgen',
    displayName: 'AppGen Studio',
    aliases: ['appgen', 'app gen', 'appstore', 'app store', 'app studio', 'app builder', 'rapp studio', 'rapp builder', 'naavik appgen', 'code studio'],
    semanticPatterns: ['build an app', 'build a rapp', 'create an app', 'create a rapp', 'generate an app', 'make an app', 'start building', 'design an automation', 'create automation', 'build automation', 'develop an app', 'code an app', 'write an app', 'new app', 'new rapp', 'start appgen'],
    antiPatterns: ['what', 'why', 'which', 'how', 'when', 'is there', 'explain', 'tell me', 'can you tell', 'show me the code', 'show me the app', 'existing app', 'my app'],
    contextKeywords: ['app', 'rapp', 'appgen', 'build', 'automation', 'code', 'workflow'],
  },
  {
    view: 'provision',
    displayName: 'Network Provision',
    aliases: ['provision', 'provisioning', 'ztp', 'zero touch', 'site provisioning', 'network provisioning', 'naavik provision'],
    semanticPatterns: ['provision a site', 'provision new site', 'add a site', 'onboard a site', 'commission a site', 'activate a site', 'set up a new site', 'setup new site', 'deploy a site', 'turn up a site', 'site turnup', 'new site rollout'],
    antiPatterns: ['what', 'why', 'which', 'how', 'is there', 'explain', 'tell me', 'can you', 'parameter change', 'change parameter', 'set ', 'update ', 'modify '],
    contextKeywords: ['provision', 'site', 'new site', 'ztp', 'commission', 'activate'],
  },
  {
    view: 'settings',
    displayName: 'Settings',
    aliases: ['settings', 'preferences', 'configuration', 'app settings', 'theme', 'vendor settings', 'vendor filter'],
    semanticPatterns: ['change the theme', 'switch theme', 'change theme', 'dark mode', 'light mode', 'filter vendors', 'set up my preferences'],
    antiPatterns: ['what', 'why', 'how', 'explain', 'tell me'],
    contextKeywords: ['settings', 'theme', 'preferences', 'vendor'],
  },
  {
    view: 'home',
    displayName: 'Home',
    aliases: ['home', 'main', 'dashboard', 'start', 'landing', 'home page', 'main page', 'back to home'],
    semanticPatterns: [],
    antiPatterns: [],
    contextKeywords: [],
  },
];

function buildAppDefinitionsFromRegistry(registry: AppRegistryEntry[]): AppDefinition[] {
  return registry.map((entry) => ({
    view: entry.id as AppSpaceView,
    displayName: entry.displayName,
    aliases: entry.navAliases || [],
    semanticPatterns: entry.navSemanticPatterns || [],
    antiPatterns: [],
    contextKeywords: entry.navAliases ? entry.navAliases.slice(0, 3) : [],
  }));
}

const GLOBAL_ANTI_PATTERNS = [
  /^what\b/i,
  /^why\b/i,
  /^which\b/i,
  /^how\b/i,
  /^when\b/i,
  /^who\b/i,
  /^is there\b/i,
  /^are there\b/i,
  /^can you\b/i,
  /^could you\b/i,
  /^do you\b/i,
  /^does\b/i,
  /^did\b/i,
  /^will\b/i,
  /^would\b/i,
  /^tell me\b/i,
  /^explain\b/i,
  /^describe\b/i,
  /^show me (why|what|how|which|where|when)\b/i,
  /\?$/,
];

const NAVIGATION_PREFIXES = ['go to ', 'goto ', 'navigate to ', 'open ', 'take me to ', 'switch to ', 'show me the ', 'launch ', 'bring up ', 'head to ', 'jump to ', 'load '];

function extractNavigationTarget(lowerQuery: string): string | null {
  for (const prefix of NAVIGATION_PREFIXES) {
    if (lowerQuery.startsWith(prefix)) {
      return lowerQuery.slice(prefix.length).trim();
    }
  }
  return null;
}

function isBlockedByGlobalAntiPatterns(lowerQuery: string): boolean {
  return GLOBAL_ANTI_PATTERNS.some((pattern) => pattern.test(lowerQuery));
}

function isBlockedByViewAntiPatterns(lowerQuery: string, antiPatterns: string[]): boolean {
  return antiPatterns.some((pattern) => lowerQuery.includes(pattern));
}

function extractContextKeywords(recentMessages: ChatMessage[]): Set<string> {
  const keywords = new Set<string>();
  recentMessages.forEach((msg) => {
    if (msg.role === 'assistant' && msg.content) {
      const tokens = msg.content.toLowerCase().match(/\b\w+\b/g) || [];
      tokens.forEach((token) => keywords.add(token));
    }
  });
  return keywords;
}

function scoreViewByContext(appDef: AppDefinition, contextKeywords: Set<string>): number {
  let score = 0;
  for (const keyword of appDef.contextKeywords) {
    if (contextKeywords.has(keyword)) score += 1;
  }
  return score;
}

export function resolveNavigationIntent(input: NavigationResolverInput): NavigationResolution | null {
  const lower = input.query.toLowerCase().trim();
  const APP_DEFINITIONS = input.registry ? buildAppDefinitionsFromRegistry(input.registry) : DEFAULT_APP_DEFINITIONS;

  const target = extractNavigationTarget(lower);
  if (target) {
    for (const appDef of APP_DEFINITIONS) {
      for (const alias of appDef.aliases) {
        if (target === alias || target.startsWith(alias + ' ')) {
          if (appDef.view !== input.currentView) {
            return {
              targetView: appDef.view,
              acknowledgmentText: `Taking you to ${appDef.displayName}...`,
              matchTier: 'explicit',
            };
          }
          return null;
        }
      }
    }
  }

  if (isBlockedByGlobalAntiPatterns(lower)) return null;

  for (const appDef of APP_DEFINITIONS) {
    for (const pattern of appDef.semanticPatterns) {
      if (lower.includes(pattern) && !isBlockedByViewAntiPatterns(lower, appDef.antiPatterns)) {
        if (appDef.view !== input.currentView) {
          return {
            targetView: appDef.view,
            acknowledgmentText: `Taking you to ${appDef.displayName}...`,
            matchTier: 'semantic',
          };
        }
      }
    }
  }

  const ambiguousRefs = ['show me that', 'take me there', 'go there', 'open that', 'go back', 'return to', 'show that view', 'same place'];
  const isAmbiguousRef = ambiguousRefs.some((ref) => lower.includes(ref));
  if (!isAmbiguousRef || input.recentMessages.length === 0) return null;

  const contextKeywords = extractContextKeywords(input.recentMessages);
  let bestView: AppDefinition | null = null;
  let bestScore = 0;

  for (const appDef of APP_DEFINITIONS) {
    if (appDef.view === 'home') continue;
    const score = scoreViewByContext(appDef, contextKeywords);
    if (score > bestScore) {
      bestScore = score;
      bestView = appDef;
    }
  }

  if (bestView && bestScore >= 2 && bestView.view !== input.currentView) {
    return {
      targetView: bestView.view,
      acknowledgmentText: `Taking you to ${bestView.displayName}...`,
      matchTier: 'context',
    };
  }

  return null;
}
