"use client";

import { useEffect, useState, useCallback } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { showToast } from "@/components/toast";

interface KbRecord {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  kbType: "public" | "private";
  createdAt: string;
}

export default function HomePage() {
  return (
    <ErrorBoundary>
      <KnowledgeBaseList />
    </ErrorBoundary>
  );
}

function KnowledgeBaseList() {
  const [ownKbs, setOwnKbs] = useState<KbRecord[]>([]);
  const [publicKbs, setPublicKbs] = useState<KbRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kbType, setKbType] = useState<"private" | "public">("private");

  const fetchKbs = useCallback(async () => {
    try {
      const res = await fetch("/api/kb");
      const json = await res.json();
      if (json.success) {
        setOwnKbs(json.data.own);
        setPublicKbs(json.data.public);
      }
    } catch {
      showToast("加载知识库失败", "error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKbs();
  }, [fetchKbs]);

  const createKb = async () => {
    if (!name) return;
    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, kbType }),
      });
      if (res.ok) {
        setShowCreate(false);
        setName("");
        setDescription("");
        showToast("知识库创建成功", "success");
        fetchKbs();
      } else {
        const json = await res.json();
        showToast(json.error || "创建失败", "error");
      }
    } catch {
      showToast("创建失败", "error");
    }
  };

  const deleteKb = async (id: string) => {
    if (!confirm("确认删除？")) return;
    try {
      const res = await fetch(`/api/kb/${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("知识库已删除", "success");
        fetchKbs();
      } else {
        const json = await res.json();
        showToast(json.error || "删除失败", "error");
      }
    } catch {
      showToast("删除失败", "error");
    }
  };

  if (loading) {
    return <div style={{ color: "var(--text-muted)", fontSize: 14 }}>加载中...</div>;
  }

  return (
    <div className="page-enter">
      <div className="welcome-banner">
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>知识库管理</h1>
        <p style={{ opacity: 0.9, fontSize: 14 }}>
          构建你的知识图谱，导入文档、链接，AI 驱动智能问答
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>📚 知识库</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + 新建知识库
        </button>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title">新建知识库</span>
          </div>
          <div className="form-group">
            <label className="form-label">名称</label>
            <input
              className="form-input"
              placeholder="输入知识库名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">描述（可选）</label>
            <input
              className="form-input"
              placeholder="简短描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">类型</label>
            <select
              className="form-select"
              value={kbType}
              onChange={(e) => setKbType(e.target.value as "private" | "public")}
            >
              <option value="private">私有</option>
              <option value="public">公共</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={createKb}>创建</button>
            <button className="btn btn-outline" onClick={() => setShowCreate(false)}>取消</button>
          </div>
        </div>
      )}

      {ownKbs.length === 0 && publicKbs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>暂无知识库，点击上方按钮创建第一个</div>
        </div>
      ) : (
        <>
          {ownKbs.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>
                我的知识库
              </h3>
              <div style={{ display: "grid", gap: 12 }}>
                {ownKbs.map((kb) => (
                  <KbCard key={kb.id} kb={kb} onDelete={deleteKb} />
                ))}
              </div>
            </section>
          )}

          {publicKbs.length > 0 && (
            <section>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>
                公共知识库
              </h3>
              <div style={{ display: "grid", gap: 12 }}>
                {publicKbs.map((kb) => (
                  <KbCard key={kb.id} kb={kb} onDelete={deleteKb} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return dateStr.slice(0, 10);
  return d.toLocaleDateString("zh-CN");
}

function KbCard({ kb, onDelete }: { kb: KbRecord; onDelete: (id: string) => void }) {
  return (
    <div className="card" style={{ padding: "14px 20px", transition: "all var(--transition)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <a
            href={`/kb/${kb.id}`}
            style={{ fontWeight: 600, fontSize: 14, color: "var(--primary)", textDecoration: "none" }}
          >
            {kb.name}
          </a>
          {kb.description && (
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{kb.description}</p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <span className={`tag ${kb.kbType === "public" ? "tag-info" : "tag-default"}`}>
              {kb.kbType === "public" ? "公共" : "私有"}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {formatDate(kb.createdAt)}
            </span>
          </div>
        </div>
        <button
          className="btn btn-sm"
          style={{ color: "var(--danger)", border: "none", background: "none", padding: "4px 8px" }}
          onClick={() => onDelete(kb.id)}
        >
          删除
        </button>
      </div>
    </div>
  );
}
