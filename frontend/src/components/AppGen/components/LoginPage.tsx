import { useState, FormEvent } from 'react'
import { Sparkles } from 'lucide-react'
import { authApi, setAuthToken } from '../lib/api'

interface LoginPageProps {
  onLogin: (username: string, token: string) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await authApi.login(username.trim(), password)
      setAuthToken(result.token)
      onLogin(result.username, result.token)
    } catch (err: any) {
      setError(err.message === 'Unauthorized' ? 'Invalid username or password' : (err.message || 'Login failed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Sparkles className="w-7 h-7 text-brand" />
          <span className="font-semibold text-2xl text-text-primary">AppGen 2.0</span>
        </div>

        <form onSubmit={handleSubmit} className="bg-bg-secondary border border-border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-primary text-center">Sign in</h2>

          {error && (
            <div className="text-sm text-error bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-text-secondary mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded border border-border bg-bg-primary text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded border border-border bg-bg-primary text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !username.trim() || !password.trim()}
            className="w-full py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
