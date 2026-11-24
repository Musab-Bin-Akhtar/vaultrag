import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  ClipboardList,
  FileText,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, setAuthToken } from './api/client';
import { AdminAccessControl } from './components/AdminAccessControl';
import { AdminAuditLogs } from './components/AdminAuditLogs';
import { AdminSettings } from './components/AdminSettings';
import { AuthScreen } from './components/AuthScreen';
import { ChatWorkspace } from './components/ChatWorkspace';
import { DocumentLibrary } from './components/DocumentLibrary';
import { RagPipelineGuide } from './components/RagPipelineGuide';
import type { AuthStatus, ChatSession, DocumentItem, User } from './types';

type ActiveTab = 'chat' | 'documents' | 'access' | 'logs' | 'settings' | 'guide';

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string>('gemini-4-hydrogen');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadAuthStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : 'Unable to connect to VaultRAG server.',
      );
    }
  }, []);

  useEffect(() => {
    loadAuthStatus();
  }, [loadAuthStatus]);

  const loadWorkspaceData = useCallback(async () => {
    const [docsRes, sessionsRes, meRes, statsRes] = await Promise.all([
      api.listDocuments(),
      api.listSessions(),
      api.getMe(),
      api.getPipelineStats(),
    ]);
    setDocuments(docsRes.documents);
    setSessions(sessionsRes.sessions);
    setUser(meRes.user);
    setActiveModelId(statsRes.llmModel);
    setActiveSessionId((prev) =>
      prev && sessionsRes.sessions.some((s) => s.id === prev)
        ? prev
        : (sessionsRes.sessions[0]?.id ?? null),
    );
  }, []);

  const handleAuthenticated = async (token: string, authedUser: User) => {
    setAuthToken(token);
    setUser(authedUser);
    setActiveTab('chat');
    await loadWorkspaceData();
  };

  const handleSignOut = async () => {
    setAuthToken(null);
    setUser(null);
    setDocuments([]);
    setSessions([]);
    setActiveSessionId(null);
    await loadAuthStatus();
  };

  const handleNewChat = async () => {
    const res = await api.createSession('New Conversation');
    setSessions((prev) => [res.session, ...prev]);
    setActiveSessionId(res.session.id);
    setActiveTab('chat');
    setMobileMenuOpen(false);
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteSession(sessionId);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleSessionUpdated = (updated: ChatSession) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === updated.id);
      if (!exists) return [updated, ...prev];
      return [updated, ...prev.filter((s) => s.id !== updated.id)];
    });
    setActiveSessionId(updated.id);
  };

  if (statusError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center">
          <h1 className="font-display text-lg font-bold text-slate-900 mb-2">
            Connection Unavailable
          </h1>
          <p className="text-xs text-slate-600 mb-4">{statusError}</p>
          <button
            type="button"
            onClick={loadAuthStatus}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-xs text-slate-500">Loading VaultRAG workspace...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen authStatus={authStatus} onAuthenticated={handleAuthenticated} />;
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const navItems: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'chat',
      label: 'Knowledge Chat',
      icon: <MessageSquare className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'documents',
      label: user.role === 'admin' ? 'Document Library' : 'Authorized Docs',
      icon: <FileText className="w-4 h-4 shrink-0" />,
    },
    ...(user.role === 'admin'
      ? [
          {
            id: 'access' as ActiveTab,
            label: 'Access Control',
            icon: <Users className="w-4 h-4 shrink-0" />,
          },
          {
            id: 'logs' as ActiveTab,
            label: 'Audit Logs',
            icon: <ClipboardList className="w-4 h-4 shrink-0" />,
          },
          {
            id: 'settings' as ActiveTab,
            label: 'Settings',
            icon: <SlidersHorizontal className="w-4 h-4 shrink-0" />,
          },
        ]
      : []),
    {
      id: 'guide',
      label: 'RAG Pipeline',
      icon: <BookOpen className="w-4 h-4 shrink-0" />,
    },
  ];

  const currentTabTitle =
    navItems.find((item) => item.id === activeTab)?.label ?? 'Knowledge Chat';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-[264px]">
      <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            VaultRAG
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1 text-slate-500 hover:text-slate-900"
          aria-label="Close navigation menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Primary Workspace Nav */}
      <nav className="p-3 space-y-1 border-b border-slate-100">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                active
                  ? 'bg-blue-50 text-blue-800'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-xs font-semibold text-slate-500">Conversations</span>
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="space-y-1">
          {sessions.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-400">
              Your chat history will appear here.
            </p>
          ) : (
            sessions.map((s) => {
              const isSelected = activeTab === 'chat' && activeSessionId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => {
                    setActiveSessionId(s.id);
                    setActiveTab('chat');
                    setMobileMenuOpen(false);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setActiveSessionId(s.id);
                      setActiveTab('chat');
                    }
                  }}
                  className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-slate-100 text-slate-900 font-medium'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="truncate">{s.title}</span>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity shrink-0"
                    title="Delete conversation"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Signed-in User Account Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">{user.name}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {user.role === 'admin' ? 'Administrator' : 'Employee'} · {user.email}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex bg-slate-50 text-slate-900 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/30"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 h-full">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header className="h-14 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 whitespace-nowrap">Workspace</span>
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {currentTabTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeTab === 'chat' ? (
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </button>
            ) : user.role === 'admin' && activeTab !== 'documents' ? (
              <button
                type="button"
                onClick={() => setActiveTab('documents')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>Manage PDFs</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Ask Assistant</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto min-h-0">
          {activeTab === 'chat' && (
            <ChatWorkspace
              user={user}
              authorizedDocs={documents}
              activeSession={activeSession}
              activeModelId={activeModelId}
              onSessionUpdated={handleSessionUpdated}
            />
          )}

          {activeTab === 'documents' && (
            <DocumentLibrary
              user={user}
              documents={documents}
              onRefreshDocuments={loadWorkspaceData}
            />
          )}

          {activeTab === 'access' && user.role === 'admin' && (
            <AdminAccessControl currentUser={user} documents={documents} />
          )}

          {activeTab === 'logs' && user.role === 'admin' && <AdminAuditLogs />}

          {activeTab === 'settings' && user.role === 'admin' && (
            <AdminSettings onSettingsSaved={(s) => setActiveModelId(s.llmModel)} />
          )}

          {activeTab === 'guide' && <RagPipelineGuide />}
        </main>
      </div>
    </div>
  );
}
