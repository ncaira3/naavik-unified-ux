import { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import type { PlatformEvent } from './types';

interface PlatformBusContextType {
  publish: (event: PlatformEvent) => void;
  subscribe: (type: PlatformEvent['type'], handler: (payload: any) => void) => () => void;
}

const PlatformBusContext = createContext<PlatformBusContextType | undefined>(undefined);

export const PlatformBusProvider = ({ children }: { children: ReactNode }) => {
  // Handler map: type -> Set of handlers
  const handlersRef = useRef<Map<string, Set<Function>>>(new Map());
  const lastEventRef = useRef<Map<string, any>>(new Map());

  const publish = useCallback((event: PlatformEvent) => {
    const handlers = handlersRef.current.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler((event as any).payload);
        } catch (error) {
          console.error(`Error in platform bus handler for ${event.type}:`, error);
        }
      });
    }
    // Store last event for late subscribers
    lastEventRef.current.set(event.type, (event as any).payload);
  }, []);

  const subscribe = useCallback(
    (type: PlatformEvent['type'], handler: (payload: any) => void) => {
      // Ensure handler set exists
      if (!handlersRef.current.has(type)) {
        handlersRef.current.set(type, new Set());
      }

      // Add handler
      const handlers = handlersRef.current.get(type)!;
      handlers.add(handler);

      // If there's a recent event of this type, call the handler immediately
      const lastPayload = lastEventRef.current.get(type);
      if (lastPayload !== undefined) {
        try {
          handler(lastPayload);
        } catch (error) {
          console.error(`Error calling late-subscribed handler for ${type}:`, error);
        }
      }

      // Return unsubscribe function
      return () => {
        handlers.delete(handler);
      };
    },
    []
  );

  return (
    <PlatformBusContext.Provider value={{ publish, subscribe }}>
      {children}
    </PlatformBusContext.Provider>
  );
};

export const usePlatformBus = () => {
  const context = useContext(PlatformBusContext);
  if (!context) {
    throw new Error('usePlatformBus must be used within PlatformBusProvider');
  }
  return context;
};
