import { Suspense, useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AppRegistryEntry } from './types';
import { LAZY_COMPONENTS } from './appRegistry';
import { loadFederatedModule } from './federatedLoader';
import IframeAppContainer from './IframeAppContainer';

interface AppSlotProps {
  activeAppId: string;
  registry: AppRegistryEntry[];
  onNavigate?: (view: string) => void;
}

export default function AppSlot({ activeAppId, registry, onNavigate }: AppSlotProps) {
  const app = registry.find(a => a.id === activeAppId);
  const [error, setError] = useState<string | null>(null);

  // Federated app state
  const [FederatedComponent, setFederatedComponent] = useState<React.ComponentType<any> | null>(null);
  const [federatedLoading, setFederatedLoading] = useState(false);
  const [federatedError, setFederatedError] = useState<string | null>(null);

  // Log for debugging
  useEffect(() => {
    console.log(`[AppSlot] Active app ID: ${activeAppId}`);
    console.log(`[AppSlot] Registry:`, registry);
    if (app) {
      console.log(`[AppSlot] Found app:`, app);
      console.log(`[AppSlot] Container type: ${app.containerType}`);
      console.log(`[AppSlot] Internal key: ${app.internalKey}`);
      console.log(`[AppSlot] LAZY_COMPONENTS keys:`, Object.keys(LAZY_COMPONENTS));
    } else {
      console.log(`[AppSlot] App "${activeAppId}" not found in registry`);
    }
  }, [activeAppId, app, registry]);

  // Reset error when app changes
  useEffect(() => {
    setError(null);
  }, [activeAppId]);

  // Load federated module when app changes to federated type
  useEffect(() => {
    if (app?.containerType !== 'federated') return;

    if (!app.remoteUrl || !app.remoteName || !app.exposedModule) {
      const msg = 'Federated app missing remoteUrl, remoteName, or exposedModule in registry.';
      console.error(`[AppSlot] ${msg}`);
      setFederatedError(msg);
      return;
    }

    setFederatedLoading(true);
    setFederatedError(null);
    setFederatedComponent(null);

    console.log(`[AppSlot] Loading federated module: ${app.remoteName} from ${app.remoteUrl}`);

    loadFederatedModule(app.remoteUrl, app.remoteName, app.exposedModule)
      .then((Component) => {
        console.log(`[AppSlot] Successfully loaded federated component: ${app.id}`);
        setFederatedComponent(() => Component);
        setFederatedLoading(false);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error loading federated module';
        console.error(`[AppSlot] Error loading federated module:`, err);
        setFederatedError(errorMsg);
        setFederatedLoading(false);
      });
  }, [app?.id]);

  if (!app) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8">
        <AlertCircle className="w-12 h-12 text-text-muted" />
        <p className="text-lg font-medium text-text-secondary dark:text-gray-300">App not found</p>
        <p className="text-sm text-text-muted dark:text-gray-400">
          The app "{activeAppId}" is not registered or is not available.
        </p>
      </div>
    );
  }

  if (!app.isActive) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8">
        <AlertCircle className="w-12 h-12 text-text-muted" />
        <p className="text-lg font-medium text-text-secondary dark:text-gray-300">App disabled</p>
        <p className="text-sm text-text-muted dark:text-gray-400">
          This app is currently disabled by an administrator.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium text-text-secondary dark:text-gray-300">App error</p>
        <p className="text-sm text-text-muted dark:text-gray-400">{error}</p>
      </div>
    );
  }

  try {
    if (app.containerType === 'internal' && app.internalKey) {
      console.log(`[AppSlot] Loading internal app with key: ${app.internalKey}`);
      const LazyComponent = LAZY_COMPONENTS[app.internalKey];

      if (!LazyComponent) {
        const errorMsg = `Component loader not found for "${app.internalKey}"`;
        console.error(`[AppSlot] ERROR: ${errorMsg}`);
        console.error(`[AppSlot] Available loaders:`, Object.keys(LAZY_COMPONENTS));
        setError(errorMsg);
        return null;
      }

      console.log(`[AppSlot] Successfully found lazy component for: ${app.internalKey}`);
      const LazyAny = LazyComponent as any;
      return (
        <Suspense fallback={null}>
          <LazyAny onNavigate={onNavigate} />
        </Suspense>
      );
    }

    if (app.containerType === 'federated') {
      // Stage 2: federated app loading
      if (federatedLoading) {
        return null;
      }

      if (federatedError) {
        return (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8">
            <AlertCircle className="w-12 h-12 text-red-400" />
            <p className="text-lg font-medium text-text-secondary dark:text-gray-300">Failed to load federated app</p>
            <p className="text-sm text-text-muted dark:text-gray-400 max-w-md text-center">{federatedError}</p>
          </div>
        );
      }

      if (!FederatedComponent) {
        return null;
      }

      return (
        <Suspense fallback={null}>
          <FederatedComponent />
        </Suspense>
      );
    }

    if (app.containerType === 'iframe') {
      // Stage 3: iframe app embedding
      return <IframeAppContainer app={app} />;
    }

    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8">
        <AlertCircle className="w-12 h-12 text-text-muted" />
        <p className="text-lg font-medium text-text-secondary dark:text-gray-300">Unknown container type</p>
        <p className="text-sm text-text-muted dark:text-gray-400">
          Unknown app container type: {app.containerType}
        </p>
      </div>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    setError(message);
    return null;
  }
}
