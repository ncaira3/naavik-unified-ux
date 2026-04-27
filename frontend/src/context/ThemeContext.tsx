import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

type Theme = 'light' | 'dark';
type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'naavik-theme';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): Theme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyThemeToDocument(next: Theme, mode?: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode ?? next);
  } catch (_) {}
}

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
      const initial = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
      applyThemeToDocument(resolveTheme(initial), initial);
      return initial;
    }
    return 'light';
  });
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(themeMode));

  useEffect(() => {
    const next = resolveTheme(themeMode);
    setTheme(next);
    applyThemeToDocument(next, themeMode);

    if (themeMode !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const resolved = getSystemTheme();
      setTheme(resolved);
      applyThemeToDocument(resolved, 'system');
    };

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [themeMode]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const current = prev === 'system' ? getSystemTheme() : prev;
      return current === 'light' ? 'dark' : 'light';
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeMode, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
