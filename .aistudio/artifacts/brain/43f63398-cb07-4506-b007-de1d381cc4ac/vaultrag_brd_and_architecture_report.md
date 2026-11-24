# VaultRAG: Enterprise PDF RAG Chat Application
## Business Requirements Document (BRD) & Technical Architecture Report

---

## 1. Executive Summary

**VaultRAG** is a production-grade, full-stack enterprise Retrieval-Augmented Generation (RAG) chat and document intelligence system. Designed for organizations requiring strict data confidentiality and granular role-based access control (RBAC), VaultRAG ingests PDF policy documents, extracts page-level text chunks, indexes dense vector embeddings and lexical keywords, and queries Gemini models (`gemini-4-hydrogen` or `gemini-3.1-flash-lite`) to answer user questions with precise, clickable page-number citations (`[Source N]`).

The system enforces a **strict server-side security boundary**: unauthorized documents are filtered out before vector retrieval and are never sent to Gemini. VaultRAG operates with zero mandatory external recurring database costs, storing structured records in a local transactional JSON store and audit logs in structured NDJSON.

---

## Part I: Business Requirements Document (BRD)

### 1. Project Objectives
- **Secure Document Q&A**: Enable employees to query official company policy documents in natural language and receive verified, cited answers.
- **Strict Role-Based Access Control (RBAC)**: Ensure regular employees can only search and access documents explicitly authorized for their accounts, while Administrators manage the document corpus, user permissions, and global settings.
- **Verifiable Citations**: Eliminate AI hallucinations by forcing the model to cite exact source filenames, page numbers, and matching text excerpts.
- **Complete Auditability**: Track every authentication event, permission change, document upload, and RAG query in a tamper-evident audit log with CSV/JSONL export capabilities.

### 2. User Roles & Permissions Matrix

| Feature / Capability | Administrator | Regular Employee (User) |
| :--- | :---: | :---: |
| **View Document Library** | All documents in Vault | Assigned / Authorized documents only |
| **Upload / Delete PDFs** | Yes | No |
| **Manage User Permissions** | Yes (Grant/Revoke access) | No |
| **Access Control Tab** | Yes | Hidden / Forbidden (403) |
| **Audit Logs & Export** | Yes | Hidden / Forbidden (403) |
| **Model & API Settings** | Yes | No |
| **Knowledge Chat & History** | All authorized documents | Assigned authorized documents only |

### 3. Functional Requirements
- **FR-1: Authentication & Account Management**: Secure bcrypt password hashing, session tokens held strictly in React/JS memory (no `localStorage` exposure), optional `ADMIN_PASSCODE` environment override, and a first-run Admin setup claim flow.
- **FR-2: PDF Ingestion & Page-Level Extraction**: Support uploading enterprise PDF policy documents up to 15 MB. Extract text page-by-page using `pdfjs-dist` to preserve accurate page numbers for citations.
- **FR-3: Semantic & Lexical Hybrid Retrieval**: Generate dense vector embeddings via Gemini Embedding 2 (`gemini-embedding-2`) paired with keyword TF-IDF lexical overlap scoring, with automatic fallback to local lexical ranking during quota limits.
- **FR-4: Permission-Gated RAG Execution**: Filter document chunks strictly by the authenticated user's authorized document IDs before vector scoring and Gemini prompting.
- **FR-5: Gemini Grounded Question Answering**: Query Gemini (`gemini-4-hydrogen` or `gemini-3.1-flash-lite`) with strict system instructions requiring inline `[Source N]` citations and fallback behavior during transient `503` / `429` overloads.
- **FR-6: Admin Settings Panel**: Allow Administrators to choose active generation models, reasoning depth (`LOW`/`MEDIUM`/`HIGH`), fallback behavior, retrieval strategies, Top-K chunk count, and chunk size/overlap parameters.
- **FR-7: Complete Audit Logging**: Automatically log security events, permission updates, chat requests, and model retries to `data/audit.jsonl` and `data/logs.json` with filtering and CSV/JSONL export.

---

## Part II: Technical Architecture & Workflow Report

### 1. Technology Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite, Lucide Icons.
- **Backend**: Node.js, Express, TypeScript (`tsx`), Multer (file uploads), `pdfjs-dist` (PDF parsing), `bcryptjs`.
- **AI & Embeddings SDK**: `@google/genai` (`gemini-4-hydrogen`, `gemini-3.1-flash-lite`, `gemini-embedding-2`).
- **Persistence Layer**: Atomic transactional JSON store (`data/store.json`), confined PDF storage (`data/uploads/`), structured audit logging (`data/audit.jsonl`).

