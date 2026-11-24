import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import type { AuditLogEntry, AuditLogsResponse } from '../types';

const CATEGORY_TABS = [
  { id: 'all', label: 'All Events' },
  { id: 'auth', label: 'Auth' },
  { id: 'document', label: 'Documents' },
  { id: 'permission', label: 'Permissions' },
  { id: 'rag', label: 'RAG Queries' },
  { id: 'chat', label: 'Chats' },
  { id: 'system', label: 'System' },
];

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function LevelIndicator({ level }: { level: AuditLogEntry['level'] }) {
  if (level === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-red-700 font-mono text-xs font-medium">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>ERROR</span>
      </span>
    );
  }
  if (level === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 font-mono text-xs font-medium">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>WARN</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-slate-600 font-mono text-xs">
      <Info className="w-3.5 h-3.5 shrink-0 text-blue-700" />
      <span>INFO</span>
    </span>
  );
}

export function AdminAuditLogs() {
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('all');
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listLogs({ category, level, search, limit: 300 });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [category, level, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 150);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const handleClear = async () => {
    setClearing(true);
    setError(null);
    try {
      await api.clearLogs();
      setConfirmClear(false);
      await fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear logs.');
    } finally {
      setClearing(false);
    }
  };

  const counts = data?.counts;
  const logs = data?.logs ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header & Summary Counts */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Complete Activity &amp; Audit Logs
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Every authentication attempt, PDF upload, permission change, denied access check,
              and RAG query is recorded to persistent server logs with sensitive secrets redacted.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={fetchLogs}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => api.downloadLogsExport('csv')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => api.downloadLogsExport('jsonl')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSONL</span>
            </button>

            {confirmClear ? (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={clearing}
                  onClick={handleClear}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-slate-200 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {counts && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4 border-t border-slate-100">
            <div>
              <div className="text-xs text-slate-500">Total Logged</div>
              <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {counts.total}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Auth Events</div>
              <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {counts.auth}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Document &amp; RBAC</div>
              <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {counts.document + counts.permission}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">RAG Queries</div>
              <div className="text-lg font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {counts.rag}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Warnings &amp; Errors</div>
              <div className="text-lg font-semibold text-amber-700 font-mono tabular-nums mt-0.5">
                {counts.warn + counts.error}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action, document, or summary..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  category === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter log level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
          >
            <option value="all">All Levels</option>
            <option value="info">Info Only</option>
            <option value="warn">Warnings Only</option>
            <option value="error">Errors Only</option>
          </select>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-xs text-slate-500">Loading audit logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900">No matching log events</p>
            <p className="text-xs text-slate-500 mt-1">
              Events appear here automatically as users sign in, upload PDFs, update permissions,
              and query Gemini.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Level</th>
                  <th className="py-3 px-4">Category · Action</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Summary</th>
                  <th className="py-3 px-4 text-right">Timing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                            <span>{formatTimestamp(entry.timestamp)}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <LevelIndicator level={entry.level} />
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                          <span className="text-slate-400">{entry.category}</span>
                          <span className="mx-1 text-slate-300">/</span>
                          <span className="font-medium text-slate-900">{entry.action}</span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-slate-900">
                            {entry.actorEmail ?? entry.actorRole ?? 'system'}
                          </div>
                          {entry.actorRole && (
                            <div className="text-[11px] text-slate-400">{entry.actorRole}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-700 max-w-md">
                          <div className="line-clamp-2">{entry.summary}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {entry.statusCode ? `HTTP ${entry.statusCode}` : ''}
                          {entry.statusCode && entry.latencyMs !== undefined ? ' · ' : ''}
                          {entry.latencyMs !== undefined ? `${entry.latencyMs} ms` : ''}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="text-[11px] font-mono text-slate-600 mb-2">
                              Event ID: {entry.id}
                              {entry.targetType ? ` · Target: ${entry.targetType}:${entry.targetId}` : ''}
                              {entry.ip ? ` · IP: ${entry.ip}` : ''}
                            </div>
                            <pre className="p-3 rounded-lg bg-white border border-slate-200 text-[11px] font-mono text-slate-800 overflow-x-auto">
                              {JSON.stringify(entry, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
