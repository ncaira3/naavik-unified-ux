/**
 * AppGen Wrapper
 * Loads the AppGen UI running on port 5168 via iframe.
 */

import { useRef, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';

const APPGEN_URL = 'http://localhost:5168';

export default function AppGenWrapper() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { theme } = useTheme();
  // Bust the iframe cache on every mount so stale chunk hashes never cause load failures
  const iframeSrc = useRef(`${APPGEN_URL}?t=${Date.now()}`).current;

  // Send theme to AppGen iframe whenever it changes
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'NAAVIK_THEME', theme }, '*');
  }, [theme]);

  const handleLoad = () => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'NAAVIK_THEME', theme }, '*');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="flex-1 w-full border-none"
        style={{ height: '100%' }}
        allow="clipboard-read; clipboard-write"
        title="AppGen"
        onLoad={handleLoad}
      />
    </div>
  );
}
