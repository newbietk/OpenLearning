"use client";

import { useEffect, useState, useCallback } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { showToast } from "@/components/toast";

interface AdminData {
  isAdmin: boolean;
  admins?: string[];
  stats?: {
    totalKbs: number;
    totalDocuments: number;
    totalNodes: number;
    totalEdges: number;
  };
}

interface PublicKb {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export default function AdminPage() {
  return (
    <ErrorBoundary>
      <AdminPanel />
    </ErrorBoundary>
  );
}

function AdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newAdminId, setNewAdminId] = useState("");
  const [kbs, setKbs] = useState<PublicKb[]>([]);
  const [showCreateKb, setShowCreateKb] = useState(false);
  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");

  const fetchAdmin = useCallback(async () => {
    try {
      const res = await fetch("/api/admin");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      showToast("加载管理员数据失败", "error");
    }
    setLoading(false);
  }, []);

  const fetchKbs = useCallback(async () => {
    try {
      const res = await fetch("/api/kb");
      const json = await res.json();
      if (json.success) setKbs(json.data.public);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchAdmin();
    fetchKbs();
  }, [fetchAdmin, fetchKbs]);

  const addAdmin = async () => {
    if (!newAdminId) return;
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalId: newAdminId }),
      });
      if (res.ok) {
        setNewAdminId("");
        showToast("管理员添加成功", "success");
        fetchAdmin();
      } else {
        const json = await res.json();
        showToast(json.error || "添加失败", "error");
      }
    } catch {
      showToast("添加失败", "error");
    }
  };

  const removeAdmin = async (externalId: string) => {
    if (!confirm(`确认移除管理员 ${externalId}？`)) return;
    try {
      await fetch(`/api/admin?externalId=${encodeURIComponent(externalId)}`, { method: "DELETE" });
      showToast("管理员已移除", "success");
      fetchAdmin();
    } catch {
      showToast("移除失败", "error");
    }
  };

  const createPublicKb = async () => {
    if (!kbName) return;
    try {
      const res = await fetch("/api/admin/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: kbName, description: kbDesc }),
      });
      if (res.ok) {
        setShowCreateKb(false);
        setKbName("");
        setKbDesc("");
        showToast("公共知识库创建成功", "success");
        fetchKbs();
      } else {
        const json = await res.json();
        showToast(json.error || "创建失败", "error");
      }
    } catch {
      showToast("创建失败", "error");
    }
  };

  const deletePublicKb = async (id: string) => {
    if (!confirm("确认删除？")) return;
    try {
      await fetch(`/api/admin/kb/${id}`, { method: "DELETE" });
      showToast("知识库已删除", "success");
      fetchKbs();
    } catch {
      showToast("删除失败", "error");
    }
  };

  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: 14 }}>加载中...</div>;

  if (!data?.isAdmin) {
    return (
      <div className="page-enter">
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>🔧 管理员</h1>
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>您没有管理员权限</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>🔧 管理员面板</h1>

      {/* Stats */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>平台统计</h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
        }}>
          <div className="stat-card">
            <div className="stat-icon blue">📚</div>
            <div>
              <div className="stat-value">{data.stats?.totalKbs ?? 0}</div>
              <div className="stat-label">知识库</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">📄</div>
            <div>
              <div className="stat-value">{data.stats?.totalDocuments ?? 0}</div>
              <div className="stat-label">文档</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon amber">🔗</div>
            <div>
              <div className="stat-value">{data.stats?.totalNodes ?? 0}</div>
              <div className="stat-label">图谱节点</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon cyan">↔️</div>
            <div>
              <div className="stat-value">{data.stats?.totalEdges ?? 0}</div>
              <div className="stat-label">图谱边</div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Admin list */}
        <section>
          <div className="card">
            <div className="card-header">
              <span className="card-title">👥 管理员列表</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                className="form-input"
                style={{ flex: 1 }}
                placeholder="输入 external ID..."
                value={newAdminId}
                onChange={(e) => setNewAdminId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAdmin()}
              />
              <button className="btn btn-primary" onClick={addAdmin}>添加</button>
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {(data.admins || []).map((a) => (
                <div
                  key={a}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border-light)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{a}</span>
                  <button
                    className="btn btn-sm"
                    style={{ color: "var(--danger)", background: "none", border: "none" }}
                    onClick={() => removeAdmin(a)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Public KB management */}
        <section>
          <div className="card">
            <div className="card-header">
              <span className="card-title">📚 公共知识库</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreateKb(true)}>
                + 新建
              </button>
            </div>

            {showCreateKb && (
              <div style={{ marginBottom: 16, padding: 12, background: "var(--bg)", borderRadius: "var(--radius)" }}>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <input
                    className="form-input"
                    placeholder="名称"
                    value={kbName}
                    onChange={(e) => setKbName(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <input
                    className="form-input"
                    placeholder="描述"
                    value={kbDesc}
                    onChange={(e) => setKbDesc(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={createPublicKb}>创建</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setShowCreateKb(false)}>取消</button>
                </div>
              </div>
            )}

            {kbs.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
                暂无公共知识库
              </div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {kbs.map((kb) => (
                  <div
                    key={kb.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border-light)",
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 500 }}>{kb.name}</span>
                      {kb.description && (
                        <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>
                          {kb.description}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn btn-sm"
                      style={{ color: "var(--danger)", background: "none", border: "none" }}
                      onClick={() => deletePublicKb(kb.id)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
