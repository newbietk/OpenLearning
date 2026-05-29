import { describe, it, expect, beforeEach } from "vitest";
import type { Database, LlmProviderRecord } from "../../../lib/db/interface";

// ── mock DB factory ─────────────────────────────────────────────────────────

function mockLlmDb(): Database {
  const providers: LlmProviderRecord[] = [];

  return {
    knowledgeBase: {
      findById: () => undefined,
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
      findById: () => undefined,
      findByKbId: () => [],
      create: () => ({ id: "", kbId: "", title: "", sourceType: "text", sourceUrl: null, filePath: null, fileSize: null, status: "pending", errorMessage: null, parsedAt: null, createdAt: "" }),
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
      findByUser(externalUserId) {
        return providers.filter((p) => p.externalUserId === externalUserId);
      },
      findEnabled(externalUserId, provider) {
        return providers.find(
          (p) => p.externalUserId === externalUserId && p.provider === provider && p.enabled,
        );
      },
      create(data) {
        const record: LlmProviderRecord = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          ...data,
        };
        providers.push(record);
        return record;
      },
      update(id, data) {
        const p = providers.find((x) => x.id === id);
        if (p) Object.assign(p, data);
      },
      delete(id) {
        const idx = providers.findIndex((x) => x.id === id);
        if (idx !== -1) providers.splice(idx, 1);
      },
    },
    transaction: async (fn) => fn(this as unknown as Database),
  } as unknown as Database;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("LLM Config Service", () => {
  let service: ReturnType<typeof import("../service").createLlmConfigService>;
  let db: Database;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    db = mockLlmDb();
    const mod = await import("../service");
    service = mod.createLlmConfigService(db);
  });

  it("should add a provider with encrypted API key", () => {
    const record = service.addProvider({
      externalUserId: "user1",
      provider: "openai",
      apiKey: "sk-test-key-123",
      baseUrl: null,
    });

    expect(record.id).toBeDefined();
    expect(record.provider).toBe("openai");
    expect(record.apiKeyEncrypted).not.toBe("sk-test-key-123");
    expect(record.apiKeyEncrypted).toContain(":");
    expect(record.enabled).toBe(true);
  });

  it("should list providers for a user", () => {
    service.addProvider({ externalUserId: "user1", provider: "openai", apiKey: "sk-1", baseUrl: null });
    service.addProvider({ externalUserId: "user1", provider: "anthropic", apiKey: "sk-2", baseUrl: null });
    service.addProvider({ externalUserId: "user2", provider: "deepseek", apiKey: "sk-3", baseUrl: null });

    const list = service.listProviders("user1");
    expect(list).toHaveLength(2);
    // API keys should NOT be decrypted in list view
    expect(list[0].apiKeyEncrypted).toContain(":");
  });

  it("should update a provider", () => {
    const p = service.addProvider({ externalUserId: "user1", provider: "openai", apiKey: "sk-old", baseUrl: null });
    service.updateProvider(p.id, { enabled: false, baseUrl: "https://custom.openai.com" });

    const list = service.listProviders("user1");
    expect(list[0].enabled).toBe(false);
    expect(list[0].baseUrl).toBe("https://custom.openai.com");
  });

  it("should delete a provider", () => {
    const p = service.addProvider({ externalUserId: "user1", provider: "openai", apiKey: "sk-1", baseUrl: null });
    service.deleteProvider(p.id);
    expect(service.listProviders("user1")).toHaveLength(0);
  });

  it("should get an enabled provider with decrypted key", () => {
    service.addProvider({ externalUserId: "user1", provider: "openai", apiKey: "sk-test-key-abc", baseUrl: null });

    const enabled = service.getEnabledProvider("user1", "openai");
    expect(enabled).toBeDefined();
    expect(enabled!.apiKey).toBe("sk-test-key-abc");
    expect(enabled!.provider).toBe("openai");
  });

  it("should return undefined for disabled provider", () => {
    const p = service.addProvider({ externalUserId: "user1", provider: "openai", apiKey: "sk-1", baseUrl: null });
    service.updateProvider(p.id, { enabled: false });
    expect(service.getEnabledProvider("user1", "openai")).toBeUndefined();
  });

  it("should build a ModelProvider instance", () => {
    service.addProvider({ externalUserId: "user1", provider: "openai", apiKey: "sk-test", baseUrl: null });

    const provider = service.buildProviderInstance("user1", "openai");
    expect(provider).toBeDefined();
    expect(provider.name).toBe("openai");
  });

  it("should throw when building a non-existent provider", () => {
    expect(() => service.buildProviderInstance("user1", "openai")).toThrow("No enabled openai provider");
  });
});
