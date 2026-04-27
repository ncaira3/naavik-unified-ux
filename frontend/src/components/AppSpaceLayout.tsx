import { useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useChat, type ChatStream } from '../context/ChatContext';
import type { AppRegistryEntry } from '../platform/types';
import AppLeftSidebar from './AppLeftSidebar';

export type AppSpaceView = string;

interface AppSpaceLayoutProps {
  activeView: AppSpaceView;
  onViewChange: (view: AppSpaceView) => void;
  children: React.ReactNode;
  registry: AppRegistryEntry[];
}

export default function AppSpaceLayout({
  activeView,
  onViewChange,
  children,
  registry,
}: AppSpaceLayoutProps) {
  const { theme } = useTheme();
  const { setActiveStream } = useChat();

  useEffect(() => {
    const currentApp = registry.find((a) => a.id === activeView);
    const stream = currentApp?.chatStream ?? 'universal';
    setActiveStream(stream as ChatStream);
  }, [activeView, registry, setActiveStream]);

  return (
    <div
      className="flex h-screen overflow-hidden bg-ghost-bg text-text-primary transition-colors dark:bg-pulse-bg dark:text-white"
      data-theme={theme}
    >
      <AppLeftSidebar
        activeView={activeView}
        onViewChange={onViewChange}
        registry={registry}
      />

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {children}
      </main>
    </div>
  );
}
