/**
 * Settings Page View - Full page settings with tabs
 * Displays appearance, profile, and admin management
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Moon,
  Sun,
  Monitor,
  User,
  Shield,
  Plus,
  Edit2,
  Trash2,
  Check,
  AlertCircle,
  Palette,
  Package,
  Database,
  Play,
  Plug,
} from 'lucide-react';
import IntegrationsTab from './Settings/IntegrationsTab';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import { useTheme } from '../context/ThemeContext';
import { useTenant } from '../context/TenantContext';
import { useAuth } from '../context/AuthContext';
import { useDummifier } from '../context/DummifierContext';
import api from '../services/api';
import { AppRegistryEntry } from '../platform/types';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  joinDate: string;
  status: 'active' | 'inactive';
}

const CURRENT_USER = {
  id: '1',
  name: 'Admin User',
  email: 'admin@naavik.io',
  role: 'admin' as const,
};

const IS_ADMIN = true;
const OEM_OPTIONS = ['Ericsson', 'Nokia', 'Samsung', 'Multi-OEM'] as const;

// ─── SQL Query Tester sub-component ─────────────────────────────────────────

interface DataQueryTesterProps {
  isDark: boolean;
  queryText: string;
  setQueryText: (v: string) => void;
  queryRunning: boolean;
  queryRows: Record<string, any>[];
  queryColDefs: ColDef[];
  queryMeta: { rowCount: number; durationMs: number } | null;
  queryError: string | null;
  onRun: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

function DataQueryTester({
  isDark, queryText, setQueryText, queryRunning,
  queryRows, queryColDefs, queryMeta, queryError,
  onRun, onKeyDown, textareaRef,
}: DataQueryTesterProps) {
  const bg       = isDark ? '#111113' : '#FFFFFF';
  const bgSubtle = isDark ? '#0d0d0f' : '#F8FAFC';
  const bgOdd    = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(15,23,42,0.025)';
  const textPri  = isDark ? '#e2e8f0' : '#0F172A';
  const textMuted = isDark ? '#64748b' : '#475569';
  const border   = isDark ? 'rgba(255,255,255,0.07)' : '#E2E8F0';
  const rowHover = isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)';
  const rowSel   = isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.10)';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-tenant-primary" />
          SQL Query Tester
        </h2>
        <p className="text-sm text-text-light-secondary dark:text-text-secondary">
          Run read-only SELECT queries directly against the remote MSSQL data adapter.
          Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs font-mono">Ctrl+Enter</kbd> to run.
        </p>
      </div>

      {/* SQL Textarea */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          rows={7}
          className="w-full px-4 py-3 rounded-xl border font-mono text-[13px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-tenant-primary/40 transition"
          style={{
            background: isDark ? '#0d0d0f' : '#f8fafc',
            borderColor: border,
            color: textPri,
          }}
          placeholder="SELECT TOP 20 * FROM site_table WITH (NOLOCK) WHERE ..."
        />
      </div>

      {/* Run button + status */}
      <div className="flex items-center gap-3">
        <button
          onClick={onRun}
          disabled={queryRunning || !queryText.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
        >
          <Play className="w-3.5 h-3.5" />
          {queryRunning ? 'Running…' : 'Run Query'}
        </button>
        {queryMeta && !queryRunning && (
          <span className="text-xs text-text-light-secondary dark:text-text-secondary">
            {queryMeta.rowCount} rows · {queryMeta.durationMs}ms
          </span>
        )}
      </div>

      {/* Error */}
      {queryError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200 font-mono whitespace-pre-wrap">
          {queryError}
        </div>
      )}

      {/* Results grid */}
      {queryColDefs.length > 0 && (
        <div
          className="rounded-xl overflow-hidden border"
          style={{ borderColor: border, height: Math.min(520, Math.max(130, 38 + queryRows.length * 40 + 2)) }}
        >
          <AgGridReact
            theme={themeQuartz.withParams({
              backgroundColor: bg,
              oddRowBackgroundColor: bgOdd,
              headerBackgroundColor: bgSubtle,
              headerTextColor: textMuted,
              foregroundColor: textPri,
              borderColor: border,
              rowHoverColor: rowHover,
              selectedRowBackgroundColor: rowSel,
              fontSize: 12,
              fontFamily: 'Inter, system-ui, sans-serif',
              cellHorizontalPaddingScale: 1.1,
              rowHeight: 40,
              headerHeight: 38,
              wrapperBorder: false,
            })}
            columnDefs={queryColDefs}
            rowData={queryRows}
            defaultColDef={{ sortable: true, resizable: true, filter: true }}
            animateRows
          />
        </div>
      )}

      {queryMeta && queryRows.length === 0 && !queryError && (
        <div className="p-4 rounded-xl border text-sm text-center text-text-light-secondary dark:text-text-secondary" style={{ borderColor: border }}>
          Query returned 0 rows.
        </div>
      )}
    </div>
  );
}

