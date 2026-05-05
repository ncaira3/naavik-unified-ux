import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Home,
  Eye,
  Boxes,
  Radio,
  Settings,
  LogOut,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Building2,
  ChevronDown,
  Zap,
  Code2,
  MapPin,
  LucideIcon,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useChat, type ChatStream } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useMarket } from '../context/MarketContext';
import type { AppRegistryEntry } from '../platform/types';
import { getVisibleApps } from '../platform/appRegistry';
import FeedbackModal from './FeedbackModal';

const STREAM_META: { id: ChatStream; label: string; Icon: LucideIcon; viewId: string; color: string }[] = [
  { id: 'universal',     label: 'Home',      Icon: Zap,           viewId: 'home',      color: '#a78bfa' },
  { id: 'observability', label: 'Observe',   Icon: Eye,           viewId: 'observe',   color: '#38bdf8' },
  { id: 'provision',     label: 'Provision', Icon: Radio,         viewId: 'provision', color: '#34d399' },
  { id: 'appgen',        label: 'AppGen',    Icon: Code2,         viewId: 'appgen',    color: '#fbbf24' },
  { id: 'knowledge',     label: 'Knowledge', Icon: Home,          viewId: 'home',      color: '#f87171' },
];

const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  Eye,
  Boxes,
  Radio,
  Settings,
  MessageCircle,
  Sparkles,
};

/** Enough for logo + expand control on one row (Claude-style) */
const COLLAPSED_PX = 68;
const EXPANDED_PX = 248;

interface AppLeftSidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  registry: AppRegistryEntry[];
}

// ── Portal tooltip — renders at body level so overflow:hidden can't clip it ──
function NavLabelTooltip({ label, anchorEl, visible }: {
  label: string;
  anchorEl: HTMLElement | null;
  visible: boolean;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Recompute on every hover, stays locked to the button center
  useEffect(() => {
    if (!visible || !anchorEl) { setRect(null); return; }
    setRect(anchorEl.getBoundingClientRect());
  }, [visible, anchorEl]);

  if (!visible || !rect) return null;

  // Pin left edge of tooltip to right edge of sidebar + small gap
  const top  = rect.top + rect.height / 2;   // vertical center of icon
  const left = rect.right + 8;               // just outside the sidebar border

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none select-none"
      style={{ top, left, transform: 'translateY(-50%)' }}
    >
      {/* Sliding pill */}
      <div
        className="flex items-center gap-2.5 pl-2.5 pr-4 rounded-xl text-[13px] font-semibold whitespace-nowrap"
        style={{
          height: 36,
          background: 'rgba(18,20,30,0.94)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.04)',
          backdropFilter: 'blur(12px)',
          color: '#f1f5f9',
          animation: 'navLabelSlide 0.22s cubic-bezier(0.22,1,0.36,1) both',
        }}
      >
        {/* Indigo accent pip aligned with icon center */}
        <span style={{
          width: 3, height: 16, borderRadius: 99,
          background: 'linear-gradient(180deg,#818cf8,#6366f1)',
          flexShrink: 0,
        }} />
        {label}
      </div>
      {/* Caret pointing left back at the sidebar */}
      <div style={{
        position: 'absolute',
        right: '100%',
        top: '50%',
        transform: 'translateY(-50%)',
        marginRight: -1,
        width: 0, height: 0,
        borderTop: '5px solid transparent',
        borderBottom: '5px solid transparent',
        borderRight: '6px solid rgba(18,20,30,0.94)',
      }} />
    </div>,
    document.body
  );
}

// ── Single nav button with portal label ─────────────────────────────────────
function NavItemButton({ label, isActive, expanded, onClick, children }: {
  label: string;
  isActive: boolean;
  expanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`flex w-full items-center rounded-lg text-left text-sm font-medium transition-all duration-150 ${
          expanded ? 'gap-3 px-2.5 py-2' : 'justify-center px-0 py-2.5'
        } ${
          isActive
            ? 'border border-border bg-cream-surface-light text-text-primary dark:border-white/20 dark:bg-white/10 dark:text-text-primary'
            : 'text-text-muted hover:bg-slate-200 hover:text-slate-900 dark:text-text-secondary dark:hover:bg-pulse-surface-light dark:hover:text-text-primary'
        }`}
      >
        {children}
        {expanded && <span className="min-w-0 truncate">{label}</span>}
      </button>
      {!expanded && (
        <NavLabelTooltip label={label} anchorEl={ref.current} visible={hovered} />
      )}
    </>
  );
}

