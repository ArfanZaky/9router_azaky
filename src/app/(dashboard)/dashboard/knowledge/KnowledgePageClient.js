"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, Plus, Search, Trash2, RefreshCw, Upload, FileText,
  Database, ChevronRight, X, AlertCircle, Sparkles, Layers, ArrowLeft
} from "lucide-react";
import ModelSelectModal from "@/shared/components/ModelSelectModal";

export default function KnowledgePageClient() {
  const [bases, setBases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBase, setSelectedBase] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseDesc, setNewBaseDesc] = useState("");
  const [newBaseModel, setNewBaseModel] = useState("text-embedding-3-small");
  const [showModelModal, setShowModelModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadBases = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/knowledge");
      const data = await res.json();
      if (Array.isArray(data)) {
        setBases(data);
      }
    } catch (err) {
      console.error("Failed to load knowledge bases:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBases();
  }, [loadBases]);

  const handleCreateBase = async (e) => {
    e.preventDefault();
    if (!newBaseName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBaseName.trim(),
          description: newBaseDesc.trim(),
          embeddingModel: newBaseModel,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.id) {
        setShowCreateModal(false);
        setNewBaseName("");
        setNewBaseDesc("");
        loadBases();
        setSelectedBase(data);
      } else {
        setError(data.error || "Failed to create knowledge base");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBase = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this knowledge base and all its documents?")) return;
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok !== false) {
        if (selectedBase?.id === id) setSelectedBase(null);
        loadBases();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const filteredBases = bases.filter((b) =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.description && b.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-800/80 bg-slate-900/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {selectedBase && (
            <button
              onClick={() => setSelectedBase(null)}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
              title="Back to all Knowledge Bases"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">
              {selectedBase ? selectedBase.name : "Knowledge Base & RAG Vault"}
            </h1>
            <p className="text-xs text-slate-400">
              {selectedBase
                ? selectedBase.description || "Manage documents and perform semantic retrieval tests"
                : "Upload documents, build custom vector knowledge bases, and connect to AI chat"}
            </p>
          </div>
        </div>

        {!selectedBase && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow-lg shadow-violet-600/20 transition"
            >
              <Plus className="w-4 h-4" />
              New Knowledge Base
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedBase ? (
          <KnowledgeBaseDetail
            base={selectedBase}
            onUpdate={loadBases}
            onBack={() => setSelectedBase(null)}
          />
        ) : (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Search Bar */}
            <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5 max-w-md">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search knowledge bases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-500 flex-1"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-slate-500 hover:text-slate-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Grid List */}
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-44 rounded-2xl bg-slate-900/40 border border-slate-800/60 animate-pulse" />
                ))}
              </div>
            ) : filteredBases.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
                <Database className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No Knowledge Bases Found</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                  Create your first knowledge base to upload documents and enable semantic RAG chat.
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition"
                >
                  <Plus className="w-4 h-4" />
                  Create Knowledge Base
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBases.map((base) => (
                  <div
                    key={base.id}
                    onClick={() => setSelectedBase(base)}
                    className="group relative bg-slate-900/50 hover:bg-slate-900/80 border border-slate-800 hover:border-violet-500/40 rounded-2xl p-5 cursor-pointer transition-all duration-200 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400">
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white group-hover:text-violet-300 transition">
                              {base.name}
                            </h3>
                            <span className="text-[10px] text-slate-500 font-mono">ID: {base.id}</span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteBase(base.id, e)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2 mb-4">
                        {base.description || "No description provided."}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 text-slate-500" />
                          {base.docCount || 0} docs
                        </span>
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-slate-500" />
                          {base.chunkCount || 0} chunks
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-violet-400 font-medium">
                        Explore
                        <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Create Knowledge Base */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-violet-400" />
                Create New Knowledge Base
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBase} className="p-5 space-y-4">
              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Knowledge Base Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Product Documentation / Research Notes"
                  value={newBaseName}
                  onChange={(e) => setNewBaseName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Description (Optional)</label>
                <textarea
                  rows={3}
                  placeholder="Briefly describe what documents are stored in this knowledge base..."
                  value={newBaseDesc}
                  onChange={(e) => setNewBaseDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500 outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Embedding Model</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newBaseModel}
                    onChange={(e) => setNewBaseModel(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-violet-300 focus:border-violet-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowModelModal(true)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
                  >
                    Select
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Default: text-embedding-3-small (supports OpenAI, Gemini, Voyage, Mistral embeddings)
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {creating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Model Select Modal for Embedding */}
      {showModelModal && (
        <ModelSelectModal
          isOpen={showModelModal}
          onClose={() => setShowModelModal(false)}
          onSelect={(modelId) => {
            setNewBaseModel(modelId);
            setShowModelModal(false);
          }}
          currentModel={newBaseModel}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------
// Detail View for a Single Knowledge Base
// ----------------------------------------------------
function KnowledgeBaseDetail({ base, onUpdate, onBack }) {
  const [activeTab, setActiveTab] = useState("documents");
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [showAddDocModal, setShowAddDocModal] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      setLoadingDocs(true);
      const res = await fetch(`/api/knowledge/${base.id}/documents`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setDocs(data);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoadingDocs(false);
    }
  }, [base.id]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Banner / Summary */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">{base.name}</h2>
            <span className="px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-mono">
              {base.embeddingModel || "text-embedding-3-small"}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            {base.description || "No description provided."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddDocModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow-lg shadow-violet-600/20 transition"
          >
            <Upload className="w-3.5 h-3.5" />
            Add Documents
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800">
        <button
          onClick={() => setActiveTab("documents")}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition flex items-center gap-2 ${
            activeTab === "documents"
              ? "border-violet-500 text-violet-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="w-4 h-4" />
          Documents ({docs.length})
        </button>
        <button
          onClick={() => setActiveTab("test_rag")}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition flex items-center gap-2 ${
            activeTab === "test_rag"
              ? "border-violet-500 text-violet-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Semantic Search & RAG Test
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === "documents" && (
        <DocumentsList
          baseId={base.id}
          docs={docs}
          loading={loadingDocs}
          onRefresh={loadDocuments}
        />
      )}

      {activeTab === "test_rag" && (
        <RagTestPanel baseId={base.id} />
      )}

      {/* Add Document Modal */}
      {showAddDocModal && (
        <AddDocumentModal
          baseId={base.id}
          onClose={() => setShowAddDocModal(false)}
          onSuccess={() => {
            setShowAddDocModal(false);
            loadDocuments();
            if (onUpdate) onUpdate();
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------
// Documents List Table
// ----------------------------------------------------
function DocumentsList({ baseId, docs, loading, onRefresh }) {
  const handleDeleteDoc = async (docId) => {
    if (!confirm("Are you sure you want to delete this document and its chunk vectors?")) return;
    try {
      const res = await fetch(`/api/knowledge/documents/${docId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok !== false) {
        onRefresh();
      }
    } catch (err) {
      console.error("Delete document failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-16 rounded-xl bg-slate-900/40 border border-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
        <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
        <h4 className="text-xs font-semibold text-slate-300">No Documents Uploaded</h4>
        <p className="text-[11px] text-slate-500 mt-1">
          Upload TXT, MD, PDF, CSV files or paste raw text/URLs to index knowledge.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="px-4 py-3 font-medium">Name / Title</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Chunks</th>
            <th className="px-4 py-3 font-medium">Size</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {docs.map((doc) => (
            <tr key={doc.id} className="hover:bg-slate-800/30 transition">
              <td className="px-4 py-3 font-medium text-white max-w-xs truncate">
                {doc.name}
              </td>
              <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                {doc.type || "text"}
              </td>
              <td className="px-4 py-3 text-slate-300">
                {doc.chunkCount || 0}
              </td>
              <td className="px-4 py-3 text-slate-400">
                {doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : "-"}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    doc.status === "ready"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : doc.status === "error"
                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}
                >
                  {doc.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-500 text-[11px]">
                {new Date(doc.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => handleDeleteDoc(doc.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                  title="Delete Document"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------
// Semantic Search & RAG Test Panel
// ----------------------------------------------------
function RagTestPanel({ baseId }) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [threshold, setThreshold] = useState(0.2);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/knowledge/${baseId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          topK: Number(topK),
          threshold: Number(threshold),
        }),
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
      }
    } catch (err) {
      console.error("Semantic search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search Input Card */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <form onSubmit={handleSearch} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Semantic Search Query / Question
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                placeholder="Ask a question or enter keywords to retrieve relevant chunks..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:border-violet-500 outline-none"
              />
              <button
                type="submit"
                disabled={searching}
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition disabled:opacity-50 flex items-center gap-2"
              >
                {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Retrieve
              </button>
            </div>
          </div>

          <div className="flex items-center gap-6 pt-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span>Top K:</span>
              <select
                value={topK}
                onChange={(e) => setTopK(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-white outline-none"
              >
                <option value={3}>3 chunks</option>
                <option value={5}>5 chunks</option>
                <option value={10}>10 chunks</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span>Min Relevance Score:</span>
              <select
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-white outline-none"
              >
                <option value={0.1}>0.10 (Loose)</option>
                <option value={0.2}>0.20 (Balanced)</option>
                <option value={0.4}>0.40 (Strict)</option>
              </select>
            </div>
          </div>
        </form>
      </div>

      {/* Results List */}
      {results !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>Retrieved {results.length} relevant chunk(s)</span>
          </div>

          {results.length === 0 ? (
            <div className="text-center py-10 border border-slate-800 rounded-2xl bg-slate-900/30 text-xs text-slate-500">
              No matching chunks found above score threshold ({threshold}). Try a broader query or lower the threshold.
            </div>
          ) : (
            results.map((r, idx) => (
              <div
                key={idx}
                className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-2 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-violet-300">Chunk #{idx + 1}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-slate-400 truncate max-w-xs">{r.docName || r.docId}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 font-mono text-[10px] font-semibold">
                    Score: {(r.score * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="text-xs text-slate-300 font-sans leading-relaxed whitespace-pre-wrap bg-slate-950/60 p-3 rounded-lg border border-slate-800/40">
                  {r.content}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// Modal Add Document (File / Text)
// ----------------------------------------------------
function AddDocumentModal({ baseId, onClose, onSuccess }) {
  const [inputType, setInputType] = useState("file");
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let res;
      if (inputType === "file") {
        if (!file) {
          setError("Please select a file to upload");
          setLoading(false);
          return;
        }
        const formData = new FormData();
        formData.append("file", file);
        if (title) formData.append("name", title);
        res = await fetch(`/api/knowledge/${baseId}/documents`, {
          method: "POST",
          body: formData,
        });
      } else {
        if (!rawText.trim()) {
          setError("Document content cannot be empty");
          setLoading(false);
          return;
        }
        res = await fetch(`/api/knowledge/${baseId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: title.trim() || "Untitled Document",
            content: rawText.trim(),
            type: "text",
          }),
        });
      }

      const data = await res.json();
      if (res.ok && data?.id) {
        onSuccess();
      } else {
        setError(data.error || "Failed to index document");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-violet-400" />
            Add Documents to Knowledge Base
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Selector Type */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setInputType("file")}
              className={`py-1.5 text-xs font-medium rounded-lg transition ${
                inputType === "file" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Upload File (TXT/MD/JSON/CSV)
            </button>
            <button
              type="button"
              onClick={() => setInputType("text")}
              className={`py-1.5 text-xs font-medium rounded-lg transition ${
                inputType === "text" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Paste Raw Text
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Document Title</label>
            <input
              type="text"
              placeholder="e.g. API Documentation v2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500 outline-none"
            />
          </div>

          {inputType === "file" ? (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Select File</label>
              <input
                type="file"
                accept=".txt,.md,.json,.csv,.js,.py,.ts,.html,.yaml,.yml"
                onChange={handleFileChange}
                className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-violet-600 file:text-white hover:file:bg-violet-500 cursor-pointer bg-slate-950 border border-slate-800 rounded-xl p-2"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Content / Text</label>
              <textarea
                rows={6}
                required
                placeholder="Paste text, guidelines, product notes, or articles here..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-violet-500 outline-none resize-none font-mono"
              />
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Document will be automatically chunked (~512 chars with overlap) and embedded in the background.
          </p>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Index Document
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
