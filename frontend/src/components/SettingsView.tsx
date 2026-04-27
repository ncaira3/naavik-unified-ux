import { useEffect, useMemo, useState } from 'react';
import { Settings, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';

const OEM_OPTIONS = ['Ericsson', 'Nokia', 'Samsung', 'Multi-OEM'] as const;

export default function SettingsView() {
  const { themeMode, setThemeMode } = useTheme();
  const [enabledOems, setEnabledOems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showIntroModals, setShowIntroModals] = useState(true);

  const ericssonOnly = useMemo(
    () => enabledOems.length === 1 && enabledOems[0] === 'Ericsson',
    [enabledOems]
  );

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

  // Load intro modals preference from localStorage
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
      // no-op if storage is unavailable
    }
  };

  const resetSessionDismissal = () => {
    try {
      sessionStorage.removeItem('naavik-home-intro-dismissed');
    } catch {
      // no-op if storage is unavailable
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

  return (
    <div className="flex-1 overflow-auto pt-24 pb-16 px-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="rounded-2xl p-8 bg-cream-surface dark:bg-white/10 border border-border dark:border-white/10 shadow-md">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-cream-surface-light dark:bg-white/10">
              <Settings className="w-6 h-6 text-text-muted dark:text-white/60" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary dark:text-white">Settings</h2>
              <p className="text-sm text-text-secondary dark:text-white/50">API keys, preferences, and system configuration</p>
            </div>
          </div>

          {/* Appearance / Light–Dark switcher */}
          <div className="pt-6 border-t border-border dark:border-white/10">
            <h3 className="text-sm font-medium text-text-primary dark:text-white mb-1">Appearance</h3>
            <p className="text-sm text-text-secondary dark:text-white/50 mb-4">Choose light or dark theme for the app.</p>
            <div className="flex rounded-xl border border-border dark:border-white/10 p-1 bg-cream-bg dark:bg-white/5 w-fit">
              <button
                type="button"
                onClick={() => setThemeMode('light')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  themeMode === 'light'
                    ? 'bg-cream-surface dark:bg-white/10 text-text-primary dark:text-white shadow-sm border border-border dark:border-white/10'
                    : 'text-text-muted dark:text-white/50 hover:text-gray-900 dark:hover:text-white/80'
                }`}
              >
                <Sun className="w-4 h-4" />
                Light
              </button>
              <button
                type="button"
                onClick={() => setThemeMode('dark')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  themeMode === 'dark'
                    ? 'bg-cream-surface dark:bg-white/10 text-text-primary dark:text-white shadow-sm border border-border dark:border-white/10'
                    : 'text-text-muted dark:text-white/50 hover:text-gray-900 dark:hover:text-white/80'
                }`}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
            </div>
          </div>

          {/* Intro/Overview Modals Toggle */}
          <div className="pt-6 border-t border-border dark:border-white/10">
            <h3 className="text-sm font-medium text-text-primary dark:text-white mb-1">Welcome Modals</h3>
            <p className="text-sm text-text-secondary dark:text-white/50 mb-4">Show intro and overview modals when entering the app. Toggle to go straight to the chatbot.</p>
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
                <span className="text-sm text-text-secondary dark:text-white/80">
                  {showIntroModals ? 'Enabled – Intro modals will show' : 'Disabled – Go straight to chatbot'}
                </span>
              </div>
              {showIntroModals && (
                <button
                  type="button"
                  onClick={resetSessionDismissal}
                  className="px-3 py-1.5 rounded-lg border border-border dark:border-white/15 text-xs text-text-secondary dark:text-white/80 hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  Show Now
                </button>
              )}
            </div>
          </div>

          <p className="text-sm text-text-secondary dark:text-white/40 mt-6">
            More options (API keys, deployment targets) can be added here.
          </p>

          <div className="pt-6 mt-6 border-t border-border dark:border-white/10">
            <h3 className="text-sm font-medium text-text-primary dark:text-white mb-1">Naavik AppGen OEM Policy</h3>
            <p className="text-sm text-text-secondary dark:text-white/50 mb-4">
              Configure supported OEMs for conversational AppGen. If only Ericsson is enabled, AppGen stays EIAP/rApp focused.
            </p>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                onClick={setEricssonOnly}
                className="px-3 py-1.5 rounded-lg border border-border dark:border-white/15 text-sm text-text-secondary dark:text-white/80 hover:bg-gray-50 dark:hover:bg-white/5"
              >
                Ericsson Only
              </button>
              <button
                type="button"
                onClick={setAllOems}
                className="px-3 py-1.5 rounded-lg border border-border dark:border-white/15 text-sm text-text-secondary dark:text-white/80 hover:bg-gray-50 dark:hover:bg-white/5"
              >
                Enable All
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {OEM_OPTIONS.map((oem) => {
                const active = enabledOems.includes(oem);
                return (
                  <button
                    key={oem}
                    type="button"
                    onClick={() => toggleOem(oem)}
                    disabled={loading}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition ${
                      active
                        ? 'border-tenant-primary/35 bg-tenant-light/80 text-tenant-primary'
                        : 'border-border dark:border-white/10 text-text-secondary dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    {oem}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={saveOemConfig}
                disabled={saving || loading || enabledOems.length === 0}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save OEM Policy'}
              </button>
              <span className="text-xs text-text-muted dark:text-white/50">
                {ericssonOnly ? 'Mode: Ericsson-only (EIAP/rApp constrained)' : 'Mode: Multi-OEM'}
              </span>
            </div>
            {saveMsg ? <p className="mt-2 text-xs text-text-muted dark:text-white/50">{saveMsg}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
