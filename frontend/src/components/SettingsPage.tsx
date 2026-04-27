/**
 * Comprehensive Settings Page
 * Includes theme settings, user profiles, and admin controls
 */

import { useState } from 'react';
import {
  X,
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
  MessageCircle,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import FeedbackModal from './FeedbackModal';

interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'user';
  };
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  joinDate: string;
  status: 'active' | 'inactive';
}

export default function SettingsPage({
  isOpen,
  onClose,
  isAdmin,
  currentUser,
}: SettingsPageProps) {
  const { theme, themeMode, setThemeMode } = useTheme();
  const [activeTab, setActiveTab] = useState<'appearance' | 'profile' | 'admin'>('appearance');
  const [_editingUser, _setEditingUser] = useState<User | null>(null);
  const [_showAddUserModal, setShowAddUserModal] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  // Mock users list
  const [users, setUsers] = useState<User[]>([
    {
      id: '1',
      name: 'You',
      email: currentUser.email,
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
    if (userId === currentUser.id) {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-cream-bg dark:bg-pulse-bg shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between p-6 border-b border-cream-border/70 dark:border-pulse-border/70">
          <h1 className="text-2xl font-bold text-text-light-primary dark:text-text-primary">
            Settings
          </h1>
          <button
            onClick={onClose}
            className="p-2 hover:bg-cream-surface dark:hover:bg-pulse-surface rounded-lg transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 border-r border-cream-border/70 dark:border-pulse-border/70 overflow-y-auto">
            <nav className="space-y-1 p-3">
              {[
                { id: 'appearance' as const, label: 'Appearance', icon: Monitor },
                { id: 'profile' as const, label: 'Profile', icon: User },
                ...(isAdmin
                  ? [{ id: 'admin' as const, label: 'Admin Panel', icon: Shield }]
                  : []),
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition text-sm font-medium ${
                    activeTab === id
                      ? 'bg-naavik-primary/20 text-naavik-primary'
                      : 'text-text-light-secondary dark:text-text-secondary hover:bg-cream-surface dark:hover:bg-pulse-surface'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {/* Settings Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Appearance Settings */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
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
                            ? 'border-naavik-primary bg-naavik-primary/10'
                            : 'border-cream-border dark:border-pulse-border hover:border-naavik-primary/50'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="font-medium text-sm">{label}</span>
                        {themeMode === mode && (
                          <Check className="w-4 h-4 ml-auto text-naavik-primary" />
                        )}
                      </button>
                    ))}
                  </div>
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
                    <div className="flex items-center gap-4 pb-4 border-b border-cream-border/70 dark:border-pulse-border/70">
                      <div className="w-16 h-16 rounded-full bg-naavik-primary/20 flex items-center justify-center">
                        <User className="w-8 h-8 text-naavik-primary" />
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-text-light-primary dark:text-text-primary">
                          {currentUser.name}
                        </p>
                        <p className="text-sm text-text-light-secondary dark:text-text-secondary">
                          {currentUser.email}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Shield className="w-4 h-4 text-naavik-primary" />
                          <span className="text-xs font-medium capitalize text-naavik-primary">
                            {currentUser.role}
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
                          defaultValue={currentUser.name}
                          disabled
                          className="w-full px-3 py-2 rounded-lg border border-cream-border dark:border-pulse-border bg-cream-surface dark:bg-pulse-surface text-text-light-primary dark:text-text-primary disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-text-light-secondary dark:text-text-secondary mb-2">
                          Email
                        </label>
                        <input
                          type="email"
                          defaultValue={currentUser.email}
                          disabled
                          className="w-full px-3 py-2 rounded-lg border border-cream-border dark:border-pulse-border bg-cream-surface dark:bg-pulse-surface text-text-light-primary dark:text-text-primary disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <button className="w-full px-4 py-2 rounded-lg bg-naavik-primary text-white hover:bg-naavik-primary/90 transition font-medium text-sm">
                      Change Password
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Panel */}
            {activeTab === 'admin' && isAdmin && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-text-light-primary dark:text-text-primary flex items-center gap-2">
                      <Shield className="w-5 h-5 text-naavik-primary" />
                      User Management
                    </h2>
                    <button
                      onClick={() => setShowAddUserModal(true)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-naavik-primary text-white hover:bg-naavik-primary/90 transition text-sm font-medium"
                    >
                      <Plus className="w-4 h-4" />
                      Add Admin
                    </button>
                  </div>

                  <div className="space-y-3">
                    {users.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-4 rounded-lg border border-cream-border/70 dark:border-pulse-border/70 hover:bg-cream-surface/50 dark:hover:bg-pulse-surface/30 transition"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-text-light-primary dark:text-text-primary">
                              {user.name}
                            </p>
                            {user.role === 'admin' && (
                              <Shield className="w-4 h-4 text-naavik-primary" />
                            )}
                            {user.status === 'inactive' && (
                              <span className="px-2 py-0.5 text-xs rounded-full bg-cream-surface-light dark:bg-gray-900 text-text-secondary dark:text-gray-300">
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
                          {user.role === 'user' && user.id !== currentUser.id && (
                            <button
                              onClick={() => handlePromoteToAdmin(user.id)}
                              className="p-2 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition"
                              title="Promote to Admin"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {user.id !== currentUser.id && (
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
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-4 border-t border-cream-border/70 dark:border-pulse-border/70 flex items-center justify-between">
          <button
            onClick={() => setIsFeedbackOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-cream-border dark:border-pulse-border text-text-light-primary dark:text-text-primary hover:bg-cream-surface-light dark:hover:bg-pulse-surface-light transition font-medium text-sm"
          >
            <MessageCircle className="w-4 h-4" />
            Send Feedback
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg bg-cream-surface dark:bg-pulse-surface hover:bg-cream-surface-light dark:hover:bg-pulse-surface-light transition font-medium text-sm"
          >
            Close
          </button>
        </div>
      </div>

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        context="settings"
      />
    </div>
  );
}
