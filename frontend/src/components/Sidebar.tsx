import { useState, useRef } from 'react';
import {
  Eye,
  BarChart3,
  Boxes,
  Radio,
  Settings,
  LogOut,
  RotateCcw,
  Sun,
  Moon,
  MessageCircle,
} from 'lucide-react';
import api from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useChat } from '../context/ChatContext';
import SettingsPage from './SettingsPage';
import FeedbackModal from './FeedbackModal';

interface SidebarProps {
  activeView?: string;
  onViewChange?: (view: string) => void;
}

export default function Sidebar({ activeView = 'observe', onViewChange }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { clearChat } = useChat();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentUser, _setCurrentUser] = useState({
    id: '1',
    name: 'Admin User',
    email: 'admin@naavik.io',
    role: 'admin' as const,
  });
  const [isAdmin, _setIsAdmin] = useState(true);
  
  const handleLogout = async () => {
    await api.logout();
    window.location.reload();
  };

  const handleViewChange = (view: string) => {
    onViewChange?.(view);
  };

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsCollapsed(false);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsCollapsed(true);
    }, 200);
  };

  const menuItems = [
    { id: 'observe', icon: Eye, label: 'Observe and Analyze' },
    { id: 'insights', icon: BarChart3, label: 'Discover' },
    { id: 'appgen', icon: Boxes, label: 'Naavik AppGen' },
    { id: 'provision', icon: Radio, label: 'Provision' },
    { id: 'feedback', icon: MessageCircle, label: 'Feedback', isAction: true },
  ];

  return (
    <div
      ref={sidebarRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${isCollapsed ? 'w-16' : 'w-64'} bg-ghost-surface dark:bg-pulse-bg border-r border-ghost-border dark:border-pulse-border flex flex-col h-full transition-all duration-300 ease-out overflow-hidden`}
    >
      {/* Header */}
      <div className="p-4 border-b border-ghost-border dark:border-pulse-border flex-shrink-0">
        <div className="flex items-center justify-center gap-2">
          <div className={`flex justify-center ${isCollapsed ? 'w-14 h-14' : 'flex-1'}`}>
            {isCollapsed ? (
              <div className="w-14 h-14 flex items-center justify-center cursor-pointer hover:opacity-80 transition">
                <img src="/aira-logo.png" alt="Aira" className="w-full h-full object-contain" />
              </div>
            ) : (
              <img
                src={theme === 'dark' ? '/naavik-full-logo-transparent.png' : '/naavik-full-logo.png'}
                alt="Aira Naavik"
                className="h-20 w-full max-w-[220px] object-contain object-center"
              />
            )}
          </div>
        </div>

        {!isCollapsed && (
          <button
            onClick={() => { clearChat(); handleViewChange('observe'); }}
            className="w-full mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 bg-ghost-surface-alt dark:bg-pulse-surface-light border rounded-lg transition text-sm font-medium text-text-light-primary dark:text-text-primary group"
            style={{ borderColor: 'rgb(var(--tenant-accent-rgb) / 0.45)' }}
          >
            <RotateCcw
              className="w-4 h-4 transition"
              style={{ color: 'rgb(var(--tenant-accent-rgb))' }}
            />
            <span className="whitespace-nowrap">Clear Chat</span>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 overflow-y-auto scrollbar-thin min-w-0">
        <div className="space-y-1">
          {menuItems.map((item: any) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const isActionItem = item.isAction;

            return (
              <button
                key={item.id}
                onClick={() => {
                  if (isActionItem && item.id === 'feedback') {
                    setIsFeedbackOpen(true);
                  } else {
                    handleViewChange(item.id);
                  }
                }}
                className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg transition-all duration-200 group border ${
                  isActive && !isActionItem
                    ? 'font-medium hover:translate-x-0.5'
                    : 'border-transparent text-text-light-secondary dark:text-text-secondary hover:bg-ghost-surface-alt dark:hover:bg-pulse-surface-light hover:text-text-light-primary dark:hover:text-text-primary hover:translate-x-0.5'
                }`}
                style={
                  isActive && !isActionItem
                    ? {
                        backgroundColor: 'rgb(var(--tenant-accent-rgb) / 0.10)',
                        color: 'rgb(var(--tenant-accent-rgb))',
                        borderColor: 'rgb(var(--tenant-accent-rgb) / 0.22)',
                      }
                    : undefined
                }
                title={isCollapsed ? item.label : undefined}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition`}
                  style={
                    isActive && !isActionItem
                      ? { color: 'rgb(var(--tenant-accent-rgb))' }
                      : undefined
                  }
                />
                {!isCollapsed && (
                  <span className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-ghost-border dark:border-pulse-border space-y-1 flex-shrink-0 min-w-0">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg text-text-light-secondary dark:text-text-secondary hover:bg-ghost-surface-alt dark:hover:bg-pulse-surface-light hover:text-text-light-primary dark:hover:text-text-primary transition`}
          title={isCollapsed ? (theme === 'light' ? 'Dark mode' : 'Light mode') : undefined}
        >
          {theme === 'light' ? (
            <Moon className="w-5 h-5" />
          ) : (
            <Sun className="w-5 h-5" />
          )}
          {!isCollapsed && (
            <span className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">
              {theme === 'light' ? 'Dark mode' : 'Light mode'}
            </span>
          )}
        </button>

        <button
          onClick={() => setIsSettingsOpen(true)}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg text-text-light-secondary dark:text-text-secondary hover:bg-ghost-surface-alt dark:hover:bg-pulse-surface-light hover:text-text-light-primary dark:hover:text-text-primary transition`}
          title={isCollapsed ? 'Settings' : undefined}
        >
          <Settings className="w-5 h-5" />
          {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">Settings</span>}
        </button>

        <button
          onClick={() => setIsFeedbackOpen(true)}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg text-text-light-secondary dark:text-text-secondary hover:bg-ghost-surface-alt dark:hover:bg-pulse-surface-light hover:text-text-light-primary dark:hover:text-text-primary transition`}
          title={isCollapsed ? 'Feedback' : undefined}
        >
          <MessageCircle className="w-5 h-5" />
          {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">Feedback</span>}
        </button>

        <button
          onClick={handleLogout}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg text-text-light-secondary dark:text-text-secondary hover:bg-ghost-surface-alt dark:hover:bg-pulse-surface-light hover:text-red-600 transition`}
          title={isCollapsed ? 'Sign out' : undefined}
        >
          <LogOut className="w-5 h-5" />
          {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">Sign out</span>}
        </button>
      </div>

      {/* Settings Modal */}
      <SettingsPage
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isAdmin={isAdmin}
        currentUser={currentUser}
      />

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        context="general"
      />
    </div>
  );
}
