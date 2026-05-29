import { describe, it, expect, beforeEach } from "vitest";
import type { Database, KnowledgeBaseRecord } from "../../../lib/db/interface";

// ── mock DB ─────────────────────────────────────────────────────────────────

function mockAdminDb(): Database {
  const kbs: KnowledgeBaseRecord[] = [];
  const admins: Array<{ id: string; externalId: string; createdAt: string }> = [
    { id: "a1", externalId: "env-admin-1", createdAt: "" },
  ];

  return {
    knowledgeBase: {
      findById(id) { return kbs.find((k) => k.id === id); },
      findAll() { return [...kbs]; },
      findByOwner(ownerId) { return kbs.filter((k) => k.ownerId === ownerId); },
      findByType(kbType) { return kbs.filter((k) => k.kbType === kbType); },
      create(data) {
        const r: KnowledgeBaseRecord = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...data };
        kbs.push(r);
        return r;
      },
      update(id, data) {
        const idx = kbs.findIndex((k) => k.id === id);
        if (idx !== -1) kbs[idx] = { ...kbs[idx], ...data };
        return kbs[idx];
      },
      delete(id) {
        const idx = kbs.findIndex((k) => k.id === id);
        if (idx !== -1) kbs.splice(idx, 1);
      },
    },
    platformAdmin: {
      findAll() { return [...admins]; },
      findByExternalId(externalId) { return admins.find((a) => a.externalId === externalId); },
      create(externalId) {
        const r = { id: crypto.randomUUID(), externalId, createdAt: new Date().toISOString() };
        admins.push(r);
        return r;
      },
      deleteByExternalId(externalId) {
        const idx = admins.findIndex((a) => a.externalId === externalId);
        if (idx !== -1) admins.splice(idx, 1);
      },
    },
    document: {
      findById: () => undefined,
      findByKbId: () => [],
      create: () => ({ id: "", kbId: "", title: "", sourceType: "text" as const, sourceUrl: null, filePath: null, fileSize: null, status: "pending" as const, errorMessage: null, parsedAt: null, createdAt: "" }),
      updateStatus: () => {},
      delete: () => {},
    },
    documentChunk: {
      findByDocId: () => [],
      batchCreate: () => {},
      deleteByDocId: () => {},
    },
    graphNode: {
      findByKbId: () => [],
      findByLabel: () => undefined,
      findNeighbors: () => [],
      search: () => [],
      batchCreate: () => [],
      deleteByKbId: () => {},
    },
    graphEdge: {
      findByKbId: () => [],
      findByNode: () => [],
      batchCreate: () => {},
      deleteByKbId: () => {},
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
    transaction: async (fn: any) => fn(this as unknown as Database),
  } as unknown as Database;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("Admin Service", () => {
  let service: ReturnType<typeof import("../service").createAdminService>;
  let db: Database;

  beforeEach(async () => {
    process.env.PLATFORM_ADMINS = "env-admin-1,env-admin-2";
    db = mockAdminDb();
    const mod = await import("../service");
    service = mod.createAdminService(db);
  });

  // ── isAdmin ───────────────────────────────────────────────────────────────

  it("should identify env var admins", () => {
    expect(service.isAdmin("env-admin-1")).toBe(true);
    expect(service.isAdmin("env-admin-2")).toBe(true);
  });

  it("should identify DB admins", () => {
    db.platformAdmin.create("db-admin-1");
    expect(service.isAdmin("db-admin-1")).toBe(true);
  });

  it("should return false for non-admins", () => {
    expect(service.isAdmin("regular-user")).toBe(false);
  });

  // ── Admin CRUD ────────────────────────────────────────────────────────────

  it("should list all admins", () => {
    const list = service.listAdmins();
    expect(list.length).toBeGreaterThanOrEqual(2); // env + db
    expect(list.some((a) => a === "env-admin-1")).toBe(true);
  });

  it("should add a new admin", () => {
    service.addAdmin("new-admin");
    expect(service.isAdmin("new-admin")).toBe(true);
  });

  it("should not add duplicate admin", () => {
    service.addAdmin("env-admin-1");
    const list = service.listAdmins();
    const count = list.filter((a) => a === "env-admin-1").length;
    expect(count).toBe(1);
  });

  it("should remove an admin from DB", () => {
    db.platformAdmin.create("db-admin-remove");
    expect(service.isAdmin("db-admin-remove")).toBe(true);
    service.removeAdmin("db-admin-remove");
    expect(service.isAdmin("db-admin-remove")).toBe(false);
  });

  it("should prevent removing env var admins", () => {
    expect(() => service.removeAdmin("env-admin-1")).toThrow(
      "Cannot remove environment-configured admin",
    );
  });

  // ── Public KB management ──────────────────────────────────────────────────

  it("should create a public KB", () => {
    const kb = service.createPublicKb({ ownerId: "admin1", name: "Public KB", description: "Shared" });
    expect(kb.kbType).toBe("public");
    expect(kb.name).toBe("Public KB");
  });

  it("should update a public KB", () => {
    const kb = service.createPublicKb({ ownerId: "admin1", name: "Old", description: "" });
    const updated = service.updatePublicKb(kb.id, { name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  it("should delete a public KB", () => {
    const kb = service.createPublicKb({ ownerId: "admin1", name: "To Delete", description: "" });
    service.deletePublicKb(kb.id);
    expect(db.knowledgeBase.findById(kb.id)).toBeUndefined();
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  it("should return platform stats", () => {
    db.knowledgeBase.create({ ownerId: "u1", name: "KB1", description: "", kbType: "private" });
    db.knowledgeBase.create({ ownerId: "u2", name: "KB2", description: "", kbType: "public" });

    const stats = service.getStats();
    expect(stats.totalKbs).toBeGreaterThan(0);
    expect(typeof stats.totalKbs).toBe("number");
  });
});
