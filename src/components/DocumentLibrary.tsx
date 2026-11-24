import React, { useMemo, useState } from 'react';
import {
  Download,
  Eye,
  FileText,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import type { DocumentChunkView, DocumentItem, User } from '../types';

interface DocumentLibraryProps {
  user: User;
  documents: DocumentItem[];
  onRefreshDocuments: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DocumentLibrary({
  user,
  documents,
  onRefreshDocuments,
}: DocumentLibraryProps) {
  const isAdmin = user.role === 'admin';

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [department, setDepartment] = useState('Human Resources');
  const [description, setDescription] = useState('');
  const [grantToAllUsers, setGrantToAllUsers] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');

  // Inspector & actions state
  const [inspectingDoc, setInspectingDoc] = useState<DocumentItem | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkView[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const departments = useMemo(() => {
    const set = new Set(documents.map((d) => d.department));
    return ['All', ...Array.from(set).sort()];
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (departmentFilter !== 'All' && doc.department !== departmentFilter) return false;
      if (!q) return true;
      return (
        doc.originalName.toLowerCase().includes(q) ||
        doc.department.toLowerCase().includes(q) ||
        doc.description.toLowerCase().includes(q)
      );
    });
  }, [documents, searchQuery, departmentFilter]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('Please choose a PDF file first.');
      return;
    }
    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('department', department);
      formData.append('description', description);
      formData.append('grantToAllUsers', String(grantToAllUsers));

      const res = await api.uploadDocument(formData);
      setUploadSuccess(
        `Indexed "${res.document.originalName}" (${res.document.pageCount} pages, ${res.document.chunkCount} chunks).`,
      );
      setSelectedFile(null);
      setDescription('');
      await onRefreshDocuments();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'PDF upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleInspect = async (doc: DocumentItem) => {
    setActionError(null);
    setInspectingDoc(doc);
    setLoadingChunks(true);
    try {
      const res = await api.getDocumentChunks(doc.id);
      setChunks(res.chunks);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load chunks.');
    } finally {
      setLoadingChunks(false);
    }
  };

  const handleReindex = async (docId: string) => {
    setActionError(null);
    setBusyDocId(docId);
    try {
      await api.reindexDocument(docId);
      await onRefreshDocuments();
      if (inspectingDoc?.id === docId) {
        const res = await api.getDocumentChunks(docId);
        setInspectingDoc(res.document);
        setChunks(res.chunks);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to generate embeddings.');
    } finally {
      setBusyDocId(null);
    }
  };

  const handleDelete = async (docId: string) => {
    setActionError(null);
    setBusyDocId(docId);
    try {
      await api.deleteDocument(docId);
      setConfirmDeleteId(null);
      if (inspectingDoc?.id === docId) {
        setInspectingDoc(null);
        setChunks([]);
      }
      await onRefreshDocuments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete document.');
    } finally {
      setBusyDocId(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Admin PDF Upload Panel */}
      {isAdmin ? (
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Upload &amp; Index PDF Document
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                PDFs are parsed page-by-page, split into 750-character overlapping chunks, and
                indexed for permission-gated retrieval.
              </p>
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              Max 15 MB · Text-based PDF
            </span>
          </div>

          {uploadError && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
            >
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {uploadSuccess}
            </div>
          )}

          <form onSubmit={handleUpload} className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                PDF File
              </label>
              <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 border border-dashed border-slate-300 hover:border-blue-500 rounded-lg cursor-pointer transition-colors">
                <span className="text-xs text-slate-700 truncate">
                  {selectedFile ? selectedFile.name : 'Choose a .pdf file...'}
                </span>
                <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="upload-dept"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Department
              </label>
              <select
                id="upload-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="Human Resources">Human Resources</option>
                <option value="Finance">Finance</option>
                <option value="IT Security">IT Security</option>
                <option value="Legal">Legal</option>
                <option value="Engineering">Engineering</option>
                <option value="Operations">Operations</option>
              </select>
            </div>

            <div className="md:col-span-4">
              <label
                htmlFor="upload-desc"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Summary Note
              </label>
              <input
                id="upload-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Q4 travel & expense guidelines"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={grantToAllUsers}
                  onChange={(e) => setGrantToAllUsers(e.target.checked)}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>Grant read access to all existing employee accounts immediately</span>
              </label>

              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploading ? 'Extracting & Indexing...' : 'Upload & Index PDF'}</span>
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Your Authorized Documents
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              You have read-only access to the documents listed below. Only Administrators can
              upload, delete, or modify document permissions.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
            {documents.length} authorized
          </span>
        </section>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter documents by name or department..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {departments.map((dept) => (
            <button
              key={dept}
              type="button"
              onClick={() => setDepartmentFilter(dept)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                departmentFilter === dept
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
        >
          {actionError}
        </div>
      )}

      {/* Document Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredDocs.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-900">No matching documents found</p>
            <p className="text-xs text-slate-500 mt-1">
              {documents.length === 0
                ? 'No documents are currently assigned to your account.'
                : 'Try clearing your search or department filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Document</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4 text-right">Pages</th>
                  <th className="py-3 px-4 text-right">Chunks</th>
                  <th className="py-3 px-4">Vector Index</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 max-w-xs">
                      <div className="flex items-start gap-2.5">
                        <FileText className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {doc.originalName}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {doc.description}
                          </div>
                          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                            {formatBytes(doc.fileSizeBytes)} · {doc.uploadedBy}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {doc.department}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 text-right font-mono tabular-nums">
                      {doc.pageCount}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 text-right font-mono tabular-nums">
                      {doc.chunkCount}
                    </td>
                    <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                      <span
                        className={
                          doc.embeddingProvider === 'gemini-embedding-2'
                            ? 'text-emerald-700 font-medium'
                            : 'text-slate-600'
                        }
                      >
                        {doc.embeddingProvider === 'gemini-embedding-2'
                          ? 'Gemini Dense + Lexical'
                          : 'Lexical Indexed'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleInspect(doc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
                          title="Inspect extracted pages and chunks"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Chunks</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => api.downloadDocument(doc.id, doc.originalName)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
                          title="Download PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>

                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              disabled={busyDocId === doc.id}
                              onClick={() => handleReindex(doc.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-md transition-colors"
                              title="Generate dense embeddings via Gemini Embedding 2"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  busyDocId === doc.id ? 'animate-spin' : ''
                                }`}
                              />
                              <span>Embed</span>
                            </button>

                            {confirmDeleteId === doc.id ? (
                              <div className="inline-flex items-center gap-1 ml-1">
                                <button
                                  type="button"
                                  disabled={busyDocId === doc.id}
                                  onClick={() => handleDelete(doc.id)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(doc.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                title="Delete document"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Chunk & Page Inspector Panel */}
      {inspectingDoc && (
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Chunk Inspector · {inspectingDoc.originalName}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                {inspectingDoc.department} · {inspectingDoc.pageCount} pages · {chunks.length}{' '}
                indexed chunks
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setInspectingDoc(null);
                setChunks([]);
              }}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              aria-label="Close chunk inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {loadingChunks ? (
            <div className="py-6 text-xs text-slate-500">Loading extracted chunks...</div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="p-3.5 rounded-lg bg-slate-50 border border-slate-200"
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5 text-xs text-slate-500 font-mono tabular-nums">
                    <span>
                      Chunk #{chunk.chunkIndex + 1} · Page {chunk.pageNumber}
                    </span>
                    <span>
                      {chunk.hasDenseVector
                        ? `Dense vector (${chunk.vectorDimensions} dims)`
                        : 'Lexical term vector'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-800 leading-relaxed">{chunk.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
