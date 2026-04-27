/**
 * Dynamic Module Federation Loader
 * Loads federated modules at runtime from remote URLs without requiring build-time configuration.
 * Works with both webpack 5 Module Federation and vite-plugin-federation remotes.
 */

interface FederationContainer {
  init(shareScope: Record<string, unknown>): Promise<void>;
  get(module: string): Promise<() => { default: React.ComponentType<any> }>;
}

// Cache already-injected scripts to avoid duplicate <script> tags
const injectedScripts = new Set<string>();

// Cache initialized containers to avoid re-init on re-renders
const initializedContainers = new Set<string>();

/**
 * Inject a remote entry script tag and wait for it to load
 */
async function injectScript(src: string): Promise<void> {
  // If already injected, resolve immediately
  if (injectedScripts.has(src)) return;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.type = 'text/javascript';
    script.async = true;

    script.onload = () => {
      injectedScripts.add(src);
      resolve();
    };

    script.onerror = () => {
      reject(new Error(`Failed to load remote script: ${src}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Load a federated module dynamically from a remote URL
 *
 * @param remoteUrl - Base URL where the remote's remoteEntry.js is hosted (e.g., "https://analytics.example.com")
 * @param remoteName - Name of the remote container on window (e.g., "analyticsApp")
 * @param exposedModule - Module path exposed by the remote (e.g., "./App")
 * @returns React component from the remote's default export
 *
 * @throws Error if script fails to load, container not found, or module is not a React component
 */
export async function loadFederatedModule(
  remoteUrl: string,
  remoteName: string,
  exposedModule: string
): Promise<React.ComponentType<any>> {
  // Normalize: strip trailing slash, append remoteEntry.js
  const baseUrl = remoteUrl.replace(/\/$/, '');
  const remoteEntryUrl = `${baseUrl}/remoteEntry.js`;

  console.log(`[federatedLoader] Loading remote: ${remoteEntryUrl} (container: ${remoteName}, module: ${exposedModule})`);

  // Step 1: inject the script tag
  await injectScript(remoteEntryUrl);

  // Step 2: access the container on window
  const container = (window as any)[remoteName] as FederationContainer | undefined;
  if (!container) {
    console.error(`[federatedLoader] Container "${remoteName}" not found on window after loading ${remoteEntryUrl}`);
    throw new Error(
      `Remote container "${remoteName}" not found on window after loading ${remoteEntryUrl}. ` +
      `Ensure the remote is built with the correct container name in its federation config.`
    );
  }

  console.log(`[federatedLoader] Container found: ${remoteName}`);

  // Step 3: initialize the container if not already initialized
  if (!initializedContainers.has(remoteName)) {
    console.log(`[federatedLoader] Initializing container: ${remoteName}`);
    await container.init({});
    initializedContainers.add(remoteName);
  } else {
    console.log(`[federatedLoader] Container already initialized: ${remoteName}`);
  }

  // Step 4: get the module factory and call it
  console.log(`[federatedLoader] Getting module: ${exposedModule}`);
  const factory = await container.get(exposedModule);
  const module = factory();

  console.log(`[federatedLoader] Module loaded, extracting default export`);

  // Step 5: return the default export (the React component)
  const component = module.default;
  if (typeof component !== 'function') {
    console.error(`[federatedLoader] Module default export is not a React component:`, component);
    throw new Error(
      `Exposed module "${exposedModule}" from remote "${remoteName}" does not have a default export that is a React component. ` +
      `Got: ${typeof component}`
    );
  }

  console.log(`[federatedLoader] Successfully loaded federated module: ${remoteName}/${exposedModule}`);
  return component;
}