export default function AppLeftSidebar({
  activeView,
  onViewChange,
  registry,
}: AppLeftSidebarProps) {
  const { theme } = useTheme();
  const { user, appPermissions } = useAuth();
  const { historyByStream } = useChat();
  const { market, promptForMarket } = useMarket();
  const [expanded, setExpanded] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [collapsedStreams, setCollapsedStreams] = useState<Partial<Record<ChatStream, boolean>>>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const collapsedMenuRef = useRef<HTMLDivElement>(null);
  const closeMenuTimeoutRef = useRef<number | null>(null);
  const [collapsedMenuRect, setCollapsedMenuRect] = useState<{
    bottom: number;
    left: number;
  } | null>(null);

  const toggleStream = (id: ChatStream) =>
    setCollapsedStreams((p) => ({ ...p, [id]: !p[id] }));

  const activeStreamMeta = STREAM_META.filter(
    (s) => (historyByStream[s.id] ?? []).some((m) => m.role === 'user')
  );

  // Settings is moved into the profile dropdown — exclude it from the nav rail.
  const visibleApps = getVisibleApps(registry, user, appPermissions)
    .filter((app) => app.id !== 'settings')
    .sort((a, b) => a.order - b.order);
  const displayName = user?.username || 'User';
  const displayInitial = displayName.charAt(0).toUpperCase() || 'U';

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedMainMenu = menuRef.current?.contains(target);
      const clickedCollapsedMenu = collapsedMenuRef.current?.contains(target);
      if (!clickedMainMenu && !clickedCollapsedMenu) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen || expanded) {
      setCollapsedMenuRect(null);
      return;
    }
    const anchor = userButtonRef.current;
    if (!anchor) return;
    const updateRect = () => {
      const rect = anchor.getBoundingClientRect();
      // Anchor the menu's BOTTOM near the bottom of the user button so it grows
      // UPWARD as items are added — otherwise the menu falls below the viewport.
      setCollapsedMenuRect({
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 8,
      });
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [userMenuOpen, expanded]);

  useEffect(() => {
    return () => {
      if (closeMenuTimeoutRef.current !== null) {
        window.clearTimeout(closeMenuTimeoutRef.current);
      }
    };
  }, []);

  const openUserMenu = () => {
    if (closeMenuTimeoutRef.current !== null) {
      window.clearTimeout(closeMenuTimeoutRef.current);
      closeMenuTimeoutRef.current = null;
    }
    setUserMenuOpen(true);
  };

  const closeUserMenuWithDelay = (delayMs = 140) => {
    if (closeMenuTimeoutRef.current !== null) {
      window.clearTimeout(closeMenuTimeoutRef.current);
    }
    closeMenuTimeoutRef.current = window.setTimeout(() => {
      setUserMenuOpen(false);
      closeMenuTimeoutRef.current = null;
    }, delayMs);
  };

  const handleLogout = async () => {
    await api.logout();
    window.location.reload();
  };

  const widthPx = expanded ? EXPANDED_PX : COLLAPSED_PX;

  return (
    <>
      <aside
        className="flex flex-col h-full shrink-0 border-r border-border bg-cream-bg text-text-primary transition-[width] duration-200 ease-out dark:border-pulse-border dark:bg-pulse-surface dark:text-text-primary overflow-hidden"
        style={{ width: widthPx }}
      >
        <div className={`border-b border-border dark:border-pulse-border ${expanded ? 'px-3 py-3' : 'px-1 py-2.5'}`}>
          {expanded ? (
            <div className="flex items-center justify-between gap-3">
              <img
                src={theme === 'dark' ? '/naavik-full-logo-transparent.png' : '/naavik-full-logo-transparent.png'}
                alt="Aira Naavik"
                className="h-11 w-auto max-w-[172px] object-contain object-left transition-[filter] duration-200"
                style={theme === 'dark' ? { filter: 'invert(1) hue-rotate(180deg)' } : undefined}
                title="Aira Naavik"
              />
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-150 hover:scale-[0.95] active:scale-[0.90] text-slate-900 dark:text-white hover:text-black dark:hover:text-white"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                aria-expanded={expanded}
              >
                <ChevronLeft className="h-6 w-6" strokeWidth={3} />
              </button>
            </div>
          ) : (
            <div className="relative flex items-center justify-center">
              <img
                src="/aira-logo.png"
                alt="Aira"
                className="h-7 w-7 object-contain"
                title="Aira"
              />
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="absolute -right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-slate-500/40 dark:text-white/30 transition-all duration-150 hover:text-slate-900 dark:hover:text-white hover:scale-[0.95] active:scale-[0.90]"
                title="Expand sidebar"
                aria-label="Expand sidebar"
                aria-expanded={expanded}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-1.5 py-2 scrollbar-thin">
          {visibleApps.map((item) => {
            const IconComponent = ICON_MAP[item.iconName];
            const isActive = activeView === item.id;
            return (
              <NavItemButton
                key={item.id}
                label={item.displayName}
                isActive={isActive}
                expanded={expanded}
                onClick={() => onViewChange(item.id)}
              >
                {IconComponent ? (
                  <IconComponent className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                ) : null}
              </NavItemButton>
            );
          })}

          {/* Session history — only visible when sidebar is expanded and there are messages */}
          {expanded && activeStreamMeta.length > 0 && (
            <>
              <div className="my-1 border-t border-border dark:border-pulse-border" />
              <p className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted dark:text-text-muted">
                Session History
              </p>
              {activeStreamMeta.map(({ id, label, Icon, viewId, color }) => {
                const userMsgs = (historyByStream[id] ?? []).filter((m) => m.role === 'user');
                const isCollapsed = collapsedStreams[id] ?? false;
                return (
                  <div key={id}>
                    {/* Stream header row */}
                    <button
                      type="button"
                      onClick={() => toggleStream(id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all duration-150 hover:bg-slate-100 dark:hover:bg-pulse-surface-light"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} strokeWidth={2} />
                      <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted dark:text-text-secondary">
                        {label}
                      </span>
                      <span className="text-[10px] text-text-muted dark:text-text-muted">{userMsgs.length}</span>
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 text-text-muted dark:text-text-muted transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                      />
                    </button>

                    {/* Message list */}
                    {!isCollapsed && (
                      <div className="ml-4 border-l border-border dark:border-white/8 pl-2 pb-1 space-y-0.5">
                        {userMsgs.slice(-10).map((msg) => (
                          <button
                            key={msg.id}
                            type="button"
                            onClick={() => onViewChange(viewId)}
                            className="w-full rounded-md px-2 py-1.5 text-left transition-all duration-150 hover:bg-slate-100 dark:hover:bg-pulse-surface-light group"
                          >
                            <p className="line-clamp-2 text-[11.5px] leading-snug text-text-secondary dark:text-text-secondary group-hover:text-slate-900 dark:group-hover:text-text-primary">
                              {msg.content.slice(0, 72)}
                            </p>
                            <p className="mt-0.5 text-[10px] text-text-muted dark:text-text-muted">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </nav>

        {/* Footer — Claude-style profile block */}
        <div
          ref={menuRef}
          className="relative border-t border-border dark:border-pulse-border p-2"
          onMouseEnter={openUserMenu}
          onMouseLeave={() => closeUserMenuWithDelay()}
        >
          <button
            ref={userButtonRef}
            type="button"
            onClick={openUserMenu}
            onFocus={openUserMenu}
            className={`flex w-full items-center rounded-lg transition-all duration-150 hover:bg-slate-100 dark:hover:bg-pulse-surface-light ${
              expanded ? 'gap-2.5 px-2 py-2' : 'justify-center px-0 py-2'
            } ${userMenuOpen ? 'bg-cream-surface-light dark:bg-pulse-surface-light' : ''}`}
            title={expanded ? undefined : 'Account'}
          >
            <div className="relative shrink-0">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full bg-tenant-primary text-xs font-semibold text-white shadow-[0_10px_24px_rgb(var(--tenant-accent-rgb)/0.22)]"
              >
                {displayInitial}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-cream-surface shadow-sm dark:border-pulse-surface dark:bg-pulse-surface-light">
                <Building2 className="h-2.5 w-2.5 text-tenant-primary" />
              </div>
            </div>
            {expanded && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-semibold text-text-primary">
                    {displayName}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    Aira-technology
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-text-secondary transition-transform duration-150 ${
                    userMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </>
            )}
          </button>

          {userMenuOpen && expanded && (
            <div
              className={`absolute z-50 overflow-hidden rounded-xl border bg-cream-surface py-1 shadow-xl dark:border-pulse-border dark:bg-pulse-surface border-border ${
                expanded
                  ? 'bottom-full mb-1 left-2 right-2'
                  : 'bottom-2 left-full ml-2 w-44'
              }`}
            >
              {/* Market */}
              <button
                type="button"
                onClick={() => { setUserMenuOpen(false); promptForMarket(); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-slate-100 transition-colors duration-150 dark:hover:bg-pulse-surface-light"
              >
                <MapPin className="h-4 w-4 shrink-0 text-text-secondary" />
                <span className="flex-1 truncate">Market</span>
                <span className="text-[11px] truncate max-w-[110px] text-text-muted">{market?.label ?? '—'}</span>
              </button>
              {/* Settings */}
              <button
                type="button"
                onClick={() => { setUserMenuOpen(false); onViewChange('settings'); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-slate-100 transition-colors duration-150 dark:hover:bg-pulse-surface-light"
              >
                <Settings className="h-4 w-4 shrink-0 text-text-secondary" />
                Settings
              </button>
              {/* Feedback */}
              <button
                type="button"
                onClick={() => { setUserMenuOpen(false); setIsFeedbackOpen(true); }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-slate-100 transition-colors duration-150 dark:hover:bg-pulse-surface-light"
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-text-secondary" />
                Feedback
              </button>
              <div className="my-1 border-t border-border dark:border-pulse-border" />
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors duration-150 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      {userMenuOpen && !expanded && collapsedMenuRect && createPortal(
        <div
          ref={collapsedMenuRef}
          onMouseEnter={openUserMenu}
          onMouseLeave={() => closeUserMenuWithDelay()}
          className="fixed z-[1000] w-56 overflow-hidden rounded-xl border border-border bg-cream-surface py-1 shadow-xl dark:border-pulse-border dark:bg-pulse-surface"
          style={{
            bottom: collapsedMenuRect.bottom,
            left: collapsedMenuRect.left,
          }}
        >
          <button
            type="button"
            onClick={() => { setUserMenuOpen(false); promptForMarket(); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-slate-100 transition-colors duration-150 dark:hover:bg-pulse-surface-light"
          >
            <MapPin className="h-4 w-4 shrink-0 text-text-secondary" />
            <span className="flex-1 truncate">Market</span>
            <span className="text-[10px] text-text-muted truncate max-w-[80px]">{market?.label ?? '—'}</span>
          </button>
          <button
            type="button"
            onClick={() => { setUserMenuOpen(false); onViewChange('settings'); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-slate-100 transition-colors duration-150 dark:hover:bg-pulse-surface-light"
          >
            <Settings className="h-4 w-4 shrink-0 text-text-secondary" />
            Settings
          </button>
          <button
            type="button"
            onClick={() => { setUserMenuOpen(false); setIsFeedbackOpen(true); }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-slate-100 transition-colors duration-150 dark:hover:bg-pulse-surface-light"
          >
            <MessageCircle className="h-4 w-4 shrink-0 text-text-secondary" />
            Feedback
          </button>
          <div className="my-1 border-t border-border dark:border-pulse-border" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-500 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log out
          </button>
        </div>,
        document.body
      )}

      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        context="general"
      />
    </>
  );
}
