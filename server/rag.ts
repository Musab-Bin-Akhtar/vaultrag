import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ChatMessage, Citation, DocumentChunk, LlmModelId, ThinkingDepth } from './types.ts';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

const DEFAULT_CHUNK_SIZE = 750;
const DEFAULT_CHUNK_OVERLAP = 150;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add your key in the Settings > Secrets panel to run Gemini Q&A and embeddings.',
    );
  }

  const isOAuthToken = apiKey.startsWith('AQ.') || apiKey.startsWith('ya29.');
  if (isOAuthToken) {
    return new GoogleGenAI({
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
          'Authorization': `Bearer ${apiKey}`,
        },
      },
    });
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Generates a valid multi-page PDF buffer from plain text pages so starter policy docs
 * are real PDFs on disk and pass through the exact same pdfjs-dist extraction pipeline.
 */
export function buildSimplePdfBuffer(title: string, pages: string[]): Buffer {
  const objects: string[] = [];

  const escapePdfText = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  // 1: Catalog, 2: Pages, 3: Font
  const pageObjectNumbers: number[] = [];
  let nextObjNum = 4;

  const pageEntries: Array<{ pageObj: number; contentObj: number; stream: string }> = [];

  for (const pageText of pages) {
    const pageObj = nextObjNum++;
    const contentObj = nextObjNum++;
    pageObjectNumbers.push(pageObj);

    const lines = pageText
      .split('\n')
      .flatMap((line) => {
        if (line.length <= 88) return [line];
        const wrapped: string[] = [];
        let remaining = line;
        while (remaining.length > 88) {
          let splitAt = remaining.lastIndexOf(' ', 88);
          if (splitAt <= 20) splitAt = 88;
          wrapped.push(remaining.slice(0, splitAt));
          remaining = remaining.slice(splitAt).trimStart();
        }
        if (remaining) wrapped.push(remaining);
        return wrapped;
      })
      .slice(0, 48);

    const streamLines = [
      'BT',
      '/F1 10 Tf',
      '50 760 Td',
      `(${escapePdfText(title)}) Tj`,
      '0 -20 Td',
    ];
    for (const line of lines) {
      streamLines.push(`(${escapePdfText(line)}) Tj`);
      streamLines.push('0 -14 Td');
    }
    streamLines.push('ET');
    const stream = streamLines.join('\n');
    pageEntries.push({ pageObj, contentObj, stream });
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>\nendobj\n`,
  );
  objects.push(
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );

  for (const entry of pageEntries) {
    objects.push(
      `${entry.pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${entry.contentObj} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${entry.contentObj} 0 obj\n<< /Length ${Buffer.byteLength(entry.stream, 'utf8')} >>\nstream\n${entry.stream}\nendstream\nendobj\n`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

/**
 * Extracts text page-by-page from a PDF buffer using pdfjs-dist so every chunk
 * retains an accurate page number for RAG source citations.
 */
export async function extractPdfPages(pdfBuffer: Uint8Array): Promise<ExtractedPage[]> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBuffer,
    verbosity: 0,
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const pages: ExtractedPage[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean);
      const pageText = strings.join(' ').replace(/\s+/g, ' ').trim();
      if (pageText.length > 0) {
        pages.push({ pageNumber: pageNum, text: pageText });
      }
    }
  } finally {
    await pdfDoc.cleanup();
  }

  return pages;
}

/**
 * Splits extracted PDF pages into overlapping chunks while preserving page metadata.
 */
export function chunkDocumentPages(params: {
  documentId: string;
  documentName: string;
  department: string;
  pages: ExtractedPage[];
  chunkSize?: number;
  chunkOverlap?: number;
}): DocumentChunk[] {
  const chunkSize = params.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(params.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP, Math.floor(chunkSize / 2));
  const chunks: DocumentChunk[] = [];
  let globalIndex = 0;

  for (const page of params.pages) {
    const cleanText = page.text.replace(/\s+/g, ' ').trim();
    if (!cleanText) continue;

    if (cleanText.length <= chunkSize) {
      chunks.push({
        id: `${params.documentId}-c${globalIndex}`,
        documentId: params.documentId,
        documentName: params.documentName,
        department: params.department,
        pageNumber: page.pageNumber,
        chunkIndex: globalIndex,
        content: cleanText,
      });
      globalIndex++;
      continue;
    }

    let start = 0;
    while (start < cleanText.length) {
      let end = Math.min(start + chunkSize, cleanText.length);
      if (end < cleanText.length) {
        const sentenceBreak = cleanText.lastIndexOf('. ', end);
        const spaceBreak = cleanText.lastIndexOf(' ', end);
        if (sentenceBreak > start + chunkSize * 0.55) {
          end = sentenceBreak + 1;
        } else if (spaceBreak > start + chunkSize * 0.6) {
          end = spaceBreak;
        }
      }

      const slice = cleanText.slice(start, end).trim();
      if (slice.length > 0) {
        chunks.push({
          id: `${params.documentId}-c${globalIndex}`,
          documentId: params.documentId,
          documentName: params.documentName,
          department: params.department,
          pageNumber: page.pageNumber,
          chunkIndex: globalIndex,
          content: slice,
        });
        globalIndex++;
      }

      if (end >= cleanText.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }

  return chunks;
}

/**
 * Generates dense vector embeddings using Gemini (`gemini-embedding-2`) when GEMINI_API_KEY
 * is available. Throws if unavailable so callers can decide whether to fail or mark local-only.
 */
export async function generateGeminiEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getGeminiClient();

  const vectors: number[][] = [];
  const batchSize = 20;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      // Pass explicit Content objects ({ parts: [{ text }] }) so gemini-embedding-2
      // embeds each chunk separately rather than merging plain strings into one Content.
      contents: batch.map((text) => ({ parts: [{ text }] })),
    });

    const embeddings = result.embeddings ?? [];
    if (embeddings.length === batch.length) {
      for (const emb of embeddings) {
        if (!emb.values || emb.values.length === 0) {
          throw new Error('Embedding response did not contain vector values.');
        }
        vectors.push(emb.values);
      }
      continue;
    }

    // Safety fallback if the endpoint ever returns fewer vectors than requested in a batch
    for (const text of batch) {
      const single = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: [{ parts: [{ text }] }],
      });
      const first = single.embeddings?.[0];
      if (!first?.values || first.values.length === 0) {
        throw new Error(
          `Embedding response returned ${embeddings.length} vector(s) for ${batch.length} chunk(s).`,
        );
      }
      vectors.push(first.values);
    }
  }
  return vectors;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'or', 'of', 'to', 'in', 'for', 'with',
  'as', 'by', 'an', 'be', 'this', 'that', 'are', 'from', 'it', 'can', 'what', 'how',
  'who', 'when', 'where', 'why', 'do', 'does', 'my', 'our', 'we', 'you', 'your',
]);

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function lexicalOverlapScore(query: string, content: string): number {
  const qTokens = tokenize(query).filter((t) => !STOP_WORDS.has(t));
  if (qTokens.length === 0) return 0;
  const cTokens = tokenize(content);
  if (cTokens.length === 0) return 0;

  const cFreq = new Map<string, number>();
  for (const token of cTokens) {
    cFreq.set(token, (cFreq.get(token) ?? 0) + 1);
  }

  let hits = 0;
  for (const qt of qTokens) {
    const exact = cFreq.get(qt) ?? 0;
    if (exact > 0) {
      hits += 1 + Math.min(exact - 1, 2) * 0.25;
    } else {
      // Partial prefix match for stems (e.g., reimburs* -> reimbursement)
      for (const ct of cFreq.keys()) {
        if (qt.length >= 4 && ct.startsWith(qt.slice(0, 4))) {
          hits += 0.5;
          break;
        }
      }
    }
  }

  return Math.min(1, hits / Math.max(1, qTokens.length));
}

export interface ScoredChunk {
  chunk: DocumentChunk;
  score: number;
}

/**
 * Retrieves top-k chunks ONLY from the caller's pre-filtered authorizedChunks array.
 * Unauthorized chunks are never passed into this function.
 */
export async function retrieveAuthorizedChunks(params: {
  query: string;
  authorizedChunks: DocumentChunk[];
  topK?: number;
  useDenseEmbeddings?: boolean;
}): Promise<{ results: ScoredChunk[]; usedDenseVectors: boolean }> {
  const { query, authorizedChunks, topK = 5, useDenseEmbeddings = true } = params;
  if (authorizedChunks.length === 0) {
    return { results: [], usedDenseVectors: false };
  }

  const hasDenseEmbeddings = authorizedChunks.every(
    (c) => Array.isArray(c.embedding) && c.embedding.length > 0,
  );

  let queryVector: number[] | null = null;
  let usedDenseVectors = false;

  if (useDenseEmbeddings && hasDenseEmbeddings && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const [vec] = await generateGeminiEmbeddings([query]);
      if (vec && vec.length > 0) {
        queryVector = vec;
        usedDenseVectors = true;
      }
    } catch {
      // Fall back to lexical retrieval scoring if embedding endpoint hits quota/network error;
      // Gemini Q&A below will still report any real API errors directly.
      queryVector = null;
    }
  }

  const scored: ScoredChunk[] = authorizedChunks.map((chunk) => {
    const lexical = lexicalOverlapScore(query, `${chunk.documentName} ${chunk.department} ${chunk.content}`);
    if (queryVector && chunk.embedding && chunk.embedding.length === queryVector.length) {
      const dense = Math.max(0, cosineSimilarity(queryVector, chunk.embedding));
      return {
        chunk,
        score: Number((dense * 0.72 + lexical * 0.28).toFixed(4)),
      };
    }
    return {
      chunk,
      score: Number(lexical.toFixed(4)),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return {
    results: scored.slice(0, topK),
    usedDenseVectors,
  };
}

/**
 * Sends ONLY the user-authorized retrieved chunks to Gemini for grounded question answering.
 */
export async function generateGroundedAnswer(params: {
  question: string;
  history: ChatMessage[];
  retrieved: ScoredChunk[];
  authorizedDocNames: string[];
  model?: LlmModelId;
  enableFallbackModel?: boolean;
  thinkingLevel?: ThinkingDepth;
  onRetry?: (info: { model: string; attempt: number; error: string }) => void;
}): Promise<{ answer: string; citations: Citation[]; model: string }> {
  const primaryModel: LlmModelId = params.model ?? 'gemini-4-hydrogen';
  const enableFallback = params.enableFallbackModel ?? true;
  const thinkingDepth: ThinkingDepth = params.thinkingLevel ?? 'MEDIUM';

  if (params.authorizedDocNames.length === 0) {
    return {
      answer:
        'You do not currently have access to any documents in the knowledge base. Ask an administrator to grant you document permissions in Access Control.',
      citations: [],
      model: primaryModel,
    };
  }

  const ai = getGeminiClient();

  const contextBlocks = params.retrieved
    .map((item, idx) => {
      const sourceNum = idx + 1;
      return `[Source ${sourceNum}] Document: ${item.chunk.documentName} | Department: ${item.chunk.department} | Page: ${item.chunk.pageNumber}\nExcerpt: ${item.chunk.content}`;
    })
    .join('\n\n');

  const recentHistory = params.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const systemInstruction = [
    'You are VaultRAG, a precise enterprise document assistant.',
    'Answer the user question strictly using ONLY the provided authorized document excerpts below.',
    'Every factual claim must cite its source inline like [Source 1] or [Source 2].',
    'If the authorized document excerpts do not contain the answer (for example, if the question asks about a restricted policy or topic outside the user\'s authorized documents), clearly state that the answer was not found in the user\'s authorized documents and list which authorized documents were searched.',
    'Never invent policies, numbers, or facts outside the provided context.',
    'Keep the formatting clean, readable, and concise using plain prose and short bullet lists when helpful.',
  ].join(' ');

  const prompt = [
    `Authorized Documents Searched: ${params.authorizedDocNames.join(', ')}`,
    recentHistory ? `Recent Conversation:\n${recentHistory}` : '',
    `Retrieved Authorized Excerpts:\n${contextBlocks || '(No matching excerpts found in authorized documents.)'}`,
    `User Question: ${params.question}`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const isTransientError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('503') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('high demand') ||
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED')
    );
  };

  const secondaryModel: LlmModelId =
    primaryModel === 'gemini-4-hydrogen' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';
  const candidateModels: LlmModelId[] = enableFallback
    ? [primaryModel, secondaryModel]
    : [primaryModel];

  const mappedThinking =
    thinkingDepth === 'LOW'
      ? ThinkingLevel.LOW
      : thinkingDepth === 'HIGH'
        ? ThinkingLevel.HIGH
        : ThinkingLevel.MEDIUM;

  let usedModel: string = primaryModel;
  let responseText: string | undefined;
  let lastError: unknown;

  for (const candidateModel of candidateModels) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const config =
          candidateModel === 'gemini-4-hydrogen'
            ? {
                systemInstruction,
                thinkingConfig: { thinkingLevel: mappedThinking },
              }
            : { systemInstruction };

        const response = await ai.models.generateContent({
          model: candidateModel,
          contents: prompt,
          config,
        });
        responseText = response.text;
        usedModel = candidateModel;
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (!isTransientError(err)) {
          throw err;
        }
        params.onRetry?.({
          model: candidateModel,
          attempt: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < 2) {
          await sleep(700 * (attempt + 1));
        }
      }
    }
    if (!lastError) break;
  }

  if (lastError) {
    const rawMsg = lastError instanceof Error ? lastError.message : String(lastError);
    if (rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')) {
      throw new Error(
        'Gemini is temporarily experiencing high demand (503 UNAVAILABLE) even after retrying. Please wait a few seconds and send your question again.',
      );
    }
    throw lastError instanceof Error ? lastError : new Error(rawMsg);
  }

  const answer =
    responseText?.trim() ||
    'I could not generate an answer from the authorized document excerpts. Please try rephrasing your question.';

  const citations: Citation[] = params.retrieved.map((item, idx) => ({
    sourceNumber: idx + 1,
    documentId: item.chunk.documentId,
    documentName: item.chunk.documentName,
    department: item.chunk.department,
    pageNumber: item.chunk.pageNumber,
    chunkIndex: item.chunk.chunkIndex,
    score: item.score,
    excerpt: item.chunk.content,
  }));

  return { answer, citations, model: usedModel };
}
