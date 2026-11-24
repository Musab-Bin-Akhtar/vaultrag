import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PipelineStats } from '../types';

const PIPELINE_STEPS = [
  {
    step: '01. PDF Upload & Validation',
    detail:
      'Administrators upload PDF files through a role-protected Express endpoint. Files are checked for valid PDF headers and stored safely outside public static folders.',
  },
  {
    step: '02. Page-by-Page Text Extraction',
    detail:
      'pdfjs-dist reads each PDF page sequentially so every extracted paragraph keeps its exact source filename and page number.',
  },
  {
    step: '03. Overlapping Text Chunking',
    detail:
      'Extracted page text is split into 750-character windows with a 150-character overlap so sentences straddling boundaries remain searchable.',
  },
  {
    step: '04. Vector Embeddings & Index',
    detail:
      'Chunks are embedded into dense vectors using Gemini Embedding 2 (paired with lexical term scoring) and stored in the local vector index.',
  },
  {
    step: '05. Backend Permission Gate',
    detail:
      'When you ask a question, the server verifies your signed session token and filters the vector store to ONLY your allowed document IDs before scoring.',
  },
  {
    step: '06. Gemini Answer & Source Citations',
    detail:
      'Only the top-matching authorized excerpts are sent to Gemini 4 Hydrogen, which returns a grounded answer with clickable [Source N] document and page citations.',
  },
];

export function RagPipelineGuide() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPipelineStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load stats.'));
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
          How VaultRAG Answers Questions Safely
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          This workspace implements the 6-stage Retrieval-Augmented Generation (RAG) architecture
          with strict server-side Role-Based Access Control (RBAC). Unauthorized documents are
          excluded before vector similarity search runs and are never sent to Gemini.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-slate-100">
            <div>
              <div className="text-xs text-slate-500">Your Role</div>
              <div className="text-base font-semibold text-slate-900 mt-0.5 capitalize">
                {stats.role === 'admin' ? 'Administrator' : 'Regular User'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Authorized PDFs</div>
              <div className="text-base font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {stats.authorizedDocumentCount} / {stats.totalVaultDocumentCount}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Searchable Chunks</div>
              <div className="text-base font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {stats.authorizedChunkCount}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Chunk Window</div>
              <div className="text-base font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                {stats.chunkSizeChars} / {stats.chunkOverlapChars}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Active Model</div>
              <div className="text-sm font-semibold text-slate-900 font-mono mt-1 truncate">
                {stats.llmModel}
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PIPELINE_STEPS.map((item) => (
          <div key={item.step} className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">{item.step}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
