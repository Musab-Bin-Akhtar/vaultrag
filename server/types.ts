export type UserRole = 'admin' | 'user';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  allowedDocumentIds: string[];
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  allowedDocumentIds: string[];
  createdAt: string;
}

export interface DocumentRecord {
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

export interface DocumentChunk {
  id: string;
  documentId: string;
  documentName: string;
  department: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  embedding?: number[];
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

export interface StoreData {
  users: UserRecord[];
  documents: DocumentRecord[];
  chunks: DocumentChunk[];
  chatSessions: ChatSession[];
  seeded: boolean;
  settings?: WorkspaceSettings;
}
