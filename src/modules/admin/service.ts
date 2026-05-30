import type { Database, KnowledgeBaseRecord, PlatformAdminRecord } from "../../lib/db/interface";
import { getLogger } from "../../lib/logger";

function getEnvAdmins(): string[] {
  return (process.env.PLATFORM_ADMINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createAdminService(db: Database) {
  const log = getLogger();

  return {
    // ── Admin check ──────────────────────────────────────────────────────

    isAdmin(externalId: string): boolean {
      if (getEnvAdmins().includes(externalId)) return true;
      return !!db.platformAdmin.findByExternalId(externalId);
    },

    // ── Admin CRUD ───────────────────────────────────────────────────────

    listAdmins(): string[] {
      const env = getEnvAdmins();
      const dbAdmins = db.platformAdmin.findAll().map((a) => a.externalId);
      const set = new Set([...env, ...dbAdmins]);
      return [...set];
    },

    addAdmin(externalId: string): PlatformAdminRecord {
      const existing = db.platformAdmin.findByExternalId(externalId);
      if (existing) return existing;
      if (getEnvAdmins().includes(externalId)) {
        return { id: "", externalId, createdAt: "" };
      }
      log.info("admin: added", { externalId });
      return db.platformAdmin.create(externalId);
    },

    removeAdmin(externalId: string): void {
      if (getEnvAdmins().includes(externalId)) {
        throw new Error("Cannot remove environment-configured admin");
      }
      log.info("admin: removed", { externalId });
      db.platformAdmin.deleteByExternalId(externalId);
    },

    // ── Public KB ────────────────────────────────────────────────────────

    createPublicKb(input: {
      ownerId: string;
      name: string;
      description: string;
    }): KnowledgeBaseRecord {
      return db.knowledgeBase.create({
        ownerId: input.ownerId,
        name: input.name,
        description: input.description,
        kbType: "public",
      });
    },

    updatePublicKb(
      id: string,
      data: Partial<Pick<KnowledgeBaseRecord, "name" | "description">>,
    ): KnowledgeBaseRecord {
      return db.knowledgeBase.update(id, data);
    },

    deletePublicKb(id: string): void {
      db.knowledgeBase.delete(id);
    },

    // ── Stats ────────────────────────────────────────────────────────────

    getStats(): {
      totalKbs: number;
      totalDocuments: number;
      totalNodes: number;
      totalEdges: number;
    } {
      const allKbs = db.knowledgeBase.findAll();
      // The interface doesn't have count methods, so we get all.
      // In production, these would be COUNT queries.
      const totalKbs = allKbs.length;
      const totalNodes = allKbs.reduce(
        (sum, kb) => sum + db.graphNode.findByKbId(kb.id).length,
        0,
      );
      const totalEdges = allKbs.reduce(
        (sum, kb) => sum + db.graphEdge.findByKbId(kb.id).length,
        0,
      );
      const totalDocuments = allKbs.reduce(
        (sum, kb) => sum + db.document.findByKbId(kb.id).length,
        0,
      );

      return { totalKbs, totalDocuments, totalNodes, totalEdges };
    },
  };
}
