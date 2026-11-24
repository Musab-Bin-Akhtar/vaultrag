import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  type AuthenticatedRequest,
  createSessionToken,
  hasEnvAdminPasscode,
  hashPassword,
  makeRequireAuth,
  requireAdmin,
  toPublicUser,
  verifyEnvAdminPasscode,
  verifyPassword,
} from './server/auth.ts';
import {
  clearAllLogs,
  exportLogsCsv,
  exportLogsJsonl,
  logEvent,
  queryLogs,
} from './server/logger.ts';
import {
  chunkDocumentPages,
  extractPdfPages,
  generateGeminiEmbeddings,
  generateGroundedAnswer,
  retrieveAuthorizedChunks,
} from './server/rag.ts';
import {
  ensureStarterDocumentsSeeded,
  getAuthorizedDocumentIdsForUser,
  getChunksForDocumentIds,
  getSessionsForUser,
  getUserByEmail,
  getUserById,
  getWorkspaceSettings,
  loadStore,
  resolveSafeUploadPath,
  saveStore,
} from './server/store.ts';
import type {
  ChatMessage,
  ChatSession,
  DocumentRecord,
  EmbeddingMode,
  LlmModelId,
  ThinkingDepth,
  UserRecord,
  UserRole,
} from './server/types.ts';

dotenv.config();