### 2. System Architecture Diagram

```
+-------------------------------------------------------------------+
|                        React SPA Frontend                         |
|  (AuthScreen, ChatWorkspace, DocumentLibrary, AdminAccessControl, |
|                   AdminAuditLogs, AdminSettings)                  |
+-------------------------------------------------------------------+
                                  |
               REST API (Bearer Token in Memory /api/*)
                                  v
+-------------------------------------------------------------------+
|                     Express Backend Server                        |
|  +-------------------+  +-------------------+  +---------------+  |
|  | Auth & RBAC Guard |  | PDF Extraction    |  | Audit Logger  |  |
|  | (bcrypt / HMAC)   |  | (pdfjs-dist)      |  | (NDJSON)      |  |
|  +-------------------+  +-------------------+  +---------------+  |
|           |                       |                    |          |
|           +-----------+-----------+                    |          |
|                       v                                v          |
|  +-----------------------------------------+  +-----------------+ |
|  |           RAG Pipeline Engine           |  | Transactional   | |
|  |  (Chunking -> Hybrid Retrieval ->       |->| JSON Store      | |
|  |   Permission Filter -> Gemini Q&A)      |  | (data/store.json)| |
|  +-----------------------------------------+  +-----------------+ |
+-------------------------------------------------------------------+
                                  |
                           @google/genai SDK
                                  v
+-------------------------------------------------------------------+
|                       Google Gemini Cloud                         |
|        (gemini-4-hydrogen / gemini-3.1-flash-lite / Embeddings)   |
+-------------------------------------------------------------------+
```

### 3. End-to-End Core Workflows

#### A. PDF Ingestion & Chunking Workflow
1. **Upload**: Admin uploads a PDF file via `POST /api/documents/upload`.
2. **Validation**: Server verifies `%PDF-` magic header and 15 MB size limit.
3. **Extraction**: `pdfjs-dist` extracts text page-by-page, recording `pageNumber` for every line.
4. **Chunking**: Pages are split into configurable overlapping chunks (default 750 chars, 150 overlap) with unique chunk IDs (`doc-id-c0`, `doc-id-c1`).
5. **Storage**: PDF binary is saved securely to `data/uploads/`, and document metadata + chunks are appended to `data/store.json`.
6. **Embeddings**: If Gemini Embedding 2 is enabled, dense vector embeddings are generated asynchronously and stored alongside lexical data.

#### B. Permission-Gated RAG & Q&A Workflow
1. **Request**: User sends a question to `POST /api/chat/ask` with an optional `sessionId`.
2. **Auth & RBAC**: `requireAuth` validates the bearer token and injects `req.authUser`.
3. **Scope Filtering**: `getAuthorizedDocumentIdsForUser(user)` computes the exact subset of document IDs the user is permitted to access.
4. **Chunk Retrieval**: `retrieveAuthorizedChunks` scores only authorized chunks using a hybrid of dense cosine similarity (Gemini Embedding 2) and TF-IDF lexical overlap.
5. **Prompt Construction**: `generateGroundedAnswer` builds a strict system prompt containing *only* the retrieved authorized excerpts and authorized document names.
6. **Gemini Generation**: The server calls `@google/genai` using the active model (`gemini-4-hydrogen` or `gemini-3.1-flash-lite`) with automatic exponential backoff retry and fallback logic.
7. **Citation Mapping**: Assistant message stores structured citations (`sourceNumber`, `documentName`, `department`, `pageNumber`, `score`, `excerpt`).
8. **Audit Logging**: Complete query latency, authorized doc count, and model used are recorded in `data/audit.jsonl`.

### 4. Security & Compliance Highlights
- **Strict Isolation**: Unauthorized document chunks are filtered out prior to vector scoring and are never accessible or transmitted to Gemini.
- **Secret Hygiene**: `GEMINI_API_KEY` is restricted strictly to server-side environment variables and managed via **Settings > Secrets**. No API keys are exposed to the browser.
- **Session Protection**: Bearer tokens are signed with HMAC-SHA256 and kept in JavaScript memory, preventing `localStorage` token theft.
- **Input Sanitization**: File uploads are verified via magic headers, path traversal attacks are prevented via strict `path.resolve` boundary checks, and login attempts are rate-limited.
