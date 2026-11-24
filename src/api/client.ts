import type {
  AuditLogsResponse,
  AuthStatus,
  ChatMessage,
  ChatSession,
  DocumentChunkView,
  DocumentItem,
  PipelineStats,
  SettingsResponse,
  User,
  UserRole,
  WorkspaceSettings,
} from '../types';

// Keep bearer session token strictly in memory (never localStorage or sessionStorage).
let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (!(init.body instanceof FormData) && !headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    if (contentType.includes('application/json')) {
      const errBody = (await res.json()) as { error?: string };
      throw new Error(errBody.error || `Request failed with status ${res.status}`);
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        `Session or access gate returned HTTP ${res.status} before reaching the app server. Please reload the page to refresh your preview session, then try again.`,
      );
    }
    throw new Error(`Request failed with status ${res.status}. Please refresh and try again.`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON from server but received "${contentType || 'unknown'}" (HTTP ${res.status}). If the app preview restarted or timed out, please refresh the page and sign in again.`,
    );
  }

  return res.json() as Promise<T>;
}

export const api = {
  getAuthStatus: () => apiFetch<AuthStatus>('/api/auth/status'),

  bootstrapAdmin: (payload: { name: string; email: string; password: string }) =>
    apiFetch<{ token: string; user: User }>('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: { name: string; email: string; password: string }) =>
    apiFetch<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    apiFetch<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMe: () => apiFetch<{ user: User }>('/api/auth/me'),

  listDocuments: () =>
    apiFetch<{ documents: DocumentItem[]; totalInVault: number }>('/api/documents'),

  uploadDocument: (formData: FormData) =>
    apiFetch<{ document: DocumentItem }>('/api/documents/upload', {
      method: 'POST',
      body: formData,
    }),

  reindexDocument: (documentId: string) =>
    apiFetch<{ document: DocumentItem }>(`/api/documents/${encodeURIComponent(documentId)}/reindex`, {
      method: 'POST',
    }),

  getDocumentChunks: (documentId: string) =>
    apiFetch<{ document: DocumentItem; chunks: DocumentChunkView[] }>(
      `/api/documents/${encodeURIComponent(documentId)}/chunks`,
    ),

  downloadDocument: async (documentId: string, filename: string) => {
    const headers = new Headers();
    if (memoryToken) {
      headers.set('Authorization', `Bearer ${memoryToken}`);
    }
    const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/download`, {
      headers,
    });
    if (!res.ok) {
      throw new Error('Could not download PDF document.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  deleteDocument: (documentId: string) =>
    apiFetch<{ deletedId: string }>(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    }),

  listUsers: () => apiFetch<{ users: User[] }>('/api/admin/users'),

  createUser: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    allowedDocumentIds: string[];
  }) =>
    apiFetch<{ user: User }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateUserPermissions: (
    userId: string,
    payload: { role?: UserRole; allowedDocumentIds?: string[] },
  ) =>
    apiFetch<{ user: User }>(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteUser: (userId: string) =>
    apiFetch<{ deletedId: string }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),

  listSessions: () => apiFetch<{ sessions: ChatSession[] }>('/api/chat/sessions'),

  createSession: (title?: string) =>
    apiFetch<{ session: ChatSession }>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  deleteSession: (sessionId: string) =>
    apiFetch<{ deletedId: string }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),

  askQuestion: (payload: { question: string; sessionId: string | null }) =>
    apiFetch<{
      session: ChatSession;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }>('/api/chat/ask', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPipelineStats: () => apiFetch<PipelineStats>('/api/pipeline/stats'),

  listLogs: (params?: { category?: string; level?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.category && params.category !== 'all') qs.set('category', params.category);
    if (params?.level && params.level !== 'all') qs.set('level', params.level);
    if (params?.search?.trim()) qs.set('search', params.search.trim());
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<AuditLogsResponse>(`/api/admin/logs${suffix}`);
  },

  clearLogs: () =>
    apiFetch<{ cleared: boolean }>('/api/admin/logs', {
      method: 'DELETE',
    }),

  downloadLogsExport: async (format: 'csv' | 'jsonl') => {
    const headers = new Headers();
    if (memoryToken) {
      headers.set('Authorization', `Bearer ${memoryToken}`);
    }
    const res = await fetch(`/api/admin/logs/export?format=${format}`, { headers });
    if (!res.ok) {
      throw new Error('Could not export audit logs.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = format === 'csv' ? 'vaultrags-audit-logs.csv' : 'vaultrags-audit-logs.jsonl';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  getSettings: () => apiFetch<SettingsResponse>('/api/admin/settings'),

  updateSettings: (payload: Partial<WorkspaceSettings>) =>
    apiFetch<SettingsResponse>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
};
