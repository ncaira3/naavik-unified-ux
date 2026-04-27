import { useState } from 'react';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';
import { useTheme } from '../context/ThemeContext';
import FluidBackground from './FluidBackground';

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await api.login({ username: email, password });
      try { sessionStorage.removeItem('naavik-home-intro-dismissed'); } catch { /* no-op */ }
      onLogin();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex bg-cream-bg dark:bg-slate-900 text-text-primary dark:text-text-primary overflow-hidden transition-colors duration-200">
      {/* Fluid background — subtle overlay on the existing theme */}
      <FluidBackground theme={theme} />

      {/* Left Panel */}
      <div className="relative z-10 hidden lg:flex lg:w-1/2 bg-cream-surface-light/80 dark:bg-slate-800/80 flex-col justify-between p-12 border-r border-border dark:border-slate-700 transition-colors duration-200 backdrop-blur-[2px]">
        <div />

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="mb-8 flex justify-center">
              <img
                src="/naavik-full-logo-transparent.png"
                alt="Naavik"
                className="h-20 w-auto max-w-full object-contain transition-[filter] duration-200"
                style={theme === 'dark' ? { minHeight: '80px', filter: 'invert(1) hue-rotate(180deg)' } : { minHeight: '80px' }}
              />
            </div>
            <h2 className="text-heading-sm font-semibold text-text-primary dark:text-text-primary mb-3">
              Naavik is reimagining what telecom can be in a software-driven world.
            </h2>
            <p className="text-body-sm text-text-secondary dark:text-text-secondary leading-relaxed">
              Aira Naavik is the first platform to seamlessly combine GenAI with traditional AI to solve impactful use cases for network operators.
            </p>
          </div>
        </div>

        <div />
      </div>

      {/* Right Panel - Login Form */}
      <div className="relative z-10 w-full lg:w-1/2 flex items-center justify-center bg-cream-bg/80 dark:bg-slate-900/80 p-8 transition-colors duration-200 backdrop-blur-[2px]">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-heading-md font-semibold text-text-primary dark:text-text-primary mb-2">Sign in to your account</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-body-sm font-medium text-text-primary dark:text-text-primary mb-2">
                Username
              </label>
              <input
                id="email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-border dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400 bg-cream-surface dark:bg-slate-700 text-text-primary dark:text-text-primary placeholder-text-muted transition-all duration-150"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-body-sm font-medium text-text-primary dark:text-text-primary mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 rounded-lg border border-border dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400 bg-cream-surface dark:bg-slate-700 text-text-primary dark:text-text-primary placeholder-text-muted transition-all duration-150"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted hover:text-text-secondary dark:hover:text-text-secondary transition-colors duration-150"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 dark:border-red-500/40 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg text-body-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-ui-btn hover:bg-ui-btn-hover text-ui-btn-fg py-3 rounded-lg font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-sm hover:shadow-md focus:outline-none"
            >
              {isLoading ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Signing in...</>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