const PORT = 3000;
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (_req, file, cb) => {
    const isPdfMime =
      file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdfMime) {
      cb(new Error('Only PDF files (.pdf) are supported.'));
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  await ensureStarterDocumentsSeeded();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const requireAuth = makeRequireAuth(getUserById);

  // --- Health & Auth Status ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const failedLoginWindow = new Map<string, { count: number; resetAt: number }>();

  function isLoginRateLimited(key: string): boolean {
    const now = Date.now();
    const record = failedLoginWindow.get(key);
    if (!record) return false;
    if (now > record.resetAt) {
      failedLoginWindow.delete(key);
      return false;
    }
    return record.count >= 15;
  }

  function recordFailedLogin(key: string): void {
    const now = Date.now();
    const record = failedLoginWindow.get(key);
    if (!record || now > record.resetAt) {
      failedLoginWindow.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
    } else {
      record.count += 1;
    }
  }

  app.get('/api/auth/status', (_req, res) => {
    const store = loadStore();
    const hasAdmin = store.users.some((u) => u.role === 'admin');
    const envPasscodeSet = hasEnvAdminPasscode();
    res.json({
      needsAdminSetup: !hasAdmin,
      hasEnvAdminPasscode: envPasscodeSet,
    });
  });

  // One-time first-run Admin account claim route (locks permanently once any Admin exists)
  app.post('/api/auth/bootstrap-admin', async (req, res) => {
    try {
      const store = loadStore();
      const hasAdmin = store.users.some((u) => u.role === 'admin');
      if (hasAdmin) {
        res.status(403).json({
          error: 'An administrator account already exists. Please sign in with your credentials.',
        });
        return;
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (name.length < 2 || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Please provide a valid full name and email address.' });
        return;
      }
      if (hasEnvAdminPasscode()) {
        if (!verifyEnvAdminPasscode(password)) {
          logEvent({
            level: 'warn',
            category: 'auth',
            action: 'admin_bootstrap_denied',
            actorEmail: email,
            statusCode: 403,
            ip: req.ip,
            summary: `Rejected initial Admin setup for ${email}: passcode did not match ADMIN_PASSCODE.`,
          });
          res.status(403).json({
            error:
              'Invalid Admin Passcode. Enter the exact ADMIN_PASSCODE configured in server Secrets to claim the initial Admin account.',
          });
          return;
        }
      } else if (password.trim().length < 8) {
        res.status(400).json({ error: 'Admin password must be at least 8 characters long.' });
        return;
      }
      if (getUserByEmail(email)) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const adminUser: UserRecord = {
        id: `usr-${crypto.randomUUID()}`,
        email,
        name,
        passwordHash,
        role: 'admin',
        allowedDocumentIds: store.documents.map((d) => d.id),
        createdAt: new Date().toISOString(),
      };

      store.users.push(adminUser);
      saveStore(store);

      logEvent({
        category: 'auth',
        action: 'admin_bootstrapped',
        actorId: adminUser.id,
        actorEmail: adminUser.email,
        actorRole: 'admin',
        statusCode: 201,
        ip: req.ip,
        summary: `Initialized first-run Administrator account for ${adminUser.email}.`,
      });

      const token = createSessionToken(adminUser);
      res.status(201).json({
        token,
        user: toPublicUser(adminUser),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to initialize admin account.',
      });
    }
  });

  // Self-registration for Regular Users (never grants admin role; assigns only starter default docs)
  app.post('/api/auth/register', async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (name.length < 2 || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ error: 'Please provide a valid full name and email address.' });
        return;
      }
      if (password.trim().length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        return;
      }
      if (getUserByEmail(email)) {
        res.status(409).json({
          error: 'An account with this email already exists. Please sign in instead.',
        });
        return;
      }

      const store = loadStore();
      const defaultDocs = store.documents
        .filter((d) => d.isStarterDefaultForUsers)
        .map((d) => d.id);

      const passwordHash = await hashPassword(password);
      const newUser: UserRecord = {
        id: `usr-${crypto.randomUUID()}`,
        email,
        name,
        passwordHash,
        role: 'user',
        allowedDocumentIds: defaultDocs,
        createdAt: new Date().toISOString(),
      };

      store.users.push(newUser);
      saveStore(store);

      logEvent({
        category: 'auth',
        action: 'user_registered',
        actorId: newUser.id,
        actorEmail: newUser.email,
        actorRole: 'user',
        statusCode: 201,
        ip: req.ip,
        summary: `Employee account registered: ${newUser.email}.`,
        details: { defaultDocCount: defaultDocs.length },
      });

      const token = createSessionToken(newUser);
      res.status(201).json({
        token,
        user: toPublicUser(newUser),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Registration failed.',
      });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!EMAIL_REGEX.test(email) || !password) {
        res.status(400).json({ error: 'Please enter a valid email address and password.' });
        return;
      }

      const rateKey = `${req.ip || 'unknown'}:${email}`;
      if (isLoginRateLimited(rateKey)) {
        logEvent({
          level: 'warn',
          category: 'auth',
          action: 'login_rate_limited',
          actorEmail: email,
          statusCode: 429,
          ip: req.ip,
          summary: `Temporarily rate-limited repeated failed sign-in attempts for ${email}.`,
        });
        res.status(429).json({
          error: 'Too many failed sign-in attempts. Please wait 5 minutes and try again.',
        });
        return;
      }

      // Strictly look up existing registered user — NEVER auto-create accounts during Sign In.
      const user = getUserByEmail(email);
      if (!user) {
        recordFailedLogin(rateKey);
        logEvent({
          level: 'warn',
          category: 'auth',
          action: 'login_failed',
          actorEmail: email,
          statusCode: 401,
          ip: req.ip,
          summary: `Failed sign-in attempt for unregistered email ${email}.`,
        });
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      // ADMIN_PASSCODE override applies ONLY to an existing Admin account with matching email.
      const matchesAdminPasscode =
        user.role === 'admin' && hasEnvAdminPasscode() && verifyEnvAdminPasscode(password);
      const matchesAccountPassword = matchesAdminPasscode
        ? true
        : await verifyPassword(password, user.passwordHash);

      if (!matchesAccountPassword) {
        recordFailedLogin(rateKey);
        logEvent({
          level: 'warn',
          category: 'auth',
          action: 'login_failed',
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          statusCode: 401,
          ip: req.ip,
          summary: `Failed sign-in attempt (invalid password) for ${user.email}.`,
        });
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      failedLoginWindow.delete(rateKey);
      logEvent({
        category: 'auth',
        action: 'login_success',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        statusCode: 200,
        ip: req.ip,
        summary: matchesAdminPasscode
          ? `Admin ${user.email} signed in via ADMIN_PASSCODE.`
          : `${user.role === 'admin' ? 'Admin' : 'Employee'} ${user.email} signed in.`,
      });

      const token = createSessionToken(user);
      res.json({ token, user: toPublicUser(user) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Sign-in failed.',
      });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const authorizedIds = getAuthorizedDocumentIdsForUser(user);
    res.json({
      user: {
        ...toPublicUser(user),
        allowedDocumentIds: authorizedIds,
      },
    });
  });

  // --- Document Library & PDF Upload/Extraction ---
  app.get('/api/documents', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const store = loadStore();
    const authorizedIds = new Set(getAuthorizedDocumentIdsForUser(user));

    const visibleDocs = store.documents
      .filter((doc) => user.role === 'admin' || authorizedIds.has(doc.id))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    res.json({
      documents: visibleDocs,
      totalInVault: user.role === 'admin' ? store.documents.length : visibleDocs.length,
    });
  });

  app.post(
    '/api/documents/upload',
    requireAuth,
    requireAdmin,
    (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'File upload failed.' });
          return;
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res) => {
      const startedAt = Date.now();
      try {
        const file = req.file;
        if (!file) {
          logEvent({
            level: 'warn',
            category: 'document',
            action: 'upload_rejected',
            actorId: req.authUser!.id,
            actorEmail: req.authUser!.email,
            actorRole: req.authUser!.role,
            statusCode: 400,
            ip: req.ip,
            summary: 'PDF upload rejected: no file selected.',
          });
          res.status(400).json({ error: 'Please select a PDF file to upload.' });
          return;
        }

        // Verify %PDF- magic header
        const header = file.buffer.subarray(0, 5).toString('ascii');
        if (header !== '%PDF-') {
          logEvent({
            level: 'warn',
            category: 'document',
            action: 'upload_rejected',
            actorId: req.authUser!.id,
            actorEmail: req.authUser!.email,
            actorRole: req.authUser!.role,
            statusCode: 400,
            ip: req.ip,
            summary: `Rejected invalid file "${file.originalname}" (missing %PDF- signature).`,
          });
          res.status(400).json({ error: 'The uploaded file is not a valid PDF document.' });
          return;
        }

        const department =
          typeof req.body?.department === 'string' && req.body.department.trim()
            ? req.body.department.trim().slice(0, 60)
            : 'General';
        const description =
          typeof req.body?.description === 'string' && req.body.description.trim()
            ? req.body.description.trim().slice(0, 300)
            : 'Uploaded enterprise PDF policy document.';
        const grantToExistingUsers = req.body?.grantToAllUsers === 'true';

        const pages = await extractPdfPages(new Uint8Array(file.buffer));
        if (pages.length === 0) {
          logEvent({
            level: 'warn',
            category: 'document',
            action: 'upload_rejected',
            actorId: req.authUser!.id,
            actorEmail: req.authUser!.email,
            actorRole: req.authUser!.role,
            statusCode: 400,
            ip: req.ip,
            summary: `Rejected "${file.originalname}": no selectable text extracted.`,
          });
          res.status(400).json({
            error:
              'No selectable text could be extracted from this PDF. Please upload a text-based PDF rather than a scanned image PDF.',
          });
          return;
        }

        const documentId = `doc-${crypto.randomUUID()}`;
        const safeOriginalName = path.basename(file.originalname).replace(/[^\w.\- ()]/g, '_');
        const storedFilename = `${documentId}.pdf`;
        const targetPath = resolveSafeUploadPath(storedFilename);
        fs.writeFileSync(targetPath, file.buffer);

        const activeSettings = getWorkspaceSettings();
        const chunks = chunkDocumentPages({
          documentId,
          documentName: safeOriginalName,
          department,
          pages,
          chunkSize: activeSettings.chunkSizeChars,
          chunkOverlap: activeSettings.chunkOverlapChars,
        });

        const docRecord: DocumentRecord = {
          id: documentId,
          filename: storedFilename,
          originalName: safeOriginalName,
          department,
          description,
          pageCount: pages.length,
          chunkCount: chunks.length,
          fileSizeBytes: file.size,
          uploadedBy: req.authUser!.name,
          uploadedAt: new Date().toISOString(),
          embeddingProvider: 'local-tfidf',
        };

        const store = loadStore();
        store.documents.push(docRecord);
        store.chunks.push(...chunks);

        if (grantToExistingUsers) {
          for (const u of store.users) {
            if (!u.allowedDocumentIds.includes(documentId)) {
              u.allowedDocumentIds.push(documentId);
            }
          }
        }

        saveStore(store);

        // Compute dense embeddings quickly for small documents (<= 4s), or finish in background
        if (
          activeSettings.embeddingMode === 'gemini-embedding-2' &&
          process.env.GEMINI_API_KEY?.trim() &&
          process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
        ) {
          const runEmbeddings = async () => {
            try {
              const vectors = await generateGeminiEmbeddings(chunks.map((c) => c.content));
              if (vectors.length === chunks.length) {
                const currentStore = loadStore();
                const targetDoc = currentStore.documents.find((d) => d.id === documentId);
                const targetChunks = currentStore.chunks.filter((c) => c.documentId === documentId);
                if (targetDoc && targetChunks.length === vectors.length) {
                  for (let i = 0; i < targetChunks.length; i++) {
                    targetChunks[i].embedding = vectors[i];
                  }
                  targetDoc.embeddingProvider = 'gemini-embedding-2';
                  saveStore(currentStore);
                  logEvent({
                    category: 'document',
                    action: 'embeddings_indexed',
                    actorId: req.authUser!.id,
                    actorEmail: req.authUser!.email,
                    actorRole: req.authUser!.role,
                    targetType: 'document',
                    targetId: documentId,
                    summary: `Generated Gemini dense embeddings for "${safeOriginalName}" (${vectors.length} chunks).`,
                  });
                }
              }
            } catch (embErr) {
              logEvent({
                level: 'warn',
                category: 'document',
                action: 'embeddings_fallback',
                actorId: req.authUser!.id,
                actorEmail: req.authUser!.email,
                actorRole: req.authUser!.role,
                targetType: 'document',
                targetId: documentId,
                summary: `Kept lexical index for "${safeOriginalName}" (dense embedding call skipped/failed).`,
                details: { error: embErr instanceof Error ? embErr.message : String(embErr) },
              });
            }
          };

          await Promise.race([
            runEmbeddings(),
            new Promise<void>((resolve) => setTimeout(resolve, 4000)),
          ]);
        }

        const savedDoc = loadStore().documents.find((d) => d.id === documentId) ?? docRecord;
        logEvent({
          category: 'document',
          action: 'document_uploaded',
          actorId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.role,
          targetType: 'document',
          targetId: documentId,
          statusCode: 201,
          latencyMs: Date.now() - startedAt,
          ip: req.ip,
          summary: `Uploaded and indexed "${savedDoc.originalName}" (${savedDoc.pageCount} pages, ${savedDoc.chunkCount} chunks).`,
          details: {
            department,
            fileSizeBytes: file.size,
            grantToExistingUsers,
            embeddingProvider: savedDoc.embeddingProvider,
          },
        });
        res.status(201).json({ document: savedDoc });
      } catch (err) {
        logEvent({
          level: 'error',
          category: 'document',
          action: 'upload_failed',
          actorId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.role,
          statusCode: 500,
          latencyMs: Date.now() - startedAt,
          ip: req.ip,
          summary: `PDF upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to process PDF document.',
        });
      }
    },
  );

  app.post('/api/documents/:id/reindex', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const startedAt = Date.now();
    try {
      const store = loadStore();
      const doc = store.documents.find((d) => d.id === req.params.id);
      if (!doc) {
        res.status(404).json({ error: 'Document not found.' });
        return;
      }

      const docChunks = store.chunks.filter((c) => c.documentId === doc.id);
      const vectors = await generateGeminiEmbeddings(docChunks.map((c) => c.content));
      if (vectors.length !== docChunks.length) {
        res.status(500).json({ error: 'Vector count mismatch during embedding generation.' });
        return;
      }
      for (let i = 0; i < docChunks.length; i++) {
        docChunks[i].embedding = vectors[i];
      }
      doc.embeddingProvider = 'gemini-embedding-2';
      saveStore(store);

      logEvent({
        category: 'document',
        action: 'document_reindexed',
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        targetType: 'document',
        targetId: doc.id,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        ip: req.ip,
        summary: `Re-indexed "${doc.originalName}" with Gemini Embedding 2 (${docChunks.length} chunks).`,
      });

      res.json({ document: doc });
    } catch (err) {
      logEvent({
        level: 'error',
        category: 'document',
        action: 'reindex_failed',
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        targetType: 'document',
        targetId: String(req.params.id),
        statusCode: 500,
        latencyMs: Date.now() - startedAt,
        ip: req.ip,
        summary: `Re-index failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate Gemini embeddings.',
      });
    }
  });

  app.get('/api/documents/:id/chunks', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const docId = String(req.params.id);
    const authorizedIds = new Set(getAuthorizedDocumentIdsForUser(user));

    if (user.role !== 'admin' && !authorizedIds.has(docId)) {
      logEvent({
        level: 'warn',
        category: 'permission',
        action: 'document_access_denied',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'document',
        targetId: docId,
        statusCode: 403,
        ip: req.ip,
        summary: `Denied chunk inspection for unauthorized document ${docId} to ${user.email}.`,
      });
      res.status(403).json({ error: 'You do not have permission to inspect this document.' });
      return;
    }

    const store = loadStore();
    const doc = store.documents.find((d) => d.id === docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    const chunks = store.chunks
      .filter((c) => c.documentId === docId)
      .map((c) => ({
        id: c.id,
        documentId: c.documentId,
        documentName: c.documentName,
        department: c.department,
        pageNumber: c.pageNumber,
        chunkIndex: c.chunkIndex,
        content: c.content,
        hasDenseVector: Boolean(c.embedding && c.embedding.length > 0),
        vectorDimensions: c.embedding?.length ?? 0,
      }));

    logEvent({
      category: 'document',
      action: 'chunks_inspected',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      targetType: 'document',
      targetId: doc.id,
      statusCode: 200,
      ip: req.ip,
      summary: `${user.email} inspected ${chunks.length} chunks of "${doc.originalName}".`,
    });

    res.json({ document: doc, chunks });
  });

  app.get('/api/documents/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const docId = String(req.params.id);
    const authorizedIds = new Set(getAuthorizedDocumentIdsForUser(user));

    if (user.role !== 'admin' && !authorizedIds.has(docId)) {
      logEvent({
        level: 'warn',
        category: 'permission',
        action: 'document_download_denied',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'document',
        targetId: docId,
        statusCode: 403,
        ip: req.ip,
        summary: `Denied PDF download for unauthorized document ${docId} to ${user.email}.`,
      });
      res.status(403).json({ error: 'You do not have permission to download this document.' });
      return;
    }

    const store = loadStore();
    const doc = store.documents.find((d) => d.id === docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    try {
      const filePath = resolveSafeUploadPath(doc.filename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'PDF file is missing from storage.' });
        return;
      }
      logEvent({
        category: 'document',
        action: 'document_downloaded',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'document',
        targetId: doc.id,
        statusCode: 200,
        ip: req.ip,
        summary: `${user.email} downloaded "${doc.originalName}".`,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${doc.originalName}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.status(400).json({ error: 'Invalid document file path.' });
    }
  });

  app.delete('/api/documents/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const docId = String(req.params.id);
    const store = loadStore();
    const idx = store.documents.findIndex((d) => d.id === docId);
    if (idx === -1) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    const [removed] = store.documents.splice(idx, 1);
    store.chunks = store.chunks.filter((c) => c.documentId !== docId);
    for (const user of store.users) {
      user.allowedDocumentIds = user.allowedDocumentIds.filter((id) => id !== docId);
    }
    saveStore(store);

    try {
      const filePath = resolveSafeUploadPath(removed.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore file unlink errors if file was already cleaned up
    }

    logEvent({
      level: 'warn',
      category: 'document',
      action: 'document_deleted',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      targetType: 'document',
      targetId: docId,
      statusCode: 200,
      ip: req.ip,
      summary: `Deleted "${removed.originalName}" and removed ${removed.chunkCount} chunks.`,
    });

    res.json({ deletedId: docId });
  });

  // --- Admin User & Permission Management ---
  app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
    const store = loadStore();
    res.json({
      users: store.users.map(toPublicUser),
    });
  });

  app.post('/api/admin/users', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'user';
      const requestedDocs: string[] = Array.isArray(req.body?.allowedDocumentIds)
        ? req.body.allowedDocumentIds.filter((x: unknown): x is string => typeof x === 'string')
        : [];

      if (!name || !email || !email.includes('@')) {
        res.status(400).json({ error: 'Please provide a valid name and email address.' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        return;
      }
      if (getUserByEmail(email)) {
        res.status(409).json({ error: 'A user with this email already exists.' });
        return;
      }

      const store = loadStore();
      const validDocIds = new Set(store.documents.map((d) => d.id));
      const sanitizedAllowed =
        role === 'admin'
          ? store.documents.map((d) => d.id)
          : requestedDocs.filter((id) => validDocIds.has(id));

      const passwordHash = await hashPassword(password);
      const created: UserRecord = {
        id: `usr-${crypto.randomUUID()}`,
        email,
        name,
        passwordHash,
        role,
        allowedDocumentIds: sanitizedAllowed,
        createdAt: new Date().toISOString(),
      };

      store.users.push(created);
      saveStore(store);

      logEvent({
        category: 'permission',
        action: 'user_created',
        actorId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: 'admin',
        targetType: 'user',
        targetId: created.id,
        statusCode: 201,
        ip: req.ip,
        summary: `Admin ${req.authUser!.email} created ${role} account ${created.email} with ${sanitizedAllowed.length} document(s).`,
        details: { targetEmail: created.email, role, allowedDocumentIds: sanitizedAllowed },
      });

      res.status(201).json({ user: toPublicUser(created) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to create user.',
      });
    }
  });

  app.patch('/api/admin/users/:id/permissions', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.id);
    const store = loadStore();
    const target = store.users.find((u) => u.id === targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const previousRole = target.role;
    const previousDocs = [...target.allowedDocumentIds];

    if (typeof req.body?.role === 'string') {
      const nextRole: UserRole = req.body.role === 'admin' ? 'admin' : 'user';
      if (target.id === req.authUser!.id && nextRole !== 'admin') {
        res.status(400).json({ error: 'You cannot demote your own active Admin account.' });
        return;
      }
      target.role = nextRole;
    }

    if (Array.isArray(req.body?.allowedDocumentIds)) {
      const validDocIds = new Set(store.documents.map((d) => d.id));
      target.allowedDocumentIds = req.body.allowedDocumentIds.filter(
        (id: unknown): id is string => typeof id === 'string' && validDocIds.has(id),
      );
    }

    saveStore(store);

    logEvent({
      category: 'permission',
      action: 'permissions_updated',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      targetType: 'user',
      targetId: target.id,
      statusCode: 200,
      ip: req.ip,
      summary: `Updated permissions for ${target.email} (role: ${target.role}, ${target.allowedDocumentIds.length} docs).`,
      details: {
        targetEmail: target.email,
        previousRole,
        newRole: target.role,
        previousDocCount: previousDocs.length,
        newDocCount: target.allowedDocumentIds.length,
        allowedDocumentIds: target.allowedDocumentIds,
      },
    });

    res.json({ user: toPublicUser(target) });
  });

  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.id);
    if (targetId === req.authUser!.id) {
      res.status(400).json({ error: 'You cannot delete your own active session account.' });
      return;
    }

    const store = loadStore();
    const idx = store.users.findIndex((u) => u.id === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const [removedUser] = store.users.splice(idx, 1);
    store.chatSessions = store.chatSessions.filter((s) => s.userId !== targetId);
    saveStore(store);

    logEvent({
      level: 'warn',
      category: 'permission',
      action: 'user_deleted',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      targetType: 'user',
      targetId,
      statusCode: 200,
      ip: req.ip,
      summary: `Deleted user account ${removedUser.email} and associated chat history.`,
    });

    res.json({ deletedId: targetId });
  });

  // --- Chat Sessions & Permission-Gated RAG Q&A ---
  app.get('/api/chat/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
    const sessions = getSessionsForUser(req.authUser!.id);
    res.json({ sessions });
  });

  app.post('/api/chat/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 80)
        : 'New Conversation';

    const now = new Date().toISOString();
    const session: ChatSession = {
      id: `chat-${crypto.randomUUID()}`,
      userId: req.authUser!.id,
      title,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    const store = loadStore();
    store.chatSessions.push(session);
    saveStore(store);

    logEvent({
      category: 'chat',
      action: 'session_created',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      targetType: 'chat_session',
      targetId: session.id,
      statusCode: 201,
      ip: req.ip,
      summary: `Started new chat session "${session.title}".`,
    });

    res.status(201).json({ session });
  });

  app.delete('/api/chat/sessions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = loadStore();
    const idx = store.chatSessions.findIndex(
      (s) => s.id === req.params.id && s.userId === req.authUser!.id,
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }
    const [removedSession] = store.chatSessions.splice(idx, 1);
    saveStore(store);

    logEvent({
      category: 'chat',
      action: 'session_deleted',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      targetType: 'chat_session',
      targetId: removedSession.id,
      statusCode: 200,
      ip: req.ip,
      summary: `Deleted chat session "${removedSession.title}".`,
    });

    res.json({ deletedId: req.params.id });
  });

  app.post('/api/chat/ask', requireAuth, async (req: AuthenticatedRequest, res) => {
    const startedAt = Date.now();
    const user = req.authUser!;
    try {
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      const requestedSessionId =
        typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;

      if (!question) {
        res.status(400).json({ error: 'Please enter a question.' });
        return;
      }

      const store = loadStore();
      let session: ChatSession | undefined;

      if (requestedSessionId) {
        session = store.chatSessions.find(
          (s) => s.id === requestedSessionId && s.userId === user.id,
        );
      }

      if (!session) {
        const now = new Date().toISOString();
        session = {
          id: `chat-${crypto.randomUUID()}`,
          userId: user.id,
          title: question.slice(0, 56),
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        store.chatSessions.push(session);
      } else if (session.messages.length === 0) {
        session.title = question.slice(0, 56);
      }

      // CRITICAL SECURITY BOUNDARY:
      // Filter documents and chunks strictly by the authenticated user's RBAC permissions
      // BEFORE vector retrieval and BEFORE calling Gemini.
      const activeSettings = getWorkspaceSettings();
      const authorizedDocIds = getAuthorizedDocumentIdsForUser(user);
      const authorizedDocs = store.documents.filter((d) => authorizedDocIds.includes(d.id));
      const authorizedChunks = getChunksForDocumentIds(authorizedDocIds);

      const { results: retrieved, usedDenseVectors } = await retrieveAuthorizedChunks({
        query: question,
        authorizedChunks,
        topK: activeSettings.topK,
        useDenseEmbeddings: activeSettings.embeddingMode === 'gemini-embedding-2',
      });

      const { answer, citations, model } = await generateGroundedAnswer({
        question,
        history: session.messages,
        retrieved,
        authorizedDocNames: authorizedDocs.map((d) => d.originalName),
        model: activeSettings.llmModel,
        enableFallbackModel: activeSettings.enableFallbackModel,
        thinkingLevel: activeSettings.thinkingLevel,
        onRetry: (info) => {
          logEvent({
            level: 'warn',
            category: 'rag',
            action: 'gemini_retry',
            actorId: user.id,
            actorEmail: user.email,
            actorRole: user.role,
            targetType: 'chat_session',
            targetId: session!.id,
            ip: req.ip,
            summary: `Transient Gemini error on ${info.model} (attempt ${info.attempt}); retrying.`,
            details: { model: info.model, attempt: info.attempt, error: info.error },
          });
        },
      });

      const userMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      };

      const assistantMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: answer,
        citations,
        authorizedDocCount: authorizedDocs.length,
        retrievedChunkCount: retrieved.length,
        model,
        createdAt: new Date().toISOString(),
      };

      session.messages.push(userMessage, assistantMessage);
      session.updatedAt = new Date().toISOString();
      saveStore(store);

      logEvent({
        category: 'rag',
        action: 'rag_query_completed',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'chat_session',
        targetId: session.id,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        ip: req.ip,
        summary: `Answered RAG query across ${authorizedDocs.length} authorized doc(s) with ${citations.length} source(s) via ${model}.`,
        details: {
          questionPreview: question.slice(0, 120),
          authorizedDocNames: authorizedDocs.map((d) => d.originalName),
          retrievedChunks: citations.map((c) => `${c.documentName}#p${c.pageNumber} (${c.score})`),
          usedDenseVectors,
          model,
        },
      });

      res.json({
        session,
        userMessage,
        assistantMessage,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to answer question.';
      logEvent({
        level: 'error',
        category: 'rag',
        action: 'rag_query_failed',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        statusCode: 500,
        latencyMs: Date.now() - startedAt,
        ip: req.ip,
        summary: `RAG query failed: ${message}`,
      });
      res.status(500).json({ error: message });
    }
  });

  // --- Admin Audit Logs ---
  app.get('/api/admin/logs', requireAuth, requireAdmin, (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : 'all';
    const level = typeof req.query.level === 'string' ? req.query.level : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 250;

    const result = queryLogs({
      category,
      level,
      search,
      limit: Number.isFinite(limit) ? limit : 250,
    });
    res.json(result);
  });

  app.get('/api/admin/logs/export', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'jsonl';
    logEvent({
      category: 'system',
      action: 'logs_exported',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      statusCode: 200,
      ip: req.ip,
      summary: `Exported full audit log in ${format.toUpperCase()} format.`,
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vaultrags-audit-logs.csv"');
      res.send(exportLogsCsv());
      return;
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vaultrags-audit-logs.jsonl"');
    res.send(exportLogsJsonl());
  });

  app.delete('/api/admin/logs', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const entry = clearAllLogs({
      id: req.authUser!.id,
      email: req.authUser!.email,
    });
    res.json({ cleared: true, latestEntry: entry });
  });

  // --- Admin Model & API Settings ---
  app.get('/api/admin/settings', requireAuth, requireAdmin, (_req, res) => {
    const settings = getWorkspaceSettings();
    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY.trim().length > 0 &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );
    res.json({
      settings,
      envStatus: {
        hasGeminiKey,
        hasAdminPasscode: hasEnvAdminPasscode(),
      },
    });
  });

  app.patch('/api/admin/settings', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const store = loadStore();
    const current = getWorkspaceSettings();

    const allowedModels: LlmModelId[] = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
    const allowedEmbeddings: EmbeddingMode[] = ['gemini-embedding-2', 'local-lexical'];
    const allowedThinking: ThinkingDepth[] = ['LOW', 'MEDIUM', 'HIGH'];

    const nextLlm =
      typeof req.body?.llmModel === 'string' &&
      allowedModels.includes(req.body.llmModel as LlmModelId)
        ? (req.body.llmModel as LlmModelId)
        : current.llmModel;

    const nextFallback =
      typeof req.body?.enableFallbackModel === 'boolean'
        ? req.body.enableFallbackModel
        : current.enableFallbackModel;

    const nextThinking =
      typeof req.body?.thinkingLevel === 'string' &&
      allowedThinking.includes(req.body.thinkingLevel as ThinkingDepth)
        ? (req.body.thinkingLevel as ThinkingDepth)
        : current.thinkingLevel;

    const nextEmbedding =
      typeof req.body?.embeddingMode === 'string' &&
      allowedEmbeddings.includes(req.body.embeddingMode as EmbeddingMode)
        ? (req.body.embeddingMode as EmbeddingMode)
        : current.embeddingMode;

    const rawTopK = Number(req.body?.topK);
    const nextTopK = Number.isFinite(rawTopK)
      ? Math.min(10, Math.max(1, Math.round(rawTopK)))
      : current.topK;

    const rawChunkSize = Number(req.body?.chunkSizeChars);
    const nextChunkSize = Number.isFinite(rawChunkSize)
      ? Math.min(2000, Math.max(300, Math.round(rawChunkSize)))
      : current.chunkSizeChars;

    const rawOverlap = Number(req.body?.chunkOverlapChars);
    const nextOverlap = Number.isFinite(rawOverlap)
      ? Math.min(Math.floor(nextChunkSize / 2), Math.max(0, Math.round(rawOverlap)))
      : Math.min(current.chunkOverlapChars, Math.floor(nextChunkSize / 2));

    store.settings = {
      llmModel: nextLlm,
      enableFallbackModel: nextFallback,
      thinkingLevel: nextThinking,
      embeddingMode: nextEmbedding,
      topK: nextTopK,
      chunkSizeChars: nextChunkSize,
      chunkOverlapChars: nextOverlap,
    };
    saveStore(store);

    logEvent({
      category: 'system',
      action: 'settings_updated',
      actorId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: 'admin',
      statusCode: 200,
      ip: req.ip,
      summary: `Updated model & API settings (LLM: ${store.settings.llmModel}, Embedding: ${store.settings.embeddingMode}, Top-K: ${store.settings.topK}).`,
      details: { settings: store.settings },
    });

    const hasGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY.trim().length > 0 &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    );
    res.json({
      settings: store.settings,
      envStatus: {
        hasGeminiKey,
        hasAdminPasscode: hasEnvAdminPasscode(),
      },
    });
  });

  // --- Live Pipeline Diagnostics (role-scoped) ---
  app.get('/api/pipeline/stats', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const store = loadStore();
    const activeSettings = getWorkspaceSettings();
    const authorizedIds = getAuthorizedDocumentIdsForUser(user);
    const authorizedChunks = getChunksForDocumentIds(authorizedIds);
    const denseChunkCount = authorizedChunks.filter(
      (c) => Array.isArray(c.embedding) && c.embedding.length > 0,
    ).length;

    res.json({
      role: user.role,
      authorizedDocumentCount: authorizedIds.length,
      totalVaultDocumentCount: user.role === 'admin' ? store.documents.length : authorizedIds.length,
      authorizedChunkCount: authorizedChunks.length,
      denseVectorChunkCount: denseChunkCount,
      chunkSizeChars: activeSettings.chunkSizeChars,
      chunkOverlapChars: activeSettings.chunkOverlapChars,
      llmModel: activeSettings.llmModel,
      embeddingModel: activeSettings.embeddingMode,
      topK: activeSettings.topK,
      thinkingLevel: activeSettings.thinkingLevel,
      enableFallbackModel: activeSettings.enableFallbackModel,
    });
  });

  // Ensure unmatched /api routes and API errors always return JSON instead of falling through to SPA HTML
  app.use('/api', (req, res) => {
    logEvent({
      level: 'warn',
      category: 'system',
      action: 'api_not_found',
      statusCode: 404,
      ip: req.ip,
      summary: `404 Not Found for ${req.method} ${req.originalUrl}.`,
    });
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(
    '/api',
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : 'Unexpected server error.';
      logEvent({
        level: 'error',
        category: 'system',
        action: 'unhandled_api_error',
        statusCode: 500,
        ip: req.ip,
        summary: `Unhandled API error on ${req.method} ${req.originalUrl}: ${message}`,
      });
      res.status(500).json({ error: message });
    },
  );

  // --- Vite Dev / Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logEvent({
      category: 'system',
      action: 'server_started',
      actorRole: 'system',
      summary: `VaultRAG server listening on port ${PORT}.`,
      details: { nodeVersion: process.version, env: process.env.NODE_ENV || 'development' },
    });
  });
}

startServer().catch((err) => {
  console.error('Failed to start VaultRAG server:', err);
  process.exit(1);
});
