import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database, KnowledgeBaseRecord } from "../../../lib/db/interface";
import type { DocumentRecord, GraphNodeRecord, GraphEdgeRecord } from "../../../core/pipeline/types";

// ── mock DB factory ─────────────────────────────────────────────────────────

function mockDb(overrides: Partial<Database> = {}): Database {
  const kbs: KnowledgeBaseRecord[] = [];
  const docs: DocumentRecord[] = [];
  const chunks: Array<{ id: string; docId: string; chunkIndex: number; contentText: string; tokenCount: number }> = [];
  const nodes: GraphNodeRecord[] = [];
  const edges: GraphEdgeRecord[] = [];

  // Build db incrementally so transaction can reference it
  const db: any = {};
  const rawDb: any = {
    knowledgeBase: {
      findById(id) { return kbs.find((k) => k.id === id); },
      findAll() { return [...kbs]; },
      findByOwner(ownerId) { return kbs.filter((k) => k.ownerId === ownerId); },
      findByType(kbType) { return kbs.filter((k) => k.kbType === kbType); },
      create(data) {
        const record: KnowledgeBaseRecord = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
        kbs.push(record);
        return record;
      },
      update(id, data) {
        const idx = kbs.findIndex((k) => k.id === id);
        if (idx === -1) throw new Error("Not found");
        kbs[idx] = { ...kbs[idx], ...data };
        return kbs[idx];
      },
      delete(id) {
        const idx = kbs.findIndex((k) => k.id === id);
        if (idx !== -1) kbs.splice(idx, 1);
      },
    },
    platformAdmin: {
      findAll: () => [],
      findByExternalId: () => undefined,
      create: () => ({ id: "a1", externalId: "admin1", createdAt: "" }),
      deleteByExternalId: () => {},
    },
    document: {
      findById(id) { return docs.find((d) => d.id === id); },
      findByKbId(kbId) { return docs.filter((d) => d.kbId === kbId); },
      create(data) {
        const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), parsedAt: null, ...data } as DocumentRecord;
        docs.push(record);
        return record;
      },
      updateStatus(id, status, errorMessage) {
        const d = docs.find((x) => x.id === id);
        if (d) { (d as any).status = status; (d as any).errorMessage = errorMessage ?? null; }
      },
      delete(id) {
        const idx = docs.findIndex((d) => d.id === id);
        if (idx !== -1) docs.splice(idx, 1);
      },
    },
    documentChunk: {
      findByDocId(docId) { return chunks.filter((c) => c.docId === docId); },
      batchCreate(data) { data.forEach((c, i) => chunks.push({ id: `ch-${i}`, ...c })); },
      deleteByDocId(docId) {
        const toRemove = chunks.filter((c) => c.docId === docId);
        toRemove.forEach((c) => { const idx = chunks.indexOf(c); if (idx !== -1) chunks.splice(idx, 1); });
      },
    },
    graphNode: {
      findByKbId(kbId) { return nodes.filter((n) => n.kbId === kbId); },
      findByLabel(_kbId, label) { return nodes.find((n) => n.label === label); },
      findNeighbors(nodeId, kbId) {
        const neighborIds = edges.filter((e) => e.kbId === kbId && e.sourceNodeId === nodeId).map((e) => e.targetNodeId);
        return nodes.filter((n) => neighborIds.includes(n.id));
      },
      search(kbId, query) {
        return nodes.filter((n) => n.kbId === kbId && n.label.toLowerCase().includes(query.toLowerCase()));
      },
      batchCreate(data) {
        const created: GraphNodeRecord[] = [];
        data.forEach((n) => {
          const record: GraphNodeRecord = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...n };
          nodes.push(record);
          created.push(record);
        });
        return created;
      },
      deleteByKbId(kbId) {
        const toRemove = nodes.filter((n) => n.kbId === kbId);
        toRemove.forEach((n) => { const idx = nodes.indexOf(n); if (idx !== -1) nodes.splice(idx, 1); });
      },
    },
    graphEdge: {
      findByKbId(kbId) { return edges.filter((e) => e.kbId === kbId); },
      findByNode(nodeId, kbId) {
        return edges.filter((e) => e.kbId === kbId && (e.sourceNodeId === nodeId || e.targetNodeId === nodeId));
      },
      batchCreate(data) { data.forEach((e) => edges.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...e })); },
      deleteByKbId(kbId) {
        const toRemove = edges.filter((e) => e.kbId === kbId);
        toRemove.forEach((e) => { const idx = edges.indexOf(e); if (idx !== -1) edges.splice(idx, 1); });
      },
    },
    chat: {
      createSession: () => ({ id: "", kbId: "", externalUserId: "", title: "", createdAt: "" }),
      findSessionById: () => undefined,
      findSessionsByUser: () => [],
      addMessage: () => ({ id: "", sessionId: "", role: "user", content: "", toolCalls: null, createdAt: "" }),
      findMessagesBySession: () => [],
      deleteSession: () => {},
    },
    llmProvider: {
      findByUser: () => [],
      findEnabled: () => undefined,
      create: () => ({ id: "", externalUserId: "", provider: "", apiKeyEncrypted: "", baseUrl: null, enabled: true, createdAt: "" }),
      update: () => {},
      delete: () => {},
    },
    ...overrides,
  };
  db.knowledgeBase = rawDb.knowledgeBase!;
  db.platformAdmin = rawDb.platformAdmin!;
  db.document = rawDb.document!;
  db.documentChunk = rawDb.documentChunk!;
  db.graphNode = rawDb.graphNode!;
  db.graphEdge = rawDb.graphEdge!;
  db.chat = rawDb.chat!;
  db.llmProvider = rawDb.llmProvider!;
  db.transaction = async (fn: any) => fn(db as Database);
  return db as Database;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("KnowledgeBase Service", () => {
  let service: ReturnType<typeof import("../service").createKnowledgeBaseService>;
  let db: Database;

  beforeEach(async () => {
    db = mockDb();
    const mod = await import("../service");
    service = mod.createKnowledgeBaseService(db);
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────

  it("should create a knowledge base", () => {
    const kb = service.createKb({ ownerId: "user1", name: "My KB", description: "desc", kbType: "private" });
    expect(kb.id).toBeDefined();
    expect(kb.name).toBe("My KB");
    expect(kb.ownerId).toBe("user1");
  });

  it("should list own and public KBs", () => {
    service.createKb({ ownerId: "user1", name: "Private 1", description: "", kbType: "private" });
    service.createKb({ ownerId: "user2", name: "Private 2", description: "", kbType: "private" });
    service.createKb({ ownerId: "admin", name: "Public KB", description: "", kbType: "public" });

    const result = service.listKbs("user1", false);
    expect(result.own).toHaveLength(1);
    expect(result.own[0].name).toBe("Private 1");
    expect(result.public).toHaveLength(1);
    expect(result.public[0].name).toBe("Public KB");
  });

  it("should get a KB by id", () => {
    const kb = service.createKb({ ownerId: "user1", name: "Test", description: "", kbType: "private" });
    const found = service.getKb(kb.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test");
  });

  it("should return undefined for missing KB", () => {
    expect(service.getKb("nonexistent")).toBeUndefined();
  });

  it("should allow owner to delete private KB", () => {
    const kb = service.createKb({ ownerId: "user1", name: "Test", description: "", kbType: "private" });
    service.deleteKb(kb.id, "user1", false);
    expect(service.getKb(kb.id)).toBeUndefined();
  });

  it("should allow admin to delete public KB", () => {
    const kb = service.createKb({ ownerId: "admin", name: "Public", description: "", kbType: "public" });
    service.deleteKb(kb.id, "admin", true);
    expect(service.getKb(kb.id)).toBeUndefined();
  });

  it("should prevent non-owner from deleting private KB", () => {
    const kb = service.createKb({ ownerId: "user1", name: "Test", description: "", kbType: "private" });
    expect(() => service.deleteKb(kb.id, "user2", false)).toThrow("Not your KB");
  });

  it("should prevent non-admin from deleting public KB", () => {
    const kb = service.createKb({ ownerId: "admin", name: "Public", description: "", kbType: "public" });
    expect(() => service.deleteKb(kb.id, "user1", false)).toThrow("Only admins");
  });

  // ── Document import ───────────────────────────────────────────────────────

  it("should import a text document and build graph", async () => {
    const kb = service.createKb({ ownerId: "user1", name: "KB", description: "", kbType: "private" });

    const doc = await service.importDocument(kb.id, {
      title: "test.txt",
      sourceType: "file",
      filePath: "/tmp/test.txt",
      content: "React is a JavaScript library.\n\nTypeScript adds static types to JavaScript.",
    });

    expect(doc.id).toBeDefined();
    expect(doc.status).toBe("done");

    const docs = service.getDocuments(kb.id);
    expect(docs).toHaveLength(1);

    const graph = service.getGraph(kb.id);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it("should import a markdown document", async () => {
    const kb = service.createKb({ ownerId: "user1", name: "KB", description: "", kbType: "private" });

    const doc = await service.importDocument(kb.id, {
      title: "readme.md",
      sourceType: "file",
      filePath: "readme.md",
      content: "# Introduction\n\nSome content.\n\n## Getting Started\n\nMore content.",
    });

    expect(doc.status).toBe("done");
  });

  it("should mark document as failed on parse error", async () => {
    const kb = service.createKb({ ownerId: "user1", name: "KB", description: "", kbType: "private" });

    // content is empty → parser should still work but let's test error path
    // Actually, let's test by providing a bad file path without content
    await expect(
      service.importDocument(kb.id, {
        title: "missing.txt",
        sourceType: "file",
        filePath: "/nonexistent/path/file.txt",
      }),
    ).rejects.toThrow();

    const docs = service.getDocuments(kb.id);
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe("failed");
    expect(docs[0].errorMessage).toBeTruthy();
  });

  it("should import a link-type document", async () => {
    const kb = service.createKb({ ownerId: "user1", name: "KB", description: "", kbType: "private" });

    // Link documents are detected by sourceUrl presence
    const doc = await service.importDocument(kb.id, {
      title: "Example Page",
      sourceType: "link",
      sourceUrl: "https://example.com",
      content: "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>",
    });

    expect(doc.status).toBe("done");
  });

  // ── Graph & Search ────────────────────────────────────────────────────────

  it("should return graph nodes and edges", () => {
    const kb = service.createKb({ ownerId: "user1", name: "KB", description: "", kbType: "private" });
    db.graphNode.batchCreate([
      { kbId: kb.id, label: "Node A", nodeType: "concept", sourceDocId: null, metadata: {} },
      { kbId: kb.id, label: "Node B", nodeType: "concept", sourceDocId: null, metadata: {} },
    ]);
    db.graphEdge.batchCreate([
      { kbId: kb.id, sourceNodeId: "", targetNodeId: "", relation: "related", confidence: 1.0 },
    ]);

    const graph = service.getGraph(kb.id);
    expect(graph.nodes).toHaveLength(2);
  });

  it("should search knowledge", () => {
    const kb = service.createKb({ ownerId: "user1", name: "KB", description: "", kbType: "private" });
    db.graphNode.batchCreate([
      { kbId: kb.id, label: "React", nodeType: "concept", sourceDocId: null, metadata: {} },
      { kbId: kb.id, label: "TypeScript", nodeType: "concept", sourceDocId: null, metadata: {} },
    ]);

    const results = service.searchKnowledge(kb.id, "React");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodes.some((n) => n.label === "React")).toBe(true);
  });
});
