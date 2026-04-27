import { useEffect, useState } from 'react';
import AppSpaceLayout, { type AppSpaceView } from './components/AppSpaceLayout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ChatProvider } from './context/ChatContext';
import { MapDataProvider } from './context/MapDataContext';
import { DummifierProvider } from './context/DummifierContext';
import { PlatformBusProvider, usePlatformBus } from './platform/PlatformBusContext';
import { useAppRegistry } from './platform/useAppRegistry';
import AppSlot from './platform/AppSlot';
import LoginPage from './components/LoginPage';
import api from './services/api';

function AuthenticatedApp() {
  const [activeView, setActiveView] = useState<AppSpaceView>('home');
  const { registry } = useAppRegistry();
  const { subscribe } = usePlatformBus();

  const handleViewChange = (view: AppSpaceView) => {
    setActiveView(view);
  };

  // Subscribe to platform bus navigation events
  useEffect(() => {
    const unsubscribe = subscribe('NAVIGATE_TO_APP', (payload: { appId: string }) => {
      handleViewChange(payload.appId);
    });
    return unsubscribe;
  }, [subscribe]);

  return (
    <ChatProvider>
      <MapDataProvider>
        <AppSpaceLayout activeView={activeView} onViewChange={handleViewChange} registry={registry}>
          <div
            className={`flex flex-col bg-ghost-bg dark:bg-pulse-bg text-text-primary dark:text-white transition-colors ${
              activeView === 'home' ? 'flex-1 min-h-0' : activeView === 'observe' ? 'flex-1 min-h-0 overflow-hidden animate-view-enter' : 'min-h-full overflow-auto pb-4 sm:pb-6 lg:pb-8 animate-view-enter'
            }`}
          >
            <AppSlot activeAppId={activeView} registry={registry} onNavigate={handleViewChange} />
          </div>
        </AppSpaceLayout>
      </MapDataProvider>
    </ChatProvider>
  );
}

function AppBootstrap() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const { setUser } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      const existingToken = localStorage.getItem('naavik_token');
      if (!existingToken) {
        if (!cancelled) setAuthReady(true);
        return;
      }

      try {
        const response = await api.verifyAuth();
        if (!cancelled) {
          const isValid = Boolean(response.success && response.data?.valid);
          if (isValid && response.data?.user) {
            setUser(response.data.user);
          }
          setIsAuthenticated(isValid);
        }
      } catch {
        api.clearAuth();
        if (!cancelled) {
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  if (!authReady) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ThemeProvider>
        <LoginPage onLogin={async () => {
          try {
            const response = await api.verifyAuth();
            if (response.data?.user) {
              setUser(response.data.user);
            }
            setIsAuthenticated(true);
          } catch (error) {
            console.error('Failed to verify auth after login:', error);
          }
        }} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <PlatformBusProvider>
        <AuthenticatedApp />
      </PlatformBusProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  // Force dark mode globally for professional sleek theme
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <ThemeProvider>
      <DummifierProvider>
        <AuthProvider>
          <AppBootstrap />
        </AuthProvider>
      </DummifierProvider>
    </ThemeProvider>
  );
}

// Wrapper to provide outer providers
function App() {
  return <AppContent />;
}

export default App;
