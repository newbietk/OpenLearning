"use client";

import { useEffect, useState, useCallback } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { showToast } from "@/components/toast";

interface Provider {
  id: string;
  externalUserId: string;
  provider: string;
  baseUrl: string | null;
  enabled: boolean;
  hasKey: boolean;
  createdAt: string;
}

export default function LlmConfigPage() {
  return (
    <ErrorBoundary>
      <LlmConfig />
    </ErrorBoundary>
  );
}

function LlmConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/llm-config");
      const json = await res.json();
      if (json.success) setProviders(json.data);
    } catch {
      showToast("加载配置失败", "error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const addProvider = async () => {
    if (!apiKey) return;
    setSaving(true);
    try {
      const res = await fetch("/api/llm-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey, baseUrl: baseUrl || null }),
      });
      if (res.ok) {
        setShowAdd(false);
        setApiKey("");
        setBaseUrl("");
        showToast("Provider 添加成功", "success");
        fetchProviders();
      } else {
        const json = await res.json();
        showToast(json.error || "添加失败", "error");
      }
    } catch {
      showToast("添加失败", "error");
    }
    setSaving(false);
  };

  const deleteProvider = async (id: string) => {
    if (!confirm("确认删除？")) return;
    try {
      await fetch(`/api/llm-config/${id}`, { method: "DELETE" });
      showToast("Provider 已删除", "success");
      fetchProviders();
    } catch {
      showToast("删除失败", "error");
    }
  };

  const toggleEnabled = async (p: Provider) => {
    try {
      await fetch(`/api/llm-config/${p.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      showToast(p.enabled ? "已禁用" : "已启用", "success");
      fetchProviders();
    } catch {
      showToast("操作失败", "error");
    }
  };

  if (loading) return <div style={{ color: "var(--text-muted)", fontSize: 14 }}>加载中...</div>;

  const providerLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
  };

  return (
    <div className="page-enter">
      <div className="welcome-banner" style={{ padding: "20px 28px" }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>⚙️ LLM 配置</h1>
        <p style={{ opacity: 0.9, fontSize: 13 }}>
          配置您的 LLM API Key，用于 AI 知识问答。API Key 使用 AES-256-GCM 加密存储。
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>已配置的 Provider</h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + 添加 Provider
        </button>
      </div>

      {showAdd && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title">添加 Provider</span>
          </div>
          <div className="form-group">
            <label className="form-label">Provider</label>
            <select
              className="form-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              className="form-input"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Base URL（可选）</label>
            <input
              className="form-input"
              placeholder="https://api.openai.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={addProvider} disabled={saving || !apiKey}>
              {saving ? "保存中..." : "保存"}
            </button>
            <button className="btn btn-outline" onClick={() => setShowAdd(false)}>取消</button>
          </div>
        </div>
      )}

      {providers.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔑</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>暂无配置的 LLM Provider</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {providers.map((p) => (
            <div key={p.id} className="card" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {providerLabels[p.provider] || p.provider}
                    </span>
                    <span className={`tag ${p.enabled ? "tag-success" : "tag-default"}`}>
                      {p.enabled ? "已启用" : "已禁用"}
                    </span>
                  </div>
                  {p.baseUrl && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{p.baseUrl}</p>
                  )}
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    API Key: {p.hasKey ? "已配置" : "未配置"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    className={`toggle-switch${p.enabled ? " on" : ""}`}
                    onClick={() => toggleEnabled(p)}
                    aria-label={p.enabled ? "禁用" : "启用"}
                  />
                  <button
                    className="btn btn-sm"
                    style={{ color: "var(--danger)", background: "none", border: "none" }}
                    onClick={() => deleteProvider(p.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