// ─── Main settings page ──────────────────────────────────────────────────────

export default function SettingsPageView() {
  const { theme, themeMode, setThemeMode } = useTheme();
  const { currentOperator, allOperators, setOperator } = useTenant();
  const { user } = useAuth();
  const { enabled: dummifierEnabled, toggle: toggleDummifier, dId: demoUsidPreview } = useDummifier();
  const [activeTab, setActiveTab] = useState<'appearance' | 'appgen' | 'profile' | 'integrations' | 'admin' | 'apps' | 'data'>('appearance');
  const [_editingUser, _setEditingUser] = useState<User | null>(null);
  const [_showAddUserModal, setShowAddUserModal] = useState(false);

  // App management state
  const [registry, setRegistry] = useState<AppRegistryEntry[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [savingAppState, setSavingAppState] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin';

  // Add app form state
  type AddAppContainerType = 'iframe' | 'federated';
  interface AddAppForm {
    containerType: AddAppContainerType;
    displayName: string;
    iconName: string;
    order: string;
    iframeUrl: string;
    iframeSandbox: string;
    remoteUrl: string;
    remoteName: string;
    exposedModule: string;
  }
  const EMPTY_FORM: AddAppForm = {
    containerType: 'iframe',
    displayName: '',
    iconName: 'Globe',
    order: '99',
    iframeUrl: '',
    iframeSandbox: '',
    remoteUrl: '',
    remoteName: '',
    exposedModule: '',
  };
  const [addAppForm, setAddAppForm] = useState<AddAppForm>(EMPTY_FORM);
  const [addAppError, setAddAppError] = useState<string | null>(null);
  const [addAppSaving, setAddAppSaving] = useState(false);
  const [addAppSuccess, setAddAppSuccess] = useState(false);

  // SQL Query Tester state
  const DEFAULT_SQL = `SELECT TOP 20 USID, degraded_category, rca_bucket, short_summary\nFROM site_table WITH (NOLOCK)\nWHERE chain_of_thought IS NOT NULL\nAND CAST(DATE_ID AS DATE) = CAST(DATEADD(day, -3, GETDATE()) AS DATE)\nORDER BY USID`;
  const [queryText, setQueryText] = useState(DEFAULT_SQL);
  const [queryRows, setQueryRows] = useState<Record<string, any>[]>([]);
  const [queryColDefs, setQueryColDefs] = useState<ColDef[]>([]);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryMeta, setQueryMeta] = useState<{ rowCount: number; durationMs: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runQuery = useCallback(async () => {
    const sql = queryText.trim();
    if (!sql) return;
    setQueryRunning(true);
    setQueryError(null);
    setQueryMeta(null);
    setQueryRows([]);
    setQueryColDefs([]);
    try {
      const res = await api.post('/platform/admin/query', { sql });
      const rawRows: Record<string, any>[] = res.rows ?? [];

      // MSSQL returns unnamed columns as "" or "(No column name)" — sanitize to col_N
      const sanitize = (key: string, i: number) =>
        key && key.trim() && key !== '(No column name)' ? key : `col_${i + 1}`;

      const rawKeys = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
      const cleanKeys = rawKeys.map(sanitize);
      const needsRemap = rawKeys.some((k, i) => k !== cleanKeys[i]);

      const rows = needsRemap
        ? rawRows.map((r) =>
            Object.fromEntries(rawKeys.map((k, i) => [cleanKeys[i], r[k]]))
          )
        : rawRows;

      const cols: ColDef[] = cleanKeys.map((field) => ({
        field,
        headerName: field,
        flex: 1,
        minWidth: 120,
        sortable: true,
        resizable: true,
        filter: true,
      }));

      setQueryColDefs(cols);
      setQueryRows(rows);
      setQueryMeta({ rowCount: res.rowCount, durationMs: res.durationMs });
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      setQueryError(serverMsg || err?.message || 'Query failed');
    } finally {
      setQueryRunning(false);
    }
  }, [queryText]);

  const handleQueryKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void runQuery();
    }
  }, [runQuery]);

  // Welcome Modals and OEM settings
  const [showIntroModals, setShowIntroModals] = useState(true);
  const [enabledOems, setEnabledOems] = useState<string[]>(['Ericsson', 'Nokia', 'Samsung', 'Multi-OEM']);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load settings
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await api.getAppGenSettings();
        if (mounted) {
          setEnabledOems(response.data?.enabledOems || ['Ericsson', 'Nokia', 'Samsung', 'Multi-OEM']);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  // Load app registry for admins
  useEffect(() => {
    if (!isAdmin) return;

    let mounted = true;
    const loadRegistry = async () => {
      setLoadingApps(true);
      try {
        const response = await api.get('/platform/registry/all');
        if (mounted && response) {
          setRegistry(response);
        }
      } catch (error) {
        console.error('Failed to load app registry:', error);
      } finally {
        if (mounted) setLoadingApps(false);
      }
    };

    void loadRegistry();
    return () => {
      mounted = false;
    };
  }, [isAdmin]);

  // Load intro modals preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('naavik-show-intro-modals');
      setShowIntroModals(saved === null ? true : saved === 'true');
    } catch {
      setShowIntroModals(true);
    }
  }, []);

  const toggleIntroModals = () => {
    const newValue = !showIntroModals;
    setShowIntroModals(newValue);
    try {
      localStorage.setItem('naavik-show-intro-modals', String(newValue));
    } catch {
      // no-op
    }
  };

  const resetSessionDismissal = () => {
    try {
      sessionStorage.removeItem('naavik-home-intro-dismissed');
    } catch {
      // no-op
    }
  };

  const toggleOem = (oem: string) => {
    setEnabledOems((prev) => {
      const has = prev.includes(oem);
      if (has) {
        const next = prev.filter((v) => v !== oem);
        return next.length > 0 ? next : prev;
      }
      return [...prev, oem];
    });
    setSaveMsg(null);
  };

  const setEricssonOnly = () => {
    setEnabledOems(['Ericsson']);
    setSaveMsg(null);
  };

  const setAllOems = () => {
    setEnabledOems([...OEM_OPTIONS]);
    setSaveMsg(null);
  };

  const saveOemConfig = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const response = await api.updateAppGenOems(enabledOems);
      setEnabledOems(response.data?.enabledOems || enabledOems);
      setSaveMsg('Saved AppGen OEM policy.');
    } catch (error: any) {
      setSaveMsg(error?.message || 'Failed to save OEM policy.');
    } finally {
      setSaving(false);
    }
  };

  // Mock users list
  const [users, setUsers] = useState<User[]>([
    {
      id: '1',
      name: 'You',
      email: CURRENT_USER.email,
      role: 'admin',
      joinDate: '2024-01-15',
      status: 'active',
    },
    {
      id: '2',
      name: 'John Developer',
      email: 'john@naavik.io',
      role: 'user',
      joinDate: '2024-02-01',
      status: 'active',
    },
    {
      id: '3',
      name: 'Sarah Engineer',
      email: 'sarah@naavik.io',
      role: 'admin',
      joinDate: '2024-01-20',
      status: 'active',
    },
  ]);

  const handleThemeChange = (mode: 'light' | 'dark' | 'system') => {
    setThemeMode(mode);
  };

  const handleDeleteUser = (userId: string) => {
    if (userId === CURRENT_USER.id) {
      alert('Cannot delete yourself');
      return;
    }
    setUsers(users.filter((u) => u.id !== userId));
  };

  const handlePromoteToAdmin = (userId: string) => {
    setUsers(
      users.map((u) =>
        u.id === userId ? { ...u, role: 'admin' as const } : u
      )
    );
  };

  const toggleAppActive = async (appId: string, isActive: boolean) => {
    setSavingAppState(appId);
    try {
      await api.put(`/platform/registry/${appId}`, { isActive: !isActive });
      setRegistry(registry.map((app) => (app.id === appId ? { ...app, isActive: !isActive } : app)));
    } catch (error) {
      console.error('Failed to toggle app:', error);
    } finally {
      setSavingAppState(null);
    }
  };

  const handleAddApp = async () => {
    // Validate
    if (!addAppForm.displayName.trim()) {
      setAddAppError('App name is required.');
      return;
    }

    if (addAppForm.containerType === 'iframe') {
      if (!addAppForm.iframeUrl.trim()) {
        setAddAppError('App URL is required.');
        return;
      }
      try {
        new URL(addAppForm.iframeUrl);
      } catch {
        setAddAppError('App URL must be a valid URL (e.g., https://example.com).');
        return;
      }
    }

    if (addAppForm.containerType === 'federated') {
      if (!addAppForm.remoteUrl.trim() || !addAppForm.remoteName.trim() || !addAppForm.exposedModule.trim()) {
        setAddAppError('Remote URL, Remote Name, and Exposed Module are all required for federated apps.');
        return;
      }
      try {
        new URL(addAppForm.remoteUrl);
      } catch {
        setAddAppError('Remote URL must be a valid URL.');
        return;
      }
    }

    setAddAppSaving(true);
    setAddAppError(null);
    setAddAppSuccess(false);

    // Generate app ID from display name
    const id = addAppForm.displayName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    const payload: any = {
      id,
      displayName: addAppForm.displayName.trim(),
      iconName: addAppForm.iconName.trim() || 'Globe',
      order: parseInt(addAppForm.order, 10) || 99,
      containerType: addAppForm.containerType,
      isActive: true,
    };

    if (addAppForm.containerType === 'iframe') {
      payload.iframeUrl = addAppForm.iframeUrl.trim();
      if (addAppForm.iframeSandbox.trim()) {
        payload.iframeSandbox = addAppForm.iframeSandbox.trim();
      }
    } else if (addAppForm.containerType === 'federated') {
      payload.remoteUrl = addAppForm.remoteUrl.trim();
      payload.remoteName = addAppForm.remoteName.trim();
      payload.exposedModule = addAppForm.exposedModule.trim();
    }

    try {
      await api.post('/platform/registry', payload);
      setAddAppSuccess(true);
      setAddAppForm(EMPTY_FORM);
      // Reload the registry list
      const updated = await api.get('/platform/registry/all');
      if (updated) {
        setRegistry(updated);
      }
      // Clear success message after 3 seconds
      setTimeout(() => setAddAppSuccess(false), 3000);
    } catch (err: any) {
      setAddAppError(err?.message || 'Failed to add app. Check the server logs.');
      console.error('Error adding app:', err);
    } finally {
      setAddAppSaving(false);
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-light-primary dark:text-text-primary mb-2">
          Settings
        </h1>
        <p className="text-text-light-secondary dark:text-text-secondary">
          API keys, preferences, and system configuration
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-8 border-b border-border dark:border-slate-700">
        <div className="flex gap-8">
          {[
            { id: 'appearance' as const, label: 'Appearance', icon: Monitor },
            { id: 'appgen' as const, label: 'AppGen', icon: Plus },
            { id: 'profile' as const, label: 'Profile', icon: User },
            { id: 'integrations' as const, label: 'Integrations', icon: Plug },
            ...(IS_ADMIN || isAdmin
              ? [
                  { id: 'admin' as const, label: 'Admin Panel', icon: Shield },
                  { id: 'apps' as const, label: 'Apps', icon: Package },
                  { id: 'data' as const, label: 'Data', icon: Database },
                ]
              : []),
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`pb-4 font-medium transition border-b-2 ${
                activeTab === id
                  ? 'border-tenant-primary text-tenant-primary'
                  : 'border-transparent text-text-light-secondary dark:text-text-secondary hover:text-text-light-primary dark:hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl">
        {/* Appearance Settings */}
        {activeTab === 'appearance' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-4">
                Theme
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { mode: 'light' as const, label: 'Light', icon: Sun },
                  { mode: 'dark' as const, label: 'Dark', icon: Moon },
                  { mode: 'system' as const, label: 'System', icon: Monitor },
                ].map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    onClick={() => handleThemeChange(mode)}
                    className={`p-4 rounded-lg border-2 transition flex items-center gap-3 ${
                      themeMode === mode
                        ? 'border-tenant-primary bg-tenant-light/80'
                        : 'border-border dark:border-slate-700 hover:border-tenant-primary/50 bg-cream-surface dark:bg-transparent'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium text-sm">{label}</span>
                    {themeMode === mode && (
                      <Check className="w-4 h-4 ml-auto text-tenant-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>


            <div className="pt-6 border-t border-border dark:border-slate-700">
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-4">
                Welcome Modals
              </h2>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-4">
                Show intro and overview modals when entering the app. Toggle to go straight to the chatbot.
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleIntroModals}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      showIntroModals
                        ? 'bg-tenant-primary'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-cream-surface transition-transform ${
                        showIntroModals ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className="text-sm text-text-light-primary dark:text-text-primary">
                    {showIntroModals ? 'Enabled – Intro modals will show' : 'Disabled – Go straight to chatbot'}
                  </span>
                </div>
                {showIntroModals && (
                  <button
                    type="button"
                    onClick={resetSessionDismissal}
                    className="px-3 py-1.5 rounded-lg border border-border dark:border-slate-700 text-xs text-text-secondary dark:text-text-primary hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    Show Now
                  </button>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-border dark:border-slate-700">
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-4">
                Demo Mode — Anonymize Site IDs
              </h2>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-4">
                Masks real USIDs with synthetic <span className="font-mono">USTXXXXXX</span> identifiers throughout the UI (maps, charts, chat, tables). Useful for demos and screenshots. Purely visual — does not alter backend data.
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleDummifier}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      dummifierEnabled
                        ? 'bg-tenant-primary'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-cream-surface transition-transform ${
                        dummifierEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className="text-sm text-text-light-primary dark:text-text-primary">
                    {dummifierEnabled ? 'Enabled — Site IDs are anonymized' : 'Disabled — Real Site IDs shown'}
                  </span>
                </div>
                <span className="text-xs font-mono text-text-light-secondary dark:text-text-secondary">
                  e.g. 9817 → {demoUsidPreview('9817') || 'UST…'}
                </span>
              </div>
            </div>

          </div>
        )}

        {/* AppGen Settings */}
        {activeTab === 'appgen' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-4">
                Naavik AppGen OEM Policy
              </h2>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-4">
                Configure supported OEMs for conversational AppGen. If only Ericsson is enabled, AppGen stays EIAP/rApp focused.
              </p>

              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={setEricssonOnly}
                  className="px-3 py-1.5 rounded-lg border border-border dark:border-slate-700 text-xs font-medium text-text-secondary dark:text-text-primary hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  Ericsson Only
                </button>
                <button
                  onClick={setAllOems}
                  className="px-3 py-1.5 rounded-lg border border-border dark:border-slate-700 text-xs font-medium text-text-secondary dark:text-text-primary hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  Enable All
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {OEM_OPTIONS.map((oem) => (
                  <button
                    key={oem}
                    onClick={() => toggleOem(oem)}
                    className={`p-4 rounded-lg border-2 transition text-left ${
                      enabledOems.includes(oem)
                        ? 'border-tenant-primary bg-tenant-light/80'
                        : 'border-border dark:border-slate-700 hover:border-tenant-primary/50 bg-cream-surface dark:bg-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                          enabledOems.includes(oem)
                            ? 'border-tenant-primary bg-tenant-primary'
                            : 'border-border dark:border-slate-700'
                        }`}
                      >
                        {enabledOems.includes(oem) && (
                          <Check className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <span className="font-medium text-text-light-primary dark:text-text-primary">
                        {oem}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={saveOemConfig}
                disabled={saving || loading}
                className="px-4 py-2 rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
              >
                {saving ? 'Saving...' : 'Save OEM Policy'}
              </button>

              {saveMsg && (
                <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
                  {saveMsg}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Profile Settings */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-4">
                Your Profile
              </h2>

              <div className="space-y-4">
                <div className="flex items-center gap-4 pb-4 border-b border-border dark:border-slate-700/70">
                  <div className="w-16 h-16 rounded-full bg-tenant-light/80 flex items-center justify-center">
                    <User className="w-8 h-8 text-tenant-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-text-light-primary dark:text-text-primary">
                      {CURRENT_USER.name}
                    </p>
                    <p className="text-sm text-text-light-secondary dark:text-text-secondary">
                      {CURRENT_USER.email}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Shield className="w-4 h-4 text-tenant-primary" />
                      <span className="text-xs font-medium capitalize text-tenant-primary">
                        {CURRENT_USER.role}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                      Name
                    </label>
                    <input
                      type="text"
                      defaultValue={CURRENT_USER.name}
                      disabled
                      className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-700 bg-cream-bg dark:bg-slate-850 text-text-secondary dark:text-slate-400 cursor-not-allowed"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      defaultValue={CURRENT_USER.email}
                      disabled
                      className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-700 bg-cream-bg dark:bg-slate-850 text-text-secondary dark:text-slate-400 cursor-not-allowed"
                    />
                  </div>
                </div>

                <button className="w-full px-4 py-2 rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover transition font-medium text-sm">
                  Change Password
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Integrations (MCP + A2A) */}
        {activeTab === 'integrations' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary flex items-center gap-2">
                <Plug className="w-5 h-5 text-tenant-primary" />
                Integrations
              </h2>
              <p className="mt-1 text-[13px] text-text-light-secondary dark:text-text-secondary">
                External MCP servers Naavik consumes for tools, and A2A agents Naavik can delegate workflows to.
              </p>
            </div>
            <IntegrationsTab />
          </div>
        )}

        {/* Admin Panel */}
        {activeTab === 'admin' && IS_ADMIN && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary flex items-center gap-2">
                  <Shield className="w-5 h-5 text-tenant-primary" />
                  User Management
                </h2>
                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover transition text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Admin
                </button>
              </div>

              <div className="space-y-3">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border dark:border-slate-700/70 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-text-light-primary dark:text-text-primary">
                          {user.name}
                        </p>
                        {user.role === 'admin' && (
                          <Shield className="w-4 h-4 text-tenant-primary" />
                        )}
                        {user.status === 'inactive' && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-cream-surface-light dark:bg-slate-700 text-text-primary dark:text-slate-100">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-light-secondary dark:text-text-secondary">
                        {user.email}
                      </p>
                      <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                        Joined {new Date(user.joinDate).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {user.role === 'user' && user.id !== CURRENT_USER.id && (
                        <button
                          onClick={() => handlePromoteToAdmin(user.id)}
                          className="p-2 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition"
                          title="Promote to Admin"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {user.id !== CURRENT_USER.id && (
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                          title="Remove User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Admin-only actions</p>
                <p className="mt-1 opacity-90">
                  Only admins can add new admins. Once promoted, a user cannot be demoted to regular user status.
                </p>
              </div>
            </div>

            {/* Branding Section */}
            <div className="pt-8 border-t border-border dark:border-slate-700">
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary flex items-center gap-2 mb-4">
                <Palette className="w-5 h-5 text-tenant-primary" />
                Operator Branding
              </h2>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-6">
                Select the telecom operator whose brand colors will be applied throughout the interface. This creates a cohesive co-branded experience between Aira and the selected operator.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {allOperators.map((operator) => (
                  <button
                    key={operator.id}
                    type="button"
                    aria-pressed={currentOperator.id === operator.id}
                    onClick={() => setOperator(operator.id)}
                    className={`group relative min-h-[152px] rounded-2xl border p-5 text-left transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-tenant-primary/40 ${
                      currentOperator.id === operator.id
                        ? 'border-tenant-primary bg-gradient-to-br from-tenant-light/75 via-tenant-light/45 to-transparent ring-1 ring-tenant-primary/20'
                        : 'border-slate-300/80 dark:border-slate-700 bg-white/40 dark:bg-slate-900/30 hover:border-tenant-primary/35 hover:bg-slate-50/80 dark:hover:bg-slate-800/45'
                    }`}
                    style={currentOperator.id === operator.id
                      ? { boxShadow: '0 18px 40px rgb(var(--tenant-accent-rgb) / 0.14)' }
                      : undefined}
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                    <div
                      className="mx-auto h-11 w-11 rounded-full shadow-[0_10px_24px_rgba(15,23,42,0.18)] ring-1 ring-white/10"
                      style={{ backgroundColor: operator.primary }}
                      title={operator.primary}
                    />
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <span className={`text-sm font-semibold text-center ${currentOperator.id === operator.id ? 'text-tenant-primary' : 'text-text-light-primary dark:text-text-primary'}`}>
                        {operator.name}
                      </span>
                      <span className="text-[11px] leading-5 text-text-light-secondary dark:text-text-secondary">
                        Derived accents and CTA states
                      </span>
                    </div>
                    {currentOperator.id === operator.id ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-tenant-primary/20 bg-tenant-light/80 px-2.5 py-1 text-[11px] font-medium text-tenant-primary">
                        <Check className="w-3.5 h-3.5" />
                        Active
                      </span>
                    ) : (
                      <span className="mt-1 text-[11px] font-medium text-text-light-secondary dark:text-text-secondary transition-colors group-hover:text-tenant-primary">
                        Apply theme
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-gradient-to-br from-ghost-surface via-white to-tenant-light/25 dark:from-slate-900/70 dark:via-slate-900/50 dark:to-tenant-light/10 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-light-secondary dark:text-text-secondary mb-3">
                  Current Selection
                </p>
                <div className="flex items-start gap-4">
                  <div
                    className="w-11 h-11 rounded-2xl shadow-[0_14px_32px_rgba(15,23,42,0.18)] ring-1 ring-white/10"
                    style={{
                      background: `linear-gradient(135deg, ${currentOperator.primary} 0%, rgb(var(--tenant-accent-rgb)) 100%)`,
                    }}
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-text-light-primary dark:text-text-primary">
                      {currentOperator.name}
                    </p>
                    <p className="mt-1 text-xs text-text-light-secondary dark:text-text-secondary">
                      Buttons, focus rings, selected states, and accent surfaces use a refined tonal mix from this brand hue.
                    </p>
                    <p className="mt-2 text-[11px] font-medium text-tenant-primary">
                      {currentOperator.primary}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Data / SQL Query Tester */}
        {activeTab === 'data' && (IS_ADMIN || isAdmin) && (
          <DataQueryTester
            isDark={theme === 'dark'}
            queryText={queryText}
            setQueryText={setQueryText}
            queryRunning={queryRunning}
            queryRows={queryRows}
            queryColDefs={queryColDefs}
            queryMeta={queryMeta}
            queryError={queryError}
            onRun={runQuery}
            onKeyDown={handleQueryKeyDown}
            textareaRef={textareaRef}
          />
        )}

        {/* Apps Management */}
        {activeTab === 'apps' && (IS_ADMIN || isAdmin) && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary flex items-center gap-2 mb-4">
                <Package className="w-5 h-5 text-tenant-primary" />
                Registered Apps
              </h2>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-4">
                Manage which apps are visible to users. Toggle to show/hide apps from the sidebar.
              </p>

              {loadingApps ? (
                <div className="p-4 text-center text-text-light-secondary dark:text-text-secondary">
                  Loading apps...
                </div>
              ) : (
                <div className="space-y-3">
                  {registry.map((app) => (
                    <div
                    key={app.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border dark:border-slate-700/70 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition"
                  >
                      <div className="flex-1">
                        <p className="font-medium text-text-light-primary dark:text-text-primary">
                          {app.displayName}
                        </p>
                        <p className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
                          {app.id} · {app.containerType}
                        </p>
                      </div>

                      <button
                        onClick={() => toggleAppActive(app.id, app.isActive)}
                        disabled={savingAppState === app.id}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed ${
                          app.isActive
                            ? 'bg-tenant-primary'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-cream-surface transition-transform ${
                            app.isActive ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 rounded-lg bg-tenant-light/75 border border-tenant-primary/20 flex gap-3">
              <AlertCircle className="w-5 h-5 text-tenant-primary flex-shrink-0 mt-0.5" />
              <div className="text-sm text-text-light-primary dark:text-text-primary">
                <p className="font-medium">Apps Management</p>
                <p className="mt-1 opacity-90">
                  Toggle apps on or off for all users. Core apps (Home, Observe, AppGen, Provision, Settings) cannot be deleted.
                </p>
              </div>
            </div>

            <div className="pt-8 border-t border-border dark:border-slate-700">
              <h3 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-4">
                Add External App
              </h3>
              <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-4">
                Register an external app (iframe or federated module). The app will appear in the sidebar once added.
              </p>

              <div className="space-y-4">
                {/* Container type selector */}
                <div>
                  <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                    App Type
                  </label>
                  <select
                    value={addAppForm.containerType}
                    onChange={(e) => {
                      const newType = e.target.value as AddAppContainerType;
                      setAddAppForm({ ...EMPTY_FORM, containerType: newType });
                      setAddAppError(null);
                      setAddAppSuccess(false);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary"
                  >
                    <option value="iframe">External Website (iframe)</option>
                    <option value="federated">Federated Module (Stage 2)</option>
                  </select>
                </div>

                {/* Shared fields */}
                <div>
                  <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Analytics Dashboard"
                    value={addAppForm.displayName}
                    onChange={(e) => setAddAppForm({ ...addAppForm, displayName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                    Icon Name (lucide-react)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Globe, BarChart, Settings"
                    value={addAppForm.iconName}
                    onChange={(e) => setAddAppForm({ ...addAppForm, iconName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                  />
                  <p className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
                    Icon name from lucide-react library
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                    Sidebar Order
                  </label>
                  <input
                    type="number"
                    value={addAppForm.order}
                    onChange={(e) => setAddAppForm({ ...addAppForm, order: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary"
                  />
                </div>

                {/* Conditional: iframe fields */}
                {addAppForm.containerType === 'iframe' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                        App URL *
                      </label>
                      <input
                        type="url"
                        placeholder="https://analytics.example.com"
                        value={addAppForm.iframeUrl}
                        onChange={(e) => setAddAppForm({ ...addAppForm, iframeUrl: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                        Sandbox Policy (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="allow-scripts allow-same-origin allow-forms allow-popups"
                        value={addAppForm.iframeSandbox}
                        onChange={(e) => setAddAppForm({ ...addAppForm, iframeSandbox: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                      />
                      <p className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
                        Leave blank to use default security policy
                      </p>
                    </div>
                  </>
                )}

                {/* Conditional: federated fields */}
                {addAppForm.containerType === 'federated' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                        Remote Entry URL *
                      </label>
                      <input
                        type="url"
                        placeholder="https://analytics.example.com"
                        value={addAppForm.remoteUrl}
                        onChange={(e) => setAddAppForm({ ...addAppForm, remoteUrl: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                      />
                      <p className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
                        The base URL where /remoteEntry.js is served
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                        Remote Name *
                      </label>
                      <input
                        type="text"
                        placeholder="analyticsApp"
                        value={addAppForm.remoteName}
                        onChange={(e) => setAddAppForm({ ...addAppForm, remoteName: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                      />
                      <p className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
                        Must match the remote container name in the remote's federation config
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                        Exposed Module *
                      </label>
                      <input
                        type="text"
                        placeholder="./App"
                        value={addAppForm.exposedModule}
                        onChange={(e) => setAddAppForm({ ...addAppForm, exposedModule: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border dark:border-slate-600 bg-cream-surface dark:bg-slate-900 text-text-light-primary dark:text-text-primary placeholder-gray-500 dark:placeholder-slate-400"
                      />
                      <p className="text-xs text-text-light-secondary dark:text-text-secondary mt-1">
                        The module path exposed by the remote (e.g., ./App, ./Dashboard)
                      </p>
                    </div>
                  </>
                )}

                {/* Error feedback */}
                {addAppError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
                    {addAppError}
                  </div>
                )}

                {/* Success feedback */}
                {addAppSuccess && (
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
                    ✓ App added successfully! It will appear in the sidebar.
                  </div>
                )}

                <button
                  onClick={handleAddApp}
                  disabled={addAppSaving}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    addAppSaving
                      ? 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-400 cursor-not-allowed'
                      : 'bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover'
                  }`}
                >
                  {addAppSaving ? 'Adding...' : 'Add App'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
