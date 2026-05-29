"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { showToast } from "@/components/toast";

interface Session {
  id: string;
  kbId: string;
  externalUserId: string;
  title: string;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: string | null;
  createdAt: string;
}

interface KbRecord {
  id: string;
  name: string;
}

type AgentEvent =
  | { type: "thinking"; content?: string }
  | { type: "tool_call"; toolCall?: unknown }
  | { type: "tool_result"; toolResult?: unknown }
  | { type: "response"; content?: string }
  | { type: "error"; error?: string }
  | { type: "done" };

export default function ChatPage() {
  return (
    <ErrorBoundary>
      <ChatInterface />
    </ErrorBoundary>
  );
}

function ChatInterface() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [kbs, setKbs] = useState<KbRecord[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatKbId, setNewChatKbId] = useState("");
  const [newChatTitle, setNewChatTitle] = useState("");
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat");
      const json = await res.json();
      if (json.success) setSessions(json.data);
    } catch {
      showToast("加载会话失败", "error");
    }
    setSessionsLoading(false);
  }, []);

  const fetchKbs = useCallback(async () => {
    try {
      const res = await fetch("/api/kb");
      const json = await res.json();
      if (json.success) setKbs([...json.data.own, ...json.data.public]);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchKbs();
  }, [fetchSessions, fetchKbs]);

  const fetchMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat/${sessionId}`);
      const json = await res.json();
      if (json.success) setMessages(json.data.messages);
    } catch {
      showToast("加载消息失败", "error");
    }
  }, []);

  useEffect(() => {
    if (activeSessionId) fetchMessages(activeSessionId);
  }, [activeSessionId, fetchMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const createSession = async () => {
    if (!newChatKbId) return;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kbId: newChatKbId, title: newChatTitle || "New Chat" }),
      });
      const json = await res.json();
      if (json.success) {
        setActiveSessionId(json.data.id);
        setShowNewChat(false);
        setNewChatTitle("");
        showToast("会话创建成功", "success");
        fetchSessions();
      } else {
        showToast(json.error || "创建失败", "error");
      }
    } catch {
      showToast("创建失败", "error");
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeSessionId || streaming) return;

    const userMsg = input;
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        sessionId: activeSessionId,
        role: "user",
        content: userMsg,
        toolCalls: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(`/api/chat/${activeSessionId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: userMsg }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));
            if (event.type === "response" && event.content) {
              assistantContent += event.content;
              setStreamingContent(assistantContent);
            }
            if (event.type === "done") {
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  sessionId: activeSessionId,
                  role: "assistant",
                  content: assistantContent,
                  toolCalls: null,
                  createdAt: new Date().toISOString(),
                },
              ]);
              setStreamingContent("");
            }
            if (event.type === "error") {
              throw new Error(event.error || "Agent error");
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "Agent error") continue;
            const errMsg = e instanceof Error ? e.message : "未知错误";
            setMessages((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                sessionId: activeSessionId,
                role: "assistant",
                content: `错误: ${errMsg}`,
                toolCalls: null,
                createdAt: new Date().toISOString(),
              },
            ]);
            setStreamingContent("");
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          sessionId: activeSessionId,
          role: "assistant",
          content: `网络错误: ${msg}`,
          toolCalls: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setStreaming(false);
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await fetch(`/api/chat/${id}`, { method: "DELETE" });
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
      showToast("会话已删除", "success");
      fetchSessions();
    } catch {
      showToast("删除失败", "error");
    }
  };

  const selectedKb = kbs.find(
    (k) => k.id === sessions.find((s) => s.id === activeSessionId)?.kbId,
  );

  const displayMessages = messages.filter((m) => m.role !== "tool");

  return (
    <div className="page-enter" style={{ display: "flex", height: "calc(100vh - 96px)", gap: 16 }}>
      {/* Session sidebar */}
      <div style={{
        width: 240,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        paddingRight: 12,
        display: "flex",
        flexDirection: "column",
      }}>
        <button
          className="btn btn-primary"
          style={{ marginBottom: 12, width: "100%", justifyContent: "center" }}
          onClick={() => setShowNewChat(true)}
        >
          + 新建问答
        </button>

        {showNewChat && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <select
                className="form-select"
                style={{ fontSize: 12 }}
                value={newChatKbId}
                onChange={(e) => setNewChatKbId(e.target.value)}
              >
                <option value="">选择知识库</option>
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <input
                className="form-input"
                style={{ fontSize: 12 }}
                placeholder="标题（可选）"
                value={newChatTitle}
                onChange={(e) => setNewChatTitle(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-primary btn-sm" onClick={createSession}>创建</button>
              <button className="btn btn-outline btn-sm" onClick={() => setShowNewChat(false)}>取消</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessionsLoading ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 8 }}>加载中...</div>
          ) : sessions.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 8 }}>暂无会话</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "var(--radius)",
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "background var(--transition)",
                  background: activeSessionId === s.id ? "var(--primary-light)" : "transparent",
                  color: activeSessionId === s.id ? "var(--primary)" : "var(--text)",
                  marginBottom: 2,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {s.title}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "0 4px",
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {!activeSessionId ? (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>AI 知识问答</div>
            <div style={{ fontSize: 13 }}>选择一个会话或创建新的问答</div>
          </div>
        ) : (
          <>
            <div style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              marginBottom: 12,
              padding: "8px 12px",
              background: "var(--surface)",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
            }}>
              📚 知识库: <strong>{selectedKb?.name || "未知"}</strong>
            </div>

            <div style={{
              flex: 1,
              overflowY: "auto",
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "0 4px",
            }}>
              {displayMessages.length === 0 && !streamingContent && (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, marginTop: 40 }}>
                  发送消息开始对话
                </div>
              )}
              {displayMessages.map((m) => (
                <div key={m.id} className={`chat-message ${m.role}`}>
                  <div className={`chat-message-avatar`}>
                    {m.role === "user" ? "👤" : "🤖"}
                  </div>
                  <div>
                    <div className="chat-message-bubble">
                      {m.content}
                    </div>
                  </div>
                </div>
              ))}
              {streamingContent && (
                <div className="chat-message assistant">
                  <div className="chat-message-avatar">🤖</div>
                  <div>
                    <div className="chat-message-bubble">
                      {streamingContent}
                      <span style={{
                        display: "inline-block",
                        width: 8,
                        height: 16,
                        background: "var(--primary)",
                        marginLeft: 2,
                        animation: "fadeIn 0.3s ease infinite alternate",
                      }}>|</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  border: "1px solid var(--border)",
                  borderRadius: 24,
                  fontSize: 13,
                  outline: "none",
                  background: "var(--bg)",
                  fontFamily: "inherit",
                }}
                placeholder="输入问题..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                disabled={streaming}
              />
              <button
                className="btn btn-primary"
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                style={{ borderRadius: 24, paddingLeft: 20, paddingRight: 20 }}
              >
                {streaming ? "..." : "发送"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
