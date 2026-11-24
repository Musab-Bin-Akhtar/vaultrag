import React, { useEffect, useState } from 'react';
import { Check, Cpu, Database, Lock, Save, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import type {
  EmbeddingMode,
  LlmModelId,
  SettingsResponse,
  ThinkingDepth,
  WorkspaceSettings,
} from '../types';

interface AdminSettingsProps {
  onSettingsSaved?: (settings: WorkspaceSettings) => void;
}

const LLM_OPTIONS: Array<{
  id: LlmModelId;
  name: string;
  description: string;
}> = [
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    description:
      'Balanced intelligence and synthesis across multi-page policy PDFs with configurable reasoning depth.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description:
      'Ultra-fast, lightweight model ideal for quick lookups and high availability during traffic spikes.',
  },
];

const EMBEDDING_OPTIONS: Array<{
  id: EmbeddingMode;
  name: string;
  description: string;
}> = [
  {
    id: 'gemini-embedding-2',
    name: 'Gemini Embedding 2 + Lexical Hybrid',
    description:
      'Calls the server-side Gemini Embeddings API for dense semantic similarity paired with keyword overlap scoring.',
  },
  {
    id: 'local-lexical',
    name: 'Local Lexical Retrieval Only',
    description:
      'Scores and ranks document chunks purely on the local server without calling the external Embeddings API.',
  },
];

export function AdminSettings({ onSettingsSaved }: AdminSettingsProps) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getSettings()
      .then((res) => {
        setData(res);
        setForm(res.settings);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const res = await api.updateSettings(form);
      setData(res);
      setForm(res.settings);
      setSavedNotice('Settings saved and applied across RAG retrieval and Gemini Q&A.');
      onSettingsSaved?.(res.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        {error ? (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        ) : (
          <div className="text-xs text-slate-500">Loading model and API settings...</div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Model &amp; Retrieval API Settings
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Choose the active Gemini model, reasoning depth, and retrieval API behavior for the
            entire workspace.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {savedNotice && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Generation Model (LLM) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Cpu className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Gemini Answer Generation Model
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Select which server-side Gemini model generates grounded responses from retrieved
              excerpts.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LLM_OPTIONS.map((opt) => {
            const active = form.llmModel === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setForm({ ...form, llmModel: opt.id })}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-slate-900">{opt.name}</span>
                  <span className="text-xs font-mono text-slate-500">{opt.id}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{opt.description}</p>
              </button>
            );
          })}
        </div>

        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              Reasoning Depth (Gemini 4 Hydrogen)
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Lower depth reduces response latency; higher depth improves multi-document synthesis.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['LOW', 'MEDIUM', 'HIGH'] as ThinkingDepth[]).map((depth) => (
              <button
                key={depth}
                type="button"
                disabled={form.llmModel !== 'gemini-4-hydrogen'}
                onClick={() => setForm({ ...form, thinkingLevel: depth })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap disabled:opacity-40 ${
                  form.thinkingLevel === depth
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {depth}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <label className="inline-flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enableFallbackModel}
              onChange={(e) => setForm({ ...form, enableFallbackModel: e.target.checked })}
              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            <span>
              Automatically fall back to the alternate Gemini model if the primary model returns
              503 / 429 overload errors
            </span>
          </label>
        </div>
      </section>

      {/* Embeddings & Retrieval API */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Embedding &amp; Retrieval Strategy
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Choose whether to combine Gemini Embedding 2 vectors with lexical scoring or keep
              document chunk retrieval 100% local on the server.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {EMBEDDING_OPTIONS.map((opt) => {
            const active = form.embeddingMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setForm({ ...form, embeddingMode: opt.id })}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-50/50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900 mb-1">{opt.name}</div>
                <p className="text-xs text-slate-600 leading-relaxed">{opt.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
          <div>
            <label
              htmlFor="setting-topk"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Retrieved Sources (Top-K)
            </label>
            <select
              id="setting-topk"
              value={form.topK}
              onChange={(e) => setForm({ ...form, topK: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
            >
              <option value={3}>3 chunks</option>
              <option value={5}>5 chunks</option>
              <option value={8}>8 chunks</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-chunk-size"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              New PDF Chunk Size
            </label>
            <select
              id="setting-chunk-size"
              value={form.chunkSizeChars}
              onChange={(e) => setForm({ ...form, chunkSizeChars: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
            >
              <option value={500}>500 chars</option>
              <option value={750}>750 chars</option>
              <option value={1000}>1000 chars</option>
              <option value={1400}>1400 chars</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-overlap"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              New PDF Chunk Overlap
            </label>
            <select
              id="setting-overlap"
              value={form.chunkOverlapChars}
              onChange={(e) => setForm({ ...form, chunkOverlapChars: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
            >
              <option value={100}>100 chars</option>
              <option value={150}>150 chars</option>
              <option value={200}>200 chars</option>
            </select>
          </div>
        </div>
      </section>

      {/* Read-only Environment & Secrets Status */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <Lock className="w-5 h-5 text-blue-700 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Server API &amp; Secret Status (Read-Only)
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              API keys and admin passcodes are read exclusively from server environment variables
              and are never exposed or edited in the browser.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-mono font-medium text-slate-900">GEMINI_API_KEY</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Server-side @google/genai authentication
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${
                data.envStatus.hasGeminiKey ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{data.envStatus.hasGeminiKey ? 'Configured' : 'Not Configured'}</span>
            </span>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-mono font-medium text-slate-900">ADMIN_PASSCODE</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Optional Admin sign-in environment override
              </div>
            </div>
            <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
              {data.envStatus.hasAdminPasscode ? 'Configured' : 'Using Account Hash'}
            </span>
          </div>
        </div>
      </section>
    </form>
  );
}
