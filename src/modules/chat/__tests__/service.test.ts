import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../../../lib/db/interface";

// ── mock DB factory ─────────────────────────────────────────────────────────

function mockChatDb(): Database {
  const sessions: Array<{ id: string; kbId: string; externalUserId: string; title: string; createdAt: string }> = [];
  const messages: Array<{ id: string; sessionId: string; role: string; content: string; toolCalls: string | null; createdAt: string }> = [];
  const graphNodes: Array<{ id: string; kbId: string; label: string; nodeType: string; sourceDocId: string | null; metadata: Record<string, unknown>; createdAt: string }> = [];
  const graphEdges: Array<{ id: string; kbId: string; sourceNodeId: string; targetNodeId: string; relation: string; confidence: number; createdAt: string }> = [];
  const docs: Array<{ id: string; kbId: string; title: string; sourceType: string }> = [];

  return {
    knowledgeBase: {
      findById: (id: string) => ({ id, ownerId: "u1", name: "Test", description: "", kbType: "private", createdAt: "" }),
      findAll: () => [],
      findByOwner: () => [],
      findByType: () => [],
      create: () => ({ id: "", ownerId: "", name: "", description: "", kbType: "private", createdAt: "" }),
      update: () => ({ id: "", ownerId: "", name: "", description: "", kbType: "private", createdAt: "" }),
      delete: () => {},
    },
    platformAdmin: {
      findAll: () => [],
      findByExternalId: () => undefined,
      create: () => ({ id: "", externalId: "", createdAt: "" }),
      deleteByExternalId: () => {},
    },
    document: {
      findById: (id: string) => docs.find((d) => d.id === id) ?? null,
      findByKbId: (kbId: string) => docs.filter((d) => d.kbId === kbId).map((d) => ({ ...d, sourceUrl: null, filePath: null, fileSize: null, status: "done" as const, errorMessage: null, parsedAt: null, createdAt: "" })),
      create: () => ({ id: "", kbId: "", title: "", sourceType: "text" as const, sourceUrl: null, filePath: null, fileSize: null, status: "done" as const, errorMessage: null, parsedAt: null, createdAt: "" }),
      updateStatus: () => {},
      delete: () => {},
    },
    documentChunk: {
      findByDocId: () => [],
      batchCreate: () => {},
      deleteByDocId: () => {},
    },
    graphNode: {
      findByKbId: (kbId: string) => [...graphNodes],
      findByLabel: (_kbId: string, label: string) => graphNodes.find((n) => n.label === label) ?? null,
      findNeighbors: () => [],
      search: (kbId: string, query: string) => graphNodes.filter((n) => n.kbId === kbId),
      batchCreate: () => [],
      deleteByKbId: () => {},
    },
    graphEdge: {
      findByKbId: () => [...graphEdges],
      findByNode: () => [],
      batchCreate: () => {},
      deleteByKbId: () => {},
    },
    chat: {
      createSession(data) {
        const s = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
        sessions.push(s);
        return s;
      },
      findSessionById(id) { return sessions.find((s) => s.id === id); },
      findSessionsByUser(externalUserId) { return sessions.filter((s) => s.externalUserId === externalUserId); },
      addMessage(data) {
        const m = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
        messages.push(m);
        return m;
      },
      findMessagesBySession(sessionId) { return messages.filter((m) => m.sessionId === sessionId); },
      deleteSession(id) {
        const sIdx = sessions.findIndex((s) => s.id === id);
        if (sIdx !== -1) sessions.splice(sIdx, 1);
        const toRemove = messages.filter((m) => m.sessionId === id);
        toRemove.forEach((m) => { const idx = messages.indexOf(m); if (idx !== -1) messages.splice(idx, 1); });
      },
    },
    llmProvider: {
      findByUser: () => [],
      findEnabled: () => undefined,
      create: () => ({ id: "", externalUserId: "", provider: "", apiKeyEncrypted: "", baseUrl: null, enabled: true, createdAt: "" }),
      update: () => {},
      delete: () => {},
    },
    transaction: async (fn: any) => fn(this as unknown as Database),
  } as unknown as Database;
}

function createMockProvider() {
  return {
    name: "openai",
    async *chat() {
      yield { type: "text" as const, content: "Hello! How can I help?" };
      yield { type: "done" as const };
    },
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("Chat Service", () => {
  let service: ReturnType<typeof import("../service").createChatService>;
  let db: Database;

  beforeEach(async () => {
    db = mockChatDb();
    const mod = await import("../service");
    service = mod.createChatService(db);
  });

  // ── Session CRUD ──────────────────────────────────────────────────────────

  it("should create a chat session", () => {
    const session = service.createSession("kb1", "user1", "My Chat");
    expect(session.id).toBeDefined();
    expect(session.kbId).toBe("kb1");
    expect(session.externalUserId).toBe("user1");
    expect(session.title).toBe("My Chat");
  });

  it("should get a session by id", () => {
    const s = service.createSession("kb1", "user1", "Test");
    expect(service.getSession(s.id)).toBeDefined();
    expect(service.getSession("nonexistent")).toBeUndefined();
  });

  it("should list sessions for a user", () => {
    service.createSession("kb1", "user1", "Chat 1");
    service.createSession("kb2", "user1", "Chat 2");
    service.createSession("kb1", "user2", "Other Chat");

    const list = service.listSessions("user1");
    expect(list).toHaveLength(2);
  });

  it("should delete a session and its messages", () => {
    const s = service.createSession("kb1", "user1", "Test");
    db.chat.addMessage({ sessionId: s.id, role: "user", content: "Hello", toolCalls: null });

    service.deleteSession(s.id);
    expect(service.getSession(s.id)).toBeUndefined();
    expect(service.getMessages(s.id)).toHaveLength(0);
  });

  // ── Messages ──────────────────────────────────────────────────────────────

  it("should get messages for a session", () => {
    const s = service.createSession("kb1", "user1", "Test");
    db.chat.addMessage({ sessionId: s.id, role: "user", content: "Hello", toolCalls: null });
    db.chat.addMessage({ sessionId: s.id, role: "assistant", content: "Hi there", toolCalls: null });

    const msgs = service.getMessages(s.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
  });

  // ── sendMessage ───────────────────────────────────────────────────────────

  it("should send a message and stream agent response", async () => {
    const s = service.createSession("kb1", "user1", "Test Chat");
    const provider = createMockProvider();

    const events: Array<{ type: string }> = [];
    for await (const event of service.sendMessage(s.id, "What is React?", provider)) {
      events.push({ type: event.type });
    }

    // Should have response events
    expect(events.some((e) => e.type === "response")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);

    // Messages should be persisted
    const msgs = service.getMessages(s.id);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });

  it("should persist user message before running agent", async () => {
    const s = service.createSession("kb1", "user1", "Test");
    const provider = createMockProvider();

    const events: Array<any> = [];
    for await (const event of service.sendMessage(s.id, "Hello world", provider)) {
      events.push(event);
    }

    const msgs = service.getMessages(s.id);
    expect(msgs.some((m) => m.role === "user" && m.content === "Hello world")).toBe(true);
  });

  it("should throw when session not found", async () => {
    const provider = createMockProvider();
    await expect(async () => {
      for await (const _ of service.sendMessage("bad-id", "Hello", provider)) {
        // should throw before yielding
      }
    }).rejects.toThrow("Session not found");
  });
});
