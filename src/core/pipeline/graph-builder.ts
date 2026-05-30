import type { ParsedChunk } from "./types";

// ─── internal types ───────────────────────────────────────────────────────

export interface BuildNode {
  id: string;
  label: string;
  nodeType: string;
  sourceDocId: string | null;
  sourceFilePath: string | null;
  metadata: Record<string, unknown>;
}

export interface UnresolvedEdge {
  sourceLabel: string;
  targetLabel: string;
  relation: string;
  confidence: number;
}

export interface ResolvedEdge {
  kbId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  confidence: number;
}

// ─── file-type synonym map ────────────────────────────────────────────────

const FILE_TYPE_SYNONYMS: Record<string, string> = {
  markdown: "document",
  text: "document",
  tool: "code",
  library: "code",
  pattern: "concept",
  principle: "concept",
  constraint: "concept",
  tech: "concept",
  technology: "concept",
  "data-source": "concept",
  data_source: "concept",
  gotcha: "concept",
  framework: "concept",
};

const ALLOWED_FILE_TYPES = new Set([
  "code",
  "document",
  "paper",
  "image",
  "rationale",
  "concept",
]);

// ─── language family map ──────────────────────────────────────────────────

const LANG_FAMILY: Record<string, string> = {
  ".py": "py",
  ".pyi": "py",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "js",
  ".ts": "js",
  ".tsx": "js",
  ".go": "go",
  ".rs": "rs",
  ".java": "jvm",
  ".kt": "jvm",
  ".scala": "jvm",
  ".groovy": "jvm",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".rb": "rb",
  ".php": "php",
  ".cs": "cs",
  ".swift": "swift",
  ".lua": "lua",
};

// ─── normalizeId ──────────────────────────────────────────────────────────

/**
 * Normalize an ID string: NFKC normalise, replace non-word characters
 * with underscores, collapse consecutive underscores, strip leading/trailing
 * underscores, and casefold. Emulates {@code graphify.build._normalize_id}.
 */
export function normalizeId(s: string): string {
  // NFKC decomposition via String.prototype.normalize
  const nfkc = s.normalize("NFKC");
  // Replace runs of characters that are NOT Unicode letters, numbers, or
  // underscores with a single underscore. Uses Unicode property escapes
  // (\p{L} = any letter, \p{N} = any number) for true Unicode word-character
  // matching (equivalent to Python's re.UNICODE \w).
  let cleaned = nfkc.replace(/[^\p{L}\p{N}_]+/gu, "_");
  // Collapse consecutive underscores
  cleaned = cleaned.replace(/_+/g, "_");
  // Strip leading/trailing underscores
  cleaned = cleaned.replace(/^_|_$/g, "");
  return cleaned.toLocaleLowerCase();
}

// ─── normalizeFileType ────────────────────────────────────────────────────

export function normalizeFileType(ft: string): string {
  if (ft === "") {
    return "concept";
  }
  // Check if it is a known synonym
  const mapped = FILE_TYPE_SYNONYMS[ft];
  if (mapped !== undefined) {
    return mapped;
  }
  // If it is already an allowed value, pass through
  if (ALLOWED_FILE_TYPES.has(ft)) {
    return ft;
  }
  // Default fallback
  return "concept";
}

// ─── getLangFamily ────────────────────────────────────────────────────────

export function getLangFamily(sourceFile: string): string {
  if (!sourceFile) {
    return "";
  }
  const dotIdx = sourceFile.lastIndexOf(".");
  if (dotIdx === -1) {
    return "";
  }
  const ext = sourceFile.slice(dotIdx).toLowerCase();
  return LANG_FAMILY[ext] ?? "";
}

// ─── shouldFilterEdge ─────────────────────────────────────────────────────

export function shouldFilterEdge(
  edge: { relation: string; confidence: string },
  srcSourceFile: string,
  tgtSourceFile: string,
): boolean {
  if (edge.relation !== "calls" || edge.confidence !== "INFERRED") {
    return false;
  }
  if (!srcSourceFile || !tgtSourceFile) {
    return false;
  }
  const srcFamily = getLangFamily(srcSourceFile);
  const tgtFamily = getLangFamily(tgtSourceFile);
  if (!srcFamily || !tgtFamily) {
    return false;
  }
  return srcFamily !== tgtFamily;
}

// ─── buildGraph ───────────────────────────────────────────────────────────

export function buildGraph(
  kbId: string,
  chunks: ParsedChunk[],
  sourceDocId?: string,
  sourceFilePath?: string,
): { nodes: BuildNode[]; unresolvedEdges: UnresolvedEdge[] } {
  const docId = sourceDocId ?? null;
  const srcFilePath = sourceFilePath ?? null;

  // Map normalized ID → BuildNode (first one wins)
  const nodeMap = new Map<string, BuildNode>();

  for (const chunk of chunks) {
    for (const rawNode of chunk.nodes) {
      const id = normalizeId(rawNode.label);
      const rawType = rawNode.type;
      // Only apply file_type normalization to the metadata field, not the semantic nodeType.
      // The nodeType preserves the parser's original type (function, class, heading, etc.).
      const fileType = normalizeFileType(rawType);

      const existing = nodeMap.get(id);
      if (existing) {
        // Merge metadata (newer overwrites)
        const merged = { ...existing.metadata, ...(rawNode.metadata ?? {}) };
        nodeMap.set(id, { ...existing, metadata: merged });
      } else {
        nodeMap.set(id, {
          id,
          label: rawNode.label,
          nodeType: rawType,
          sourceDocId: docId,
          sourceFilePath: srcFilePath,
          metadata: { ...(rawNode.metadata ?? {}), file_type: fileType },
        });
      }
    }
  }

  // Deduplicate edges by source+target+relation key (first wins)
  const edgeMap = new Map<string, UnresolvedEdge>();

  for (const chunk of chunks) {
    for (const rawEdge of chunk.edges) {
      const edgeKey = `${rawEdge.source}::${rawEdge.target}::${rawEdge.relation}`;
      if (!edgeMap.has(edgeKey)) {
        const confidence =
          rawEdge.confidence === "EXTRACTED" ? 1.0 : 0.5;

        edgeMap.set(edgeKey, {
          sourceLabel: rawEdge.source,
          targetLabel: rawEdge.target,
          relation: rawEdge.relation,
          confidence,
        });
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    unresolvedEdges: Array.from(edgeMap.values()),
  };
}

// ─── resolveEdgeIds ───────────────────────────────────────────────────────

export function resolveEdgeIds(
  nodes: { id: string; label: string }[],
  unresolvedEdges: UnresolvedEdge[],
  kbId: string,
): ResolvedEdge[] {
  const labelToId = new Map(nodes.map((n) => [n.label, n.id]));

  const resolved: ResolvedEdge[] = [];
  for (const edge of unresolvedEdges) {
    const sourceId = labelToId.get(edge.sourceLabel);
    const targetId = labelToId.get(edge.targetLabel);
    if (sourceId !== undefined && targetId !== undefined) {
      resolved.push({
        kbId,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        relation: edge.relation,
        confidence: edge.confidence,
      });
    }
  }
  return resolved;
}
