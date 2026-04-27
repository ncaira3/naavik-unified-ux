/**
 * Global Chat Overlay
 * Slide-out chat interface accessible from anywhere
 */
import { X } from 'lucide-react';
import ChatInterface from './ChatInterface';
import type { AppSpaceView } from './AppSpaceLayout';

type ChatDisplayMode = 'tile' | 'split';

interface GlobalChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (view: AppSpaceView) => void;
  currentView: AppSpaceView;
  mode: ChatDisplayMode;
  onModeChange: (mode: ChatDisplayMode) => void;
}

export default function GlobalChatOverlay({ isOpen, onClose, onNavigate, currentView, mode, onModeChange }: GlobalChatOverlayProps) {
  if (!isOpen) return null;

  return (
    <div
      className={`fixed z-50 transform transition-all duration-300 ease-out ${
        mode === 'split'
          ? 'right-0 top-0 bottom-0 w-[46vw] min-w-[560px] max-w-[860px]'
          : 'right-6 top-20 bottom-6 w-[32rem] max-w-[calc(100vw-3rem)]'
      } ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 pointer-events-none'}`}
    >
      <div className="h-full flex flex-col rounded-2xl overflow-hidden bg-cream-bg dark:bg-pulse-bg border border-border dark:border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border dark:border-white/10 bg-white/80 dark:bg-black/50 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <img src="/aira-logo.png" alt="Aira" className="w-7 h-7" />
            <div>
              <h2 className="text-base font-semibold text-text-primary dark:text-white">
                Aira Assistant
              </h2>
              <p className="text-xs text-text-secondary dark:text-gray-400">
                Ask anything about your network
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border dark:border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => onModeChange('tile')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === 'tile'
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-cream-surface dark:bg-transparent text-text-secondary dark:text-gray-300'
                }`}
              >
                Tile
              </button>
              <button
                type="button"
                onClick={() => onModeChange('split')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === 'split'
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-cream-surface dark:bg-transparent text-text-secondary dark:text-gray-300'
                }`}
              >
                Split
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chat content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatInterface onNavigate={onNavigate} currentView={currentView} />
        </div>
      </div>
    </div>
  );
}
