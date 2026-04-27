/**
 * Chat Sidebar Component
 * Session history panel grouped by context/stream
 */

import { useState } from 'react';
import { Plus, MessageSquare, Settings, LogOut, Menu, X, Home, Zap, Eye, Radio, Code2, ChevronRight } from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { useTheme } from '../../context/ThemeContext';
import type { ChatStream } from '../../context/ChatContext';

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle?: () => void;
  activeStream: ChatStream;
  onStreamChange: (stream: ChatStream) => void;
  onSettingsClick: () => void;
  onLogout: () => void;
}

const STREAM_CONFIG: { id: ChatStream; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'universal',    label: 'Home',        icon: <Zap className="w-3.5 h-3.5" />,         color: 'text-teal-400' },
  { id: 'observability',label: 'Observe',     icon: <Eye className="w-3.5 h-3.5" />,         color: 'text-sky-400' },
  { id: 'provision',    label: 'Provision',   icon: <Radio className="w-3.5 h-3.5" />,       color: 'text-emerald-400' },
  { id: 'appgen',       label: 'AppGen',      icon: <Code2 className="w-3.5 h-3.5" />,       color: 'text-amber-400' },
  { id: 'knowledge',    label: 'Knowledge',   icon: <Home className="w-3.5 h-3.5" />,        color: 'text-rose-400' },
];

export default function ChatSidebar({
  isOpen,
  onClose,
  onToggle,
  activeStream,
  onStreamChange,
  onSettingsClick,
  onLogout,
}: ChatSidebarProps) {
  const { messagesByStream, clearChat } = useChat();
  const { theme: _theme } = useTheme();

  // Track which stream sections are collapsed (all expanded by default)
  const [collapsed, setCollapsed] = useState<Record<ChatStream, boolean>>({} as Record<ChatStream, boolean>);

  const toggleCollapse = (stream: ChatStream) =>
    setCollapsed((prev) => ({ ...prev, [stream]: !prev[stream] }));

  // Streams that actually have messages
  const activeStreams = STREAM_CONFIG.filter(
    (cfg) => (messagesByStream[cfg.id] ?? []).some((m) => m.role === 'user')
  );

  const hasAnyHistory = activeStreams.length > 0;

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed md:relative inset-y-0 left-0 w-64 bg-cream-bg dark:bg-pulse-bg border-r border-cream-border/70 dark:border-pulse-border/70 flex flex-col transition-transform duration-300 z-40 md:z-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-cream-border/70 dark:border-pulse-border/70">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <img src="/aira-logo.png" alt="Naavik" className="w-5 h-5 object-contain" />
              </div>
              <span className="font-bold text-text-light-primary dark:text-text-primary">Naavik</span>
            </div>
            <button
              onClick={onClose}
              className="md:hidden p-1 hover:bg-cream-surface dark:hover:bg-pulse-surface rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* New Chat Button */}
          <button
            onClick={clearChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover transition font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Session History */}
        <div className="flex-1 overflow-y-auto">
          {!hasAnyHistory ? (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-2 py-12">
              <MessageSquare className="w-8 h-8 text-text-light-muted dark:text-text-muted opacity-40" />
              <p className="text-xs text-text-light-muted dark:text-text-muted">
                Your session history will appear here as you chat.
              </p>
            </div>
          ) : (
            <div className="py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-light-muted dark:text-text-muted px-4 py-2">
                Session History
              </p>

              {activeStreams.map((cfg) => {
                const streamMessages = (messagesByStream[cfg.id] ?? []).filter((m) => m.role === 'user');
                const isActive = activeStream === cfg.id;
                const isCollapsed = collapsed[cfg.id] ?? false;

                return (
                  <div key={cfg.id} className="mb-1">
                    {/* Stream section header */}
                    <button
                      onClick={() => toggleCollapse(cfg.id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 transition-colors ${
                        isActive
                          ? 'bg-cream-surface-light dark:bg-white/6'
                          : 'hover:bg-cream-surface dark:hover:bg-pulse-surface'
                      }`}
                    >
                      <span className={cfg.color}>{cfg.icon}</span>
                      <span
                        className={`flex-1 text-left text-[11px] font-semibold uppercase tracking-[0.1em] ${
                          isActive
                            ? 'text-text-secondary dark:text-slate-200'
                            : 'text-text-light-secondary dark:text-text-secondary'
                        }`}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-[10px] text-text-light-muted dark:text-text-muted mr-1">
                        {streamMessages.length}
                      </span>
                      <ChevronRight
                        className={`w-3 h-3 text-text-light-muted dark:text-text-muted transition-transform ${
                          isCollapsed ? '' : 'rotate-90'
                        }`}
                      />
                    </button>

                    {/* Messages under this stream */}
                    {!isCollapsed && (
                      <div className="ml-3 border-l border-border dark:border-white/8 pl-2 pr-2 pb-1 space-y-0.5">
                        {streamMessages.slice(-12).map((msg) => (
                          <button
                            key={msg.id}
                            onClick={() => onStreamChange(cfg.id)}
                            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-cream-surface dark:hover:bg-white/5 transition-colors group"
                          >
                            <p className="text-[12px] text-text-light-primary dark:text-text-primary line-clamp-2 group-hover:text-slate-900 dark:group-hover:text-white">
                              {msg.content.slice(0, 80)}
                            </p>
                            <p className="text-[10px] text-text-light-muted dark:text-text-muted mt-0.5">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-cream-border/70 dark:border-pulse-border/70 space-y-1">
          <button
            onClick={onSettingsClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-text-light-secondary dark:text-text-secondary hover:bg-cream-surface dark:hover:bg-pulse-surface hover:text-text-light-primary dark:hover:text-text-primary transition text-sm"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>

          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-sm"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Mobile menu button */}
      <button
        onClick={() => onToggle?.()}
        className="md:hidden fixed bottom-6 left-6 p-3 bg-ui-btn text-ui-btn-fg rounded-full shadow-lg hover:bg-ui-btn-hover transition z-30"
      >
        <Menu className="w-6 h-6" />
      </button>
    </>
  );
}
