export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  allowedDocumentIds: string[];
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  filename: string;
  originalName: string;
  department: string;
  description: string;
  pageCount: number;
  chunkCount: number;
  fileSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  embeddingProvider: 'gemini-embedding-2' | 'local-tfidf';
  isStarterDefaultForUsers?: boolean;
}

export interface DocumentChunkView {
  id: string;
  documentId: string;
  documentName: string;
  department: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  hasDenseVector: boolean;
  vectorDimensions: number;
}

export interface Citation {
  sourceNumber: number;
  documentId: string;
  documentName: string;
  department: string;
  pageNumber: number;
  chunkIndex: number;
  score: number;
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  authorizedDocCount?: number;
  retrievedChunkCount?: number;
  model?: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export type LlmModelId = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
export type EmbeddingMode = 'gemini-embedding-2' | 'local-lexical';
export type ThinkingDepth = 'LOW' | 'MEDIUM' | 'HIGH';

export interface WorkspaceSettings {
  llmModel: LlmModelId;
  enableFallbackModel: boolean;
  thinkingLevel: ThinkingDepth;
  embeddingMode: EmbeddingMode;
  topK: number;
  chunkSizeChars: number;
  chunkOverlapChars: number;
}

export interface SettingsResponse {
  settings: WorkspaceSettings;
  envStatus: {
    hasGeminiKey: boolean;
    hasAdminPasscode: boolean;
  };
}

export interface PipelineStats {
  role: UserRole;
  authorizedDocumentCount: number;
  totalVaultDocumentCount: number;
  authorizedChunkCount: number;
  denseVectorChunkCount: number;
  chunkSizeChars: number;
  chunkOverlapChars: number;
  llmModel: LlmModelId;
  embeddingModel: EmbeddingMode;
  topK?: number;
  thinkingLevel?: ThinkingDepth;
  enableFallbackModel?: boolean;
}

export interface AuthStatus {
  needsAdminSetup: boolean;
  hasEnvAdminPasscode: boolean;
}

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

export interface AuditLogsResponse {
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
}
