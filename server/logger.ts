import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'auth' | 'document' | 'permission' | 'rag' | 'chat' | 'system';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  action: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: 'admin' | 'user' | 'system';
  targetType?: string;
  targetId?: string;
  summary: string;
  latencyMs?: number;
  statusCode?: number;
  ip?: string;
  details?: Record<string, unknown>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOGS_JSON_PATH = path.resolve(DATA_DIR, 'logs.json');
const AUDIT_JSONL_PATH = path.resolve(DATA_DIR, 'audit.jsonl');
const MAX_STORED_LOGS = 1500;

let logsCache: AuditLogEntry[] | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const SENSITIVE_KEY_PATTERN = /password|passcode|token|secret|apikey|api_key|authorization|hash/i;

function sanitizeDetails(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeDetails(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadLogs(): AuditLogEntry[] {
  if (logsCache) return logsCache;
  ensureDataDir();
  if (!fs.existsSync(LOGS_JSON_PATH)) {
    logsCache = [];
    return logsCache;
  }
  try {
    const raw = fs.readFileSync(LOGS_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    logsCache = Array.isArray(parsed) ? (parsed as AuditLogEntry[]) : [];
  } catch {
    logsCache = [];
  }
  return logsCache;
}

function persistLogs(entries: AuditLogEntry[]): void {
  ensureDataDir();
  logsCache = entries;
  const tempPath = `${LOGS_JSON_PATH}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tempPath, LOGS_JSON_PATH);
}

export function logEvent(params: {
  level?: LogLevel;
  category: LogCategory;
  action: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: 'admin' | 'user' | 'system';
  targetType?: string;
  targetId?: string;
  summary: string;
  latencyMs?: number;
  statusCode?: number;
  ip?: string;
  details?: Record<string, unknown>;
}): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `log-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    level: params.level ?? 'info',
    category: params.category,
    action: params.action,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    targetType: params.targetType,
    targetId: params.targetId,
    summary: params.summary,
    latencyMs: params.latencyMs,
    statusCode: params.statusCode,
    ip: params.ip,
    details: sanitizeDetails(params.details),
  };

  try {
    ensureDataDir();
    fs.appendFileSync(AUDIT_JSONL_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    const current = loadLogs();
    current.unshift(entry);
    if (current.length > MAX_STORED_LOGS) {
      current.length = MAX_STORED_LOGS;
    }
    persistLogs(current);
  } catch (err) {
    console.error('Failed to persist audit log entry:', err);
  }

  const actorTag = entry.actorEmail || entry.actorRole || 'anonymous';
  const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}:${entry.action}] (${actorTag}) ${entry.summary}`;
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }

  return entry;
}

export function queryLogs(filters: {
  category?: string;
  level?: string;
  search?: string;
  limit?: number;
}): {
  logs: AuditLogEntry[];
  counts: {
    total: number;
    info: number;
    warn: number;
    error: number;
    auth: number;
    document: number;
    permission: number;
    rag: number;
    chat: number;
    system: number;
  };
} {
  const all = loadLogs();

  const counts = {
    total: all.length,
    info: 0,
    warn: 0,
    error: 0,
    auth: 0,
    document: 0,
    permission: 0,
    rag: 0,
    chat: 0,
    system: 0,
  };

  for (const item of all) {
    if (item.level === 'info') counts.info++;
    else if (item.level === 'warn') counts.warn++;
    else if (item.level === 'error') counts.error++;

    if (item.category in counts) {
      counts[item.category]++;
    }
  }

  const searchLower = filters.search?.trim().toLowerCase() ?? '';
  const filtered = all.filter((item) => {
    if (filters.category && filters.category !== 'all' && item.category !== filters.category) {
      return false;
    }
    if (filters.level && filters.level !== 'all' && item.level !== filters.level) {
      return false;
    }
    if (!searchLower) return true;

    const haystack = [
      item.action,
      item.summary,
      item.actorEmail ?? '',
      item.actorRole ?? '',
      item.targetId ?? '',
      item.details ? JSON.stringify(item.details) : '',
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(searchLower);
  });

  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  return {
    logs: filtered.slice(0, limit),
    counts,
  };
}

export function clearAllLogs(actor: { id: string; email: string }): AuditLogEntry {
  ensureDataDir();
  if (fs.existsSync(AUDIT_JSONL_PATH)) {
    fs.writeFileSync(AUDIT_JSONL_PATH, '', 'utf8');
  }
  persistLogs([]);
  return logEvent({
    level: 'warn',
    category: 'system',
    action: 'logs_cleared',
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: 'admin',
    summary: `Administrator ${actor.email} cleared stored audit logs.`,
  });
}

export function exportLogsCsv(): string {
  const all = loadLogs();
  const escapeCsv = (val: unknown) => {
    const s = val === undefined || val === null ? '' : String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = [
    'id',
    'timestamp',
    'level',
    'category',
    'action',
    'actorEmail',
    'actorRole',
    'targetType',
    'targetId',
    'statusCode',
    'latencyMs',
    'summary',
    'details',
  ].join(',');

  const rows = all.map((entry) =>
    [
      entry.id,
      entry.timestamp,
      entry.level,
      entry.category,
      entry.action,
      entry.actorEmail ?? '',
      entry.actorRole ?? '',
      entry.targetType ?? '',
      entry.targetId ?? '',
      entry.statusCode ?? '',
      entry.latencyMs ?? '',
      entry.summary,
      entry.details ? JSON.stringify(entry.details) : '',
    ]
      .map(escapeCsv)
      .join(','),
  );

  return [header, ...rows].join('\n');
}

export function exportLogsJsonl(): string {
  const all = loadLogs();
  return all.map((entry) => JSON.stringify(entry)).join('\n');
}
