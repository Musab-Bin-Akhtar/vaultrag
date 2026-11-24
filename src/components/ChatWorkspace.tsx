import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Lock,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client';
import type { ChatMessage, ChatSession, Citation, DocumentItem, User } from '../types';

interface ChatWorkspaceProps {
  user: User;
  authorizedDocs: DocumentItem[];
  activeSession: ChatSession | null;
  activeModelId?: string;
  onSessionUpdated: (session: ChatSession) => void;
}

const STARTER_PROMPTS = [
  {
    label: 'Annual Leave Allowance',
    question: 'How many days of paid annual leave do employees receive, and how many can carry over?',
    hint: 'Covered in HR_Leave_Policy_2026.pdf',
  },
  {
    label: 'Business Travel Hotel Cap',
    question: 'What is the maximum nightly hotel reimbursement rate for Tier-1 cities?',
    hint: 'Covered in Finance_Expense_Policy_2026.pdf (Admin / Authorized)',
  },
  {
    label: 'Remote VPN & MFA Rules',
    question: 'What MFA methods and VPN software are required for remote access?',
    hint: 'Covered in IT_Security_Guidelines_2026.pdf (Admin / Authorized)',
  },
];

function renderFormattedText(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={lineIdx} className="h-2.5" />;
    }

    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
    const content = isBullet ? trimmed.slice(2) : line;

    // Safely render **bold** spans without HTML injection
    const parts = content.split(/(\*\*[^*]+\*\*)/g);
    const renderedParts = parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={idx} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });

    if (isBullet) {
      return (
        <div key={lineIdx} className="flex items-start gap-2 pl-2 my-1">
          <span className="text-slate-400 select-none mt-0.5">•</span>
          <span className="leading-relaxed">{renderedParts}</span>
        </div>
      );
    }

    return (
      <p key={lineIdx} className="leading-relaxed my-1">
        {renderedParts}
      </p>
    );
  });
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (citations.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-200">
      <div className="text-xs font-medium text-slate-500 mb-2">
        Retrieved Sources ({citations.length})
      </div>
      <div className="space-y-2">
        {citations.map((c, idx) => {
          const isOpen = expandedIndex === idx;
          return (
            <div
              key={`${c.documentId}-${c.chunkIndex}-${idx}`}
              className="border border-slate-200 rounded-lg bg-slate-50"
            >
              <button
                type="button"
                onClick={() => setExpandedIndex(isOpen ? null : idx)}
                className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-slate-100/70 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <FileText className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span className="text-xs font-medium text-slate-900 truncate">
                    [Source {c.sourceNumber}] {c.documentName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap shrink-0">
                  <span>{c.department}</span>
                  <span aria-hidden="true">·</span>
                  <span>Page {c.pageNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span>{Math.round(c.score * 100)}% match</span>
                </div>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 text-xs text-slate-700 leading-relaxed border-t border-slate-200/80 bg-white rounded-b-lg">
                  {c.excerpt}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChatWorkspace({
  user,
  authorizedDocs,
  activeSession,
  activeModelId,
  onSessionUpdated,
}: ChatWorkspaceProps) {
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages: ChatMessage[] = activeSession?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const submitQuestion = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    setError(null);
    setSending(true);
    setQuestion('');
    try {
      const res = await api.askQuestion({
        question: trimmed,
        sessionId: activeSession?.id ?? null,
      });
      onSessionUpdated(res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate answer.');
      setQuestion(trimmed);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuestion(question);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Scope summary strip */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          {user.role === 'admin' ? (
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
          ) : (
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
          )}
          <span className="font-medium text-slate-900 whitespace-nowrap">
            {user.role === 'admin' ? 'Admin Retrieval Scope' : 'Authorized Retrieval Scope'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">
            {authorizedDocs.length === 0
              ? 'No documents assigned to your account yet'
              : `${authorizedDocs.length} document${authorizedDocs.length === 1 ? '' : 's'}: ${authorizedDocs
                  .map((d) => d.originalName)
                  .join(', ')}`}
          </span>
        </div>
        <div className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap shrink-0">
          {activeModelId === 'gemini-3.1-flash-lite'
            ? 'Gemini 3.1 Flash Lite'
            : 'Gemini 4 Hydrogen'}{' '}
          · Strict RBAC Filter
        </div>
      </div>

      {/* Scrollable conversation thread */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8">
              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                Ask questions grounded in your authorized PDFs
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-6">
                Every query searches only the documents permitted for your account (
                <span className="font-medium text-slate-900">
                  {user.role === 'admin' ? 'Admin — Full Vault' : 'Employee — Assigned Only'}
                </span>
                ). Try a starter prompt below to test retrieval and page citations.
              </p>

              <div className="grid grid-cols-1 gap-3">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={sending}
                    onClick={() => submitQuestion(item.question)}
                    className="text-left p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                      <span className="text-xs text-slate-500">{item.hint}</span>
                    </div>
                    <p className="text-xs text-slate-600">{item.question}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.role === 'user'
                    ? 'flex justify-end'
                    : 'bg-white border border-slate-200 rounded-xl p-5'
                }
              >
                {msg.role === 'user' ? (
                  <div className="max-w-xl bg-blue-700 text-white rounded-xl px-4 py-3 text-sm leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2.5 text-xs text-slate-500">
                      <span className="font-semibold text-slate-900">VaultRAG Assistant</span>
                      <span className="font-mono tabular-nums">
                        {msg.authorizedDocCount ?? 0} docs searched · {msg.retrievedChunkCount ?? 0}{' '}
                        chunks retrieved
                      </span>
                    </div>
                    <div className="text-sm text-slate-800">
                      {renderFormattedText(msg.content)}
                    </div>
                    {msg.citations && <CitationList citations={msg.citations} />}
                  </div>
                )}
              </div>
            ))
          )}

          {sending && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-900 mb-2">VaultRAG Assistant</div>
              <div className="space-y-2 animate-pulse">
                <div className="h-3.5 bg-slate-200 rounded w-3/4" />
                <div className="h-3.5 bg-slate-200 rounded w-1/2" />
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed"
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="bg-white border-t border-slate-200 px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitQuestion(question);
          }}
          className="max-w-3xl mx-auto flex items-end gap-3"
        >
          <textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              authorizedDocs.length === 0
                ? 'Ask an Admin for document access to begin querying...'
                : 'Ask a question about your authorized PDF documents... (Enter to send)'
            }
            disabled={sending}
            className="flex-1 resize-none px-4 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={sending || !question.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 h-[42px]"
          >
            <span>Send</span>
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
