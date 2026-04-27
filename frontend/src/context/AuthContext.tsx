import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { User } from '../types';
import api from '../services/api';

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  appPermissions: Record<string, boolean>;
  setAppPermissions: (permissions: Record<string, boolean>) => void;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appPermissions, setAppPermissions] = useState<Record<string, boolean>>({});

  const refreshPermissions = async () => {
    const userId = user?.id;
    if (!userId) return;

    try {
      const response = await api.get(`/platform/users/${userId}/permissions`);
      if (response) {
        setAppPermissions(response || {});
      }
    } catch (error) {
      console.error('Failed to refresh app permissions:', error);
      setAppPermissions({});
    }
  };

  // Auto-load permissions when user changes
  useEffect(() => {
    if (user?.id) {
      refreshPermissions();
    } else {
      setAppPermissions({});
    }
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{ user, setUser, appPermissions, setAppPermissions, refreshPermissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
