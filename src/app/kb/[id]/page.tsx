"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { ErrorBoundary } from "@/components/error-boundary";
import { GraphViewer } from "@/components/graph-viewer";
import { showToast } from "@/components/toast";
import type { DocumentRecord, GraphNodeRecord, GraphEdgeRecord, DocumentChunkRecord } from "@/core/pipeline/types";

type SourceType = "text" | "file" | "link" | "directory";

export default function KbDetailPage() {
  return (
    <ErrorBoundary>
      <KbDetail />
    </ErrorBoundary>
  );
}

function KbDetail() {
  const { id } = useParams<{ id: string }>();
  const [kb, setKb] = useState<{ id: string; name: string; description: string; kbType: string } | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [nodes, setNodes] = useState<GraphNodeRecord[]>([]);
  const [edges, setEdges] = useState<GraphEdgeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importType, setImportType] = useState<SourceType>("text");
  const [importMode, setImportMode] = useState<"single" | "batch">("single");
  const [importTitle, setImportTitle] = useState("");
  const [batchTitles, setBatchTitles] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importFilePath, setImportFilePath] = useState("");
  const [importDirPath, setImportDirPath] = useState("");

  // Tabs
  const [activeTab, setActiveTab] = useState<"documents" | "graph">("documents");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<unknown[] | null>(null);

  // Document viewing
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [docChunks, setDocChunks] = useState<DocumentChunkRecord[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  // Graph detail
  const [selectedNode, setSelectedNode] = useState<GraphNodeRecord | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeRecord | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [kbRes, docsRes, graphRes] = await Promise.all([
        fetch(`/api/kb/${id}`),
        fetch(`/api/kb/${id}/documents`),
        fetch(`/api/kb/${id}/graph`),
      ]);
      const kbJson = await kbRes.json();
      const docsJson = await docsRes.json();
      const graphJson = await graphRes.json();

      if (kbJson.success) setKb(kbJson.data);
      if (docsJson.success) setDocuments(docsJson.data);
      if (graphJson.success) {
        setNodes(graphJson.data.nodes);
        setEdges(graphJson.data.edges);
      }
    } catch {
      showToast("加载数据失败", "error");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const viewDocument = async (docId: string) => {
    if (expandedDocId === docId) { setExpandedDocId(null); setDocChunks([]); return; }
    setExpandedDocId(docId);
    setLoadingChunks(true);
    try {
      const res = await fetch(`/api/kb/${id}/documents?docId=${docId}`);
      const json = await res.json();
      if (json.success) setDocChunks(json.data.chunks || []);
    } catch { showToast("加载文档内容失败", "error"); }
    setLoadingChunks(false);
  };

  const deleteDocument = async (docId: string, title: string) => {
    if (!confirm(`确认删除「${title}」？`)) return;
    try {
      const res = await fetch(`/api/kb/${id}/documents?docId=${docId}`, { method: "DELETE" });
      if (res.ok) { showToast("文档已删除", "success"); fetchData(); }
      else { const json = await res.json(); showToast(json.error || "删除失败", "error"); }
    } catch { showToast("删除失败", "error"); }
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const titles = importMode === "batch"
        ? batchTitles.split("\n").map((t) => t.trim()).filter(Boolean)
        : [importTitle];

      if (titles.length === 0) { showToast("请输入标题", "error"); setImporting(false); return; }

      let successCount = 0;
      for (const title of titles) {
        const formData = new FormData();
        formData.set("title", title);
        formData.set("sourceType", importType === "directory" ? "directory" : importType);

        if (importType === "text" && importContent) formData.set("content", importContent);
        if (importType === "link" && importUrl) formData.set("sourceUrl", importUrl);
        if (importType === "file" && importFilePath) formData.set("filePath", importFilePath);
        if (importType === "directory" && importDirPath) formData.set("dirPath", importDirPath);

        const res = await fetch(`/api/kb/${id}/documents`, { method: "POST", body: formData });
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) successCount += json.data.length;
          else successCount++;
        } else {
          const json = await res.json();
          showToast(`${title}: ${json.error || "导入失败"}`, "error");
        }
      }

      if (successCount > 0) {
        showToast(`成功导入 ${successCount} 个文档`, "success");
        setImportTitle(""); setBatchTitles(""); setImportContent("");
        setImportUrl(""); setImportFilePath(""); setImportDirPath("");
        fetchData();
      }
    } catch { showToast("导入失败", "error"); }
    setImporting(false);
  };

  const doSearch = async () => {
    if (!searchQuery) return;
    try {
      const res = await fetch(`/api/kb/${id}/search?q=${encodeURIComponent(searchQuery)}`);
      const json = await res.json();
      if (json.success) setSearchResults(json.data);
      else showToast(json.error || "搜索失败", "error");
    } catch { showToast("搜索失败", "error"); }
  };

  const sourceTypes: { key: SourceType; label: string; icon: string }[] = [
    { key: "text", label: "文本", icon: "📝" },
    { key: "file", label: "文件", icon: "📂" },
    { key: "link", label: "链接", icon: "🔗" },
    { key: "directory", label: "目录", icon: "📁" },
  ];

  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: 14 }}>加载中...</div>;
  if (!kb) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
        <div style={{ fontSize: 14, color: "var(--danger)" }}>知识库未找到</div>
        <a href="/" className="btn btn-outline" style={{ marginTop: 16, display: "inline-flex" }}>&larr; 返回列表</a>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 24 }}>
        <a href="/" style={{ fontSize: 13, color: "var(--primary)", textDecoration: "none", marginBottom: 8, display: "inline-block" }}>
          &larr; 返回知识库列表
        </a>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{kb.name}</h1>
        {kb.description && <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>{kb.description}</p>}
        <span className={`tag ${kb.kbType === "public" ? "tag-info" : "tag-default"}`} style={{ marginTop: 8 }}>
          {kb.kbType === "public" ? "公共" : "私有"}
        </span>
      </div>

      {/* Import */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">📥 导入文档</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {sourceTypes.map((st) => (
            <button key={st.key}
              className={`btn btn-sm ${importType === st.key ? "btn-primary" : "btn-outline"}`}
              onClick={() => setImportType(st.key)}>
              {st.icon} {st.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button className={`btn btn-sm ${importMode === "single" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setImportMode("single")}>单个</button>
          <button className={`btn btn-sm ${importMode === "batch" ? "btn-primary" : "btn-outline"}`}
            onClick={() => setImportMode("batch")}>批量</button>
        </div>

        {importMode === "batch" ? (
          <div className="form-group">
            <label className="form-label">文档标题（一行一个）</label>
            <textarea className="form-textarea" rows={5}
              placeholder="JavaScript 基础&#10;TypeScript 类型系统&#10;Node.js 入门"
              value={batchTitles} onChange={(e) => setBatchTitles(e.target.value)} />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">文档标题</label>
            <input className="form-input" placeholder="输入标题"
              value={importTitle} onChange={(e) => setImportTitle(e.target.value)} />
          </div>
        )}

        {importType === "text" && (
          <div className="form-group">
            <label className="form-label">内容</label>
            <textarea className="form-textarea" rows={8} placeholder="输入文本内容..."
              value={importContent} onChange={(e) => setImportContent(e.target.value)} />
          </div>
        )}
        {importType === "file" && (
          <div className="form-group">
            <label className="form-label">文件路径</label>
            <input className="form-input" placeholder="D:\docs\article.md"
              value={importFilePath} onChange={(e) => setImportFilePath(e.target.value)} />
          </div>
        )}
        {importType === "link" && (
          <div className="form-group">
            <label className="form-label">URL 地址</label>
            <input className="form-input" placeholder="https://example.com/article"
              value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
          </div>
        )}
        {importType === "directory" && (
          <div className="form-group">
            <label className="form-label">目录路径</label>
            <input className="form-input" placeholder="D:\docs\articles\"
              value={importDirPath} onChange={(e) => setImportDirPath(e.target.value)} />
          </div>
        )}

        <button className="btn btn-primary" disabled={importing} onClick={doImport}>
          {importing ? "导入中..." : (importMode === "batch" ? "批量导入" : "导入")}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => { setActiveTab("documents"); setSelectedNode(null); setSelectedEdge(null); }}
          style={{ padding: "8px 16px", fontSize: 14, fontWeight: activeTab === "documents" ? 600 : 400,
            color: activeTab === "documents" ? "var(--primary)" : "var(--text-secondary)",
            borderBottom: activeTab === "documents" ? "2px solid var(--primary)" : "2px solid transparent",
            background: "none", borderTop: "none", borderLeft: "none", borderRight: "none", cursor: "pointer", fontFamily: "inherit" }}>
          📄 文档 ({documents.length})
        </button>
        <button onClick={() => setActiveTab("graph")}
          style={{ padding: "8px 16px", fontSize: 14, fontWeight: activeTab === "graph" ? 600 : 400,
            color: activeTab === "graph" ? "var(--primary)" : "var(--text-secondary)",
            borderBottom: activeTab === "graph" ? "2px solid var(--primary)" : "2px solid transparent",
            background: "none", borderTop: "none", borderLeft: "none", borderRight: "none", cursor: "pointer", fontFamily: "inherit" }}>
          🔗 知识图谱 ({nodes.length} 节点, {edges.length} 边)
        </button>
      </div>

      {activeTab === "documents" ? (
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input className="form-input" style={{ flex: 1 }} placeholder="搜索知识..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()} />
              <button className="btn btn-outline" onClick={doSearch}>搜索</button>
            </div>

            {searchResults ? (
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{searchResults.length} 个结果</span>
                  <button className="btn btn-sm btn-outline" onClick={() => setSearchResults(null)}>清除</button>
                </div>
                <pre style={{ background: "var(--bg)", padding: 12, borderRadius: "var(--radius)", fontSize: 12, overflow: "auto", maxHeight: 400, fontFamily: '"Fira Code", Consolas, monospace' }}>
                  {JSON.stringify(searchResults, null, 2)}
                </pre>
              </div>
            ) : documents.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>暂无文档，导入文本或链接开始构建知识库</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {documents.map((doc) => (
                  <div key={doc.id}>
                    <div className="card" style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 500, fontSize: 14, cursor: "pointer" }}
                          onClick={() => viewDocument(doc.id)}>
                          {expandedDocId === doc.id ? "▾ " : "▸ "}{doc.title}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`tag ${doc.status === "done" ? "tag-success" :
                            doc.status === "failed" ? "tag-danger" :
                            doc.status === "parsing" ? "tag-warning" : "tag-default"}`}>
                            {doc.status === "done" ? "已完成" : doc.status === "failed" ? "失败" :
                             doc.status === "parsing" ? "解析中" : doc.status}
                          </span>
                          <button className="btn btn-sm" style={{ color: "var(--danger)", background: "none", border: "none" }}
                            onClick={() => deleteDocument(doc.id, doc.title)}>删除</button>
                        </div>
                      </div>
                      {doc.errorMessage && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>{doc.errorMessage}</p>}
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        {doc.sourceType}{doc.sourceUrl ? ` · ${doc.sourceUrl}` : ""}{doc.filePath ? ` · ${doc.filePath}` : ""}
                      </p>
                    </div>
                    {expandedDocId === doc.id && (
                      <div key={`expanded-${doc.id}`} className="card" style={{ padding: "12px 16px", marginTop: 4, background: "var(--bg)" }}>
                        {loadingChunks ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>加载中...</span>
                        : docChunks.length === 0 ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>无解析内容</span>
                        : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {docChunks.map((chunk) => (
                              <div key={chunk.id} style={{ fontSize: 12, lineHeight: 1.6, padding: "8px 12px",
                                background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border-light)" }}>
                                <div style={{ color: "var(--text)" }}>{chunk.contentText}</div>
                                <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 4 }}>tokens: {chunk.tokenCount}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ width: 280, flexShrink: 0 }}>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📊 统计</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "grid", gap: 4 }}>
                <div>文档: <strong>{documents.length}</strong></div>
                <div>节点: <strong>{nodes.length}</strong></div>
                <div>边: <strong>{edges.length}</strong></div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1 }}>
            {nodes.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔗</div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>导入文档后构建知识图谱</div>
              </div>
            ) : (
              <GraphViewer nodes={nodes} edges={edges}
                onNodeClick={(n) => setSelectedNode(n)}
                onEdgeClick={(e) => setSelectedEdge(e)} />
            )}
          </div>
          <div style={{ width: 280, flexShrink: 0 }}>
            {(selectedNode || selectedEdge) ? (
              <div className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {selectedNode ? "🔵 节点详情" : "↔️ 边详情"}
                  </span>
                  <button className="btn btn-sm btn-outline"
                    onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}>关闭</button>
                </div>
                {selectedNode && (
                  <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                    <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>标签</div><div style={{ fontWeight: 500 }}>{selectedNode.label}</div></div>
                    <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>类型</div><span className="tag tag-info">{selectedNode.nodeType}</span></div>
                    {selectedNode.sourceDocId && <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>来源文档</div><div>{selectedNode.sourceDocId}</div></div>}
                    {Object.keys(selectedNode.metadata).length > 0 && (
                      <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>元数据</div>
                        <pre style={{ fontSize: 10, background: "var(--bg)", padding: 8, borderRadius: "var(--radius)", overflow: "auto", maxHeight: 200 }}>
                          {JSON.stringify(selectedNode.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
                {selectedEdge && (
                  <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                    <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>关系</div><div style={{ fontWeight: 500 }}>{selectedEdge.relation}</div></div>
                    <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>置信度</div><div>{(selectedEdge.confidence * 100).toFixed(0)}%</div></div>
                    <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>源节点</div><div style={{ fontSize: 11 }}>{selectedEdge.sourceNodeId}</div></div>
                    <div><div style={{ color: "var(--text-muted)", marginBottom: 2 }}>目标节点</div><div style={{ fontSize: 11 }}>{selectedEdge.targetNodeId}</div></div>
                  </div>
                )}
              </div>
            ) : (
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📊 图谱统计</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "grid", gap: 4 }}>
                  <div>节点: <strong>{nodes.length}</strong></div>
                  <div>边: <strong>{edges.length}</strong></div>
                </div>
                {nodes.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>节点类型</div>
                    {[...new Set(nodes.map((n) => n.nodeType))].map((t) => (
                      <div key={t} style={{ fontSize: 11, padding: "2px 0", color: "var(--text-secondary)" }}>
                        {t}: {nodes.filter((n) => n.nodeType === t).length}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
