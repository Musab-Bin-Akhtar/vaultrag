import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, FileText, Lock, ShieldCheck, Users } from 'lucide-react';
import { api } from '../api/client';
import type { AuthStatus, User } from '../types';

interface AuthScreenProps {
  authStatus: AuthStatus;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthScreen({ authStatus, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'bootstrap' | 'login' | 'register'>(
    authStatus.needsAdminSetup ? 'bootstrap' : 'login',
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (nextMode: 'bootstrap' | 'login' | 'register') => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if ((mode === 'bootstrap' || mode === 'register') && password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter your password.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'bootstrap') {
        const res = await api.bootstrapAdmin({
          name: trimmedName,
          email: trimmedEmail,
          password,
        });
        onAuthenticated(res.token, res.user);
      } else if (mode === 'register') {
        const res = await api.register({
          name: trimmedName,
          email: trimmedEmail,
          password,
        });
        onAuthenticated(res.token, res.user);
      } else {
        const res = await api.login({ email: trimmedEmail, password });
        onAuthenticated(res.token, res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-6">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 text-slate-900 mb-6">
              <div className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="font-display text-lg font-bold tracking-tight">VaultRAG</span>
            </div>

            <h1
              className="font-display text-3xl font-bold tracking-tight text-slate-900 mb-3"
              style={{ textWrap: 'balance' }}
            >
              Enterprise PDF Question Answering with Access Control
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed mb-8">
              Upload policy PDFs, extract page-numbered text chunks, index vectors, and ask
              grounded questions with Gemini while enforcing document permissions before retrieval.
            </p>

            <div className="space-y-5 border-t border-slate-100 pt-6">
              <div className="flex items-start gap-3.5">
                <FileText className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Page-Level PDF Citations
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Every answer cites the exact source document filename, page number, and
                    retrieved chunk excerpt.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <Lock className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Backend Permission Gate
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Vector retrieval filters chunks by user permissions on the server. Unauthorized
                    documents are never sent to Gemini.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5">
                <Users className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Admin &amp; Employee Roles
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Admins upload PDFs and manage per-document access. Employees query only their
                    assigned policies.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-slate-100 text-xs text-slate-500">
            Starter corpus indexed · HR Leave Policy · Finance Expense Policy · IT Security
            Guidelines
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
          <div className="mb-6">
            {authStatus.needsAdminSetup && (
              <div className="mb-5 p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
                <strong className="font-semibold">First-run setup:</strong> Claim your workspace
                administrator account below to unlock PDF uploads and permission management.
              </div>
            )}

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
              {authStatus.needsAdminSetup && (
                <button
                  type="button"
                  onClick={() => switchMode('bootstrap')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mode === 'bootstrap'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Admin Setup
                </button>
              )}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'register'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Employee Sign Up
              </button>
            </div>
          </div>

          <h2 className="font-display text-xl font-bold text-slate-900 mb-1">
            {mode === 'bootstrap'
              ? 'Create Administrator Account'
              : mode === 'register'
                ? 'Create Employee Account'
                : 'Sign in to VaultRAG'}
          </h2>
          <p className="text-xs text-slate-600 mb-6">
            {mode === 'bootstrap'
              ? authStatus.hasEnvAdminPasscode
                ? 'Enter your Admin email and the configured ADMIN_PASSCODE to claim the workspace Admin account.'
                : 'Your password is hashed with bcrypt on the server and never stored in plain text.'
              : mode === 'register'
                ? 'New employee accounts start with access to HR Leave Policy only until an Admin grants more documents.'
                : authStatus.hasEnvAdminPasscode
                  ? 'Enter your registered account email and password. Registered Admins may use their account password or the server ADMIN_PASSCODE.'
                  : 'Enter your registered email and password.'}
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {(mode === 'bootstrap' || mode === 'register') && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={mode === 'bootstrap' ? 'Alex Rivera' : 'Jordan Lee'}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Work Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@northstar.internal"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                {mode === 'bootstrap' && authStatus.hasEnvAdminPasscode
                  ? 'Admin Passcode (ADMIN_PASSCODE)'
                  : 'Password'}
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={
                    mode === 'bootstrap'
                      ? authStatus.hasEnvAdminPasscode
                        ? 1
                        : 8
                      : 6
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === 'bootstrap'
                      ? authStatus.hasEnvAdminPasscode
                        ? 'Enter your configured ADMIN_PASSCODE'
                        : 'Minimum 8 characters'
                      : 'Minimum 6 characters'
                  }
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {(mode === 'bootstrap' || mode === 'register') && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  {mode === 'bootstrap' && authStatus.hasEnvAdminPasscode
                    ? 'Confirm Admin Passcode'
                    : 'Confirm Password'}
                </label>
                <input
                  id="auth-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  minLength={
                    mode === 'bootstrap'
                      ? authStatus.hasEnvAdminPasscode
                        ? 1
                        : 8
                      : 6
                  }
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={
                    mode === 'bootstrap' && authStatus.hasEnvAdminPasscode
                      ? 'Re-enter your ADMIN_PASSCODE'
                      : 'Re-enter your password'
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <span>
                {loading
                  ? 'Please wait...'
                  : mode === 'bootstrap'
                    ? 'Initialize Admin & Enter'
                    : mode === 'register'
                      ? 'Create Employee Account'
                      : 'Sign In'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
