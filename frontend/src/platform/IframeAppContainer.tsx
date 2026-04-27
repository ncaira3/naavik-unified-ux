/**
 * Iframe App Container
 * Embeds an external web application in an iframe with security controls and postMessage communication.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import type { AppRegistryEntry } from './types';
import { usePlatformBus } from './PlatformBusContext';
import { useTheme } from '../context/ThemeContext';

// Default sandbox policy: allows scripts and forms but restricts navigation
const DEFAULT_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

interface IframeAppContainerProps {
  app: AppRegistryEntry;
}

export default function IframeAppContainer({ app }: IframeAppContainerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { publish } = usePlatformBus();
  const { theme } = useTheme();

  // Type narrowing: ensure iframeUrl is defined
  const iframeUrl = app.iframeUrl;

  if (!iframeUrl) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 py-8">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-lg font-medium text-text-secondary dark:text-gray-300">Invalid iframe configuration</p>
        <p className="text-sm text-text-muted dark:text-gray-400">No iframeUrl provided for {app.displayName}</p>
      </div>
    );
  }

  /**
   * Parse the iframe URL and extract the origin
   */
  const getOrigin = useCallback(() => {
    try {
      return new URL(iframeUrl).origin;
    } catch (e) {
      console.error(`[IframeAppContainer] Invalid iframe URL: ${app.iframeUrl}`, e);
      return null;
    }
  }, [app.iframeUrl]);

  /**
   * Send a message to the iframe using postMessage with origin-specific targetOrigin
   */
  const sendToIframe = useCallback(
    (msg: object) => {
      const origin = getOrigin();
      if (!origin) {
        console.error('[IframeAppContainer] Cannot send message: invalid origin');
        return;
      }

      if (!iframeRef.current?.contentWindow) {
        console.warn('[IframeAppContainer] Iframe contentWindow not available');
        return;
      }

      console.log(`[IframeAppContainer] Sending message to iframe (${app.displayName}):`, msg);
      iframeRef.current.contentWindow.postMessage(msg, origin);
    },
    [app.displayName, getOrigin, iframeUrl]
  );

  /**
   * Send theme updates to iframe whenever theme changes
   */
  useEffect(() => {
    if (isLoaded) {
      sendToIframe({ type: 'NAAVIK_THEME', theme });
    }
  }, [theme, isLoaded, sendToIframe]);

  /**
   * Listen for messages from the iframe (e.g., NAVIGATE_TO_APP events)
   */
  useEffect(() => {
    const expectedOrigin = getOrigin();
    if (!expectedOrigin) {
      console.error('[IframeAppContainer] Cannot set up message listener: invalid origin');
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      // Security: only accept messages from the expected origin
      if (event.origin !== expectedOrigin) {
        console.warn(
          `[IframeAppContainer] Rejected message from unexpected origin: ${event.origin} (expected ${expectedOrigin})`
        );
        return;
      }

      console.log(`[IframeAppContainer] Received message from iframe:`, event.data);

      if (event.data?.type === 'NAVIGATE_TO_APP') {
        const { appId } = event.data;
        console.log(`[IframeAppContainer] Iframe requested navigation to app: ${appId}`);
        publish({ type: 'NAVIGATE_TO_APP', payload: { appId } });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeUrl, getOrigin, publish]);

  /**
   * Handle iframe load completion
   */
  const handleLoad = () => {
    console.log(`[IframeAppContainer] Iframe loaded: ${app.displayName}`);
    setIsLoaded(true);
    setLoadError(null);

    // Send auth token
    const token = localStorage.getItem('naavik_token');
    if (token) {
      sendToIframe({ type: 'NAAVIK_AUTH', token });
    }

    // Send current theme
    sendToIframe({ type: 'NAAVIK_THEME', theme });
  };

  /**
   * Handle iframe load error
   */
  const handleError = () => {
    console.error(`[IframeAppContainer] Iframe failed to load: ${app.displayName}`);
    setLoadError(`Could not connect to ${app.displayName}`);
    setIsLoaded(true); // stop showing the spinner
  };

  /**
   * Retry loading the iframe
   */
  const handleRetry = () => {
    console.log(`[IframeAppContainer] Retrying iframe load: ${app.displayName}`);
    setIsLoaded(false);
    setLoadError(null);
    if (iframeRef.current && iframeUrl) {
      iframeRef.current.src = iframeUrl;
    }
  };

  const sandboxValue = app.iframeSandbox ?? DEFAULT_SANDBOX;

  return (
    <div className="relative flex flex-col flex-1 w-full h-full bg-ghost-bg dark:bg-pulse-bg">
      {/* Loading spinner */}
      {!isLoaded && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-ghost-bg dark:bg-pulse-bg z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/40 border-t-white/90 rounded-full animate-spin" />
            <p className="text-sm text-text-light-secondary dark:text-text-secondary">Loading {app.displayName}...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 bg-ghost-bg dark:bg-pulse-bg">
          <AlertCircle className="w-12 h-12 text-red-400" />
          <p className="text-lg font-medium text-text-secondary dark:text-gray-300">Failed to load app</p>
          <p className="text-sm text-text-muted dark:text-gray-400">{loadError}</p>
          <button
            onClick={handleRetry}
            className="px-4 py-2 rounded-lg bg-ui-btn text-ui-btn-fg text-sm hover:bg-ui-btn-hover transition-colors font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        src={app.iframeUrl}
        sandbox={sandboxValue}
        onLoad={handleLoad}
        onError={handleError}
        className={`flex-1 w-full h-full border-0 transition-opacity duration-300 ${
          isLoaded && !loadError ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        title={app.displayName}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
