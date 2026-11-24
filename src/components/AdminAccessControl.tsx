import React, { useEffect, useState } from 'react';
import { Check, Lock, Shield, Trash2, UserPlus } from 'lucide-react';
import { api } from '../api/client';
import type { DocumentItem, User, UserRole } from '../types';

interface AdminAccessControlProps {
  currentUser: User;
  documents: DocumentItem[];
}

export function AdminAccessControl({ currentUser, documents }: AdminAccessControlProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  // Create User form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(() =>
    documents.filter((d) => d.isStarterDefaultForUsers).map((d) => d.id),
  );
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreateMessage(null);
    setCreating(true);
    try {
      const res = await api.createUser({
        name,
        email,
        password,
        role,
        allowedDocumentIds: role === 'admin' ? documents.map((d) => d.id) : selectedDocIds,
      });
      setUsers((prev) => [...prev, res.user]);
      setCreateMessage(`Created ${res.user.role} account for ${res.user.email}.`);
      setName('');
      setEmail('');
      setPassword('');
      setRole('user');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setCreating(false);
    }
  };

  const toggleDocPermission = async (target: User, docId: string) => {
    if (target.role === 'admin') return;
    setError(null);
    setSavingUserId(target.id);
    const hasDoc = target.allowedDocumentIds.includes(docId);
    const nextDocs = hasDoc
      ? target.allowedDocumentIds.filter((id) => id !== docId)
      : [...target.allowedDocumentIds, docId];

    try {
      const res = await api.updateUserPermissions(target.id, {
        allowedDocumentIds: nextDocs,
      });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? res.user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permissions.');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleRoleChange = async (target: User, nextRole: UserRole) => {
    setError(null);
    setSavingUserId(target.id);
    try {
      const res = await api.updateUserPermissions(target.id, { role: nextRole });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? res.user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role.');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleDeleteUser = async (targetId: string) => {
    setError(null);
    setSavingUserId(targetId);
    try {
      await api.deleteUser(targetId);
      setUsers((prev) => prev.filter((u) => u.id !== targetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user.');
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Create Account Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Create Employee or Admin Account
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Assign explicit PDF permissions on creation. Backend RAG retrieval filters chunks
              against this matrix before calling Gemini.
            </p>
          </div>
          <UserPlus className="w-5 h-5 text-blue-700 shrink-0" />
        </div>

        {createMessage && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {createMessage}
          </div>
        )}

        <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Samira Patel"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="samira@northstar.internal"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 chars"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'user')}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="user">Regular User (Employee)</option>
              <option value="admin">Admin (Full Access)</option>
            </select>
          </div>

          {role === 'user' && documents.length > 0 && (
            <div className="md:col-span-12 pt-1">
              <div className="text-xs font-medium text-slate-700 mb-2">
                Initial Authorized Documents
              </div>
              <div className="flex flex-wrap gap-3">
                {documents.map((doc) => {
                  const checked = selectedDocIds.includes(doc.id);
                  return (
                    <label
                      key={doc.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedDocIds((prev) =>
                            checked ? prev.filter((id) => id !== doc.id) : [...prev, doc.id],
                          )
                        }
                        className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                      <span className="text-slate-800">{doc.originalName}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="md:col-span-12 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{creating ? 'Creating...' : 'Create User'}</span>
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {/* Permission Matrix */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Document Permission Matrix
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Admins automatically access all documents. Toggle individual PDF permissions for
              Regular Users below.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
            {users.length} accounts · {documents.length} PDFs
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-xs text-slate-500">Loading user permissions...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  {documents.map((doc) => (
                    <th key={doc.id} className="py-3 px-4 min-w-[150px]">
                      <div className="text-slate-800 font-medium truncate max-w-[180px]">
                        {doc.originalName}
                      </div>
                      <div className="text-[11px] font-normal text-slate-500">
                        {doc.department}
                      </div>
                    </th>
                  ))}
                  <th className="py-3 px-4 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  const isBusy = savingUserId === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-medium text-slate-900">
                          {u.name} {isSelf ? '(You)' : ''}
                        </div>
                        <div className="text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <select
                          aria-label={`Role for ${u.name}`}
                          value={u.role}
                          disabled={isSelf || isBusy}
                          onChange={(e) =>
                            handleRoleChange(u, e.target.value === 'admin' ? 'admin' : 'user')
                          }
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 disabled:opacity-60"
                        >
                          <option value="user">Employee</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      {documents.map((doc) => {
                        const allowed =
                          u.role === 'admin' || u.allowedDocumentIds.includes(doc.id);
                        return (
                          <td key={doc.id} className="py-3.5 px-4 whitespace-nowrap">
                            {u.role === 'admin' ? (
                              <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                                <Shield className="w-3.5 h-3.5" />
                                <span>All (Admin)</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => toggleDocPermission(u, doc.id)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                                  allowed
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {allowed ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Granted</span>
                                  </>
                                ) : (
                                  <>
                                    <Lock className="w-3.5 h-3.5" />
                                    <span>Restricted</span>
                                  </>
                                )}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {!isSelf && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDeleteUser(u.id)}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-md"
                            title="Delete account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
