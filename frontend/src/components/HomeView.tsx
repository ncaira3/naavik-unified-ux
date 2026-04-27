import ChatInterface from './ChatInterface';
import type { AppSpaceView } from './AppSpaceLayout';

interface HomeViewProps {
  onNavigate?: (view: AppSpaceView) => void;
}

export default function HomeView({ onNavigate }: HomeViewProps) {
  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* ChatInterface now central to the entire app */}
      <ChatInterface onNavigate={onNavigate || (() => {})} currentView="home" />
    </div>
  );
}
