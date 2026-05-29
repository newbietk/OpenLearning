import type { Database, KnowledgeBaseRecord } from "../../lib/db/interface";
import type { DocumentRecord, GraphNodeRecord, GraphEdgeRecord } from "../../core/pipeline/types";
import { detectType } from "../../core/pipeline/detector";
import { chunkText } from "../../core/pipeline/chunker";
import { createParserRegistry } from "../../core/pipeline/parsers/registry";
import { createTextParser } from "../../core/pipeline/parsers/text";
import { createMarkdownParser } from "../../core/pipeline/parsers/markdown";
import { createLinkParser } from "../../core/pipeline/parsers/link";
import { createCodeParser } from "../../core/pipeline/parsers/code";
import { buildGraph, resolveEdgeIds } from "../../core/pipeline/graph-builder";
import { keywordsSearch, getNode, getNeighbors, godNodes, graphStats, shortestPath } from "../../core/pipeline/search";
import { getLogger } from "../../lib/logger";

export interface CreateKbInput {
  ownerId: string;
  name: string;
  description: string;
  kbType: "public" | "private";
}

export interface ImportDocumentInput {
  title: string;
  sourceType: "file" | "link" | "text";
  filePath?: string;
  content?: string;
  sourceUrl?: string;
}

export function createKnowledgeBaseService(db: Database) {
  const log = getLogger();

  return {
    // ── Knowledge Base CRUD ──────────────────────────────────────────────

    createKb(input: CreateKbInput): KnowledgeBaseRecord {
      return db.knowledgeBase.create(input);
    },

    listKbs(externalId: string, isAdmin: boolean) {
      const own = db.knowledgeBase.findByOwner(externalId);
      const publicKbs = db.knowledgeBase.findByType("public");
      return { own, public: publicKbs, isAdmin };
    },

    getKb(id: string): KnowledgeBaseRecord | undefined {
      return db.knowledgeBase.findById(id);
    },

    deleteKb(id: string, externalId: string, isAdmin: boolean): void {
      const kb = db.knowledgeBase.findById(id);
      if (!kb) throw new Error("Knowledge base not found");
      if (kb.kbType === "public" && !isAdmin) throw new Error("Only admins can delete public KBs");
      if (kb.kbType === "private" && kb.ownerId !== externalId) throw new Error("Not your KB");
      db.knowledgeBase.delete(id);
    },

    // ── Document Import ──────────────────────────────────────────────────

    async importDocument(kbId: string, input: ImportDocumentInput): Promise<DocumentRecord> {
      const doc = db.document.create({
        kbId,
        title: input.title,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
        filePath: input.filePath ?? null,
        fileSize: null,
        status: "pending",
        errorMessage: null,
        parsedAt: null,
      });

      try {
        db.document.updateStatus(doc.id, "parsing");

        // Get content
        let content = input.content ?? "";
        if (!content && input.filePath) {
          const fs = await import("node:fs");
          if (!fs.existsSync(input.filePath)) {
            throw new Error(`File not found: ${input.filePath}`);
          }
          content = fs.readFileSync(input.filePath, "utf-8");
        }
        if (content.length === 0) {
          throw new Error("No content to parse");
        }

        // Detect type → get parser
        const detectedType = input.sourceUrl
          ? "link"
          : detectType({ fileName: input.filePath, url: input.sourceUrl });

        const registry = createParserRegistry();
        registry.register(createTextParser());
        registry.register(createMarkdownParser());
        registry.register(createLinkParser());
        registry.register(createCodeParser());

        const parser = registry.get(detectedType);
        if (!parser) throw new Error(`No parser for type: ${detectedType}`);

        // Parse
        const parseResult = await parser.parse({
          content,
          sourceUrl: input.sourceUrl,
          filePath: input.filePath,
        });

        // Chunk
        const chunkResult = chunkText(parseResult.text);
        for (const c of chunkResult.chunks) {
          db.documentChunk.batchCreate([
            { docId: doc.id, chunkIndex: c.index, contentText: c.text, tokenCount: c.tokenCount },
          ]);
        }

        // Build graph
        const { nodes: graphNodes, unresolvedEdges } = buildGraph(
          kbId,
          parseResult.chunks,
          doc.id,
          input.filePath,
        );

        if (graphNodes.length > 0) {
          const inserted = db.graphNode.batchCreate(
            graphNodes.map((n) => ({
              kbId,
              label: n.label,
              nodeType: n.nodeType,
              sourceDocId: n.sourceDocId,
              metadata: n.metadata,
            })),
          );

          const resolvedEdges = resolveEdgeIds(
            inserted.map((n) => ({ id: n.id, label: n.label })),
            unresolvedEdges,
            kbId,
          );

          if (resolvedEdges.length > 0) {
            db.graphEdge.batchCreate(resolvedEdges);
          }
        }

        db.document.updateStatus(doc.id, "done");
        (doc as any).status = "done";
        log.info("import: document parsed", { docId: doc.id, kbId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.document.updateStatus(doc.id, "failed", msg);
        (doc as any).status = "failed";
        (doc as any).errorMessage = msg;
        log.error("import: failed", err instanceof Error ? err : new Error(msg), { docId: doc.id });
        throw err;
      }

      return doc;
    },

    // ── Documents ────────────────────────────────────────────────────────

    getDocuments(kbId: string): DocumentRecord[] {
      return db.document.findByKbId(kbId);
    },

    // ── Graph ────────────────────────────────────────────────────────────

    getGraph(kbId: string): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] } {
      return {
        nodes: db.graphNode.findByKbId(kbId),
        edges: db.graphEdge.findByKbId(kbId),
      };
    },

    // ── Search ───────────────────────────────────────────────────────────

    searchKnowledge(kbId: string, query: string, maxDepth: number = 2, maxResults: number = 20) {
      const nodes = db.graphNode.findByKbId(kbId);
      const edges = db.graphEdge.findByKbId(kbId);
      return keywordsSearch(nodes, edges, query, kbId, maxDepth, maxResults);
    },
  };
}
