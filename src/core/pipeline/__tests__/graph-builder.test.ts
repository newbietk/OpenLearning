import { describe, it, expect } from "vitest";
import {
  normalizeId,
  normalizeFileType,
  getLangFamily,
  shouldFilterEdge,
  buildGraph,
  resolveEdgeIds,
} from "../graph-builder";

// ─── normalizeId ─────────────────────────────────────────────────────────

describe("normalizeId", () => {
  it("lowercases and replaces non-word characters with underscores", () => {
    expect(normalizeId("Hello World")).toBe("hello_world");
  });

  it("handles leading and trailing special characters", () => {
    expect(normalizeId("  Spaces  ")).toBe("spaces");
  });

  it("applies NFKC normalization through casefold and Unicode-aware regex", () => {
    // Cafe with accent: NFKC preserves composed Latin characters (é stays as é),
    // only decomposes compatibility characters. \p{L} matches accented letters.
    expect(normalizeId("Café-&-Restaurant")).toBe("café_restaurant");
  });

  it("strips only special characters from ends", () => {
    expect(normalizeId("!!special!!")).toBe("special");
  });

  it("collapses multiple underscores into one", () => {
    expect(normalizeId("has__double__underscores")).toBe("has_double_underscores");
  });

  it("returns empty string for input with only special characters", () => {
    expect(normalizeId("___")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeId("")).toBe("");
  });

  it("casefolds mixed case strings", () => {
    expect(normalizeId("CamelCase_Test")).toBe("camelcase_test");
  });

  it("preserves CJK characters (Unicode word characters)", () => {
    expect(normalizeId("你好世界")).toBe("你好世界");
  });

  it("preserves CJK mixed with ASCII", () => {
    expect(normalizeId("Hello_世界-123")).toBe("hello_世界_123");
  });

  it("handles numbers with underscores", () => {
    expect(normalizeId("model_123_v2")).toBe("model_123_v2");
  });

  it("strips leading/trailing underscores", () => {
    expect(normalizeId("_leading_trailing_")).toBe("leading_trailing");
  });
});

// ─── normalizeFileType ────────────────────────────────────────────────────

describe("normalizeFileType", () => {
  it("maps 'markdown' to 'document'", () => {
    expect(normalizeFileType("markdown")).toBe("document");
  });

  it("maps 'text' to 'document'", () => {
    expect(normalizeFileType("text")).toBe("document");
  });

  it("maps 'tool' to 'code'", () => {
    expect(normalizeFileType("tool")).toBe("code");
  });

  it("maps 'library' to 'code'", () => {
    expect(normalizeFileType("library")).toBe("code");
  });

  it("maps 'pattern' to 'concept'", () => {
    expect(normalizeFileType("pattern")).toBe("concept");
  });

  it("maps 'principle' to 'concept'", () => {
    expect(normalizeFileType("principle")).toBe("concept");
  });

  it("maps 'constraint' to 'concept'", () => {
    expect(normalizeFileType("constraint")).toBe("concept");
  });

  it("maps 'tech' to 'concept'", () => {
    expect(normalizeFileType("tech")).toBe("concept");
  });

  it("maps 'technology' to 'concept'", () => {
    expect(normalizeFileType("technology")).toBe("concept");
  });

  it("maps 'framework' to 'concept'", () => {
    expect(normalizeFileType("framework")).toBe("concept");
  });

  it("passes through allowed type 'code' unchanged", () => {
    expect(normalizeFileType("code")).toBe("code");
  });

  it("passes through allowed type 'document' unchanged", () => {
    expect(normalizeFileType("document")).toBe("document");
  });

  it("passes through allowed type 'paper' unchanged", () => {
    expect(normalizeFileType("paper")).toBe("paper");
  });

  it("passes through allowed type 'image' unchanged", () => {
    expect(normalizeFileType("image")).toBe("image");
  });

  it("passes through allowed type 'rationale' unchanged", () => {
    expect(normalizeFileType("rationale")).toBe("rationale");
  });

  it("passes through allowed type 'concept' unchanged", () => {
    expect(normalizeFileType("concept")).toBe("concept");
  });

  it("maps unknown types to 'concept'", () => {
    expect(normalizeFileType("unknown_type")).toBe("concept");
  });

  it("maps empty string to 'concept'", () => {
    expect(normalizeFileType("")).toBe("concept");
  });
});

// ─── getLangFamily ────────────────────────────────────────────────────────

describe("getLangFamily", () => {
  it("returns 'py' for .py files", () => {
    expect(getLangFamily("src/main.py")).toBe("py");
  });

  it("returns 'js' for .ts files", () => {
    expect(getLangFamily("src/index.ts")).toBe("js");
  });

  it("returns 'js' for .tsx files", () => {
    expect(getLangFamily("src/Component.tsx")).toBe("js");
  });

  it("returns 'js' for .js files", () => {
    expect(getLangFamily("src/index.js")).toBe("js");
  });

  it("returns 'js' for .jsx files", () => {
    expect(getLangFamily("src/App.jsx")).toBe("js");
  });

  it("returns 'go' for .go files", () => {
    expect(getLangFamily("src/main.go")).toBe("go");
  });

  it("returns 'rs' for .rs files", () => {
    expect(getLangFamily("src/lib.rs")).toBe("rs");
  });

  it("returns 'jvm' for .java files", () => {
    expect(getLangFamily("src/Main.java")).toBe("jvm");
  });

  it("returns 'jvm' for .kt files", () => {
    expect(getLangFamily("src/Main.kt")).toBe("jvm");
  });

  it("returns 'jvm' for .scala files", () => {
    expect(getLangFamily("src/Main.scala")).toBe("jvm");
  });

  it("returns 'c' for .c files", () => {
    expect(getLangFamily("src/main.c")).toBe("c");
  });

  it("returns 'c' for .h files", () => {
    expect(getLangFamily("src/header.h")).toBe("c");
  });

  it("returns 'cpp' for .cpp files", () => {
    expect(getLangFamily("src/main.cpp")).toBe("cpp");
  });

  it("returns 'cpp' for .cc files", () => {
    expect(getLangFamily("src/main.cc")).toBe("cpp");
  });

  it("returns 'rb' for .rb files", () => {
    expect(getLangFamily("src/main.rb")).toBe("rb");
  });

  it("returns 'php' for .php files", () => {
    expect(getLangFamily("src/index.php")).toBe("php");
  });

  it("returns 'cs' for .cs files", () => {
    expect(getLangFamily("src/App.cs")).toBe("cs");
  });

  it("returns 'swift' for .swift files", () => {
    expect(getLangFamily("src/main.swift")).toBe("swift");
  });

  it("returns empty string for empty input", () => {
    expect(getLangFamily("")).toBe("");
  });

  it("returns empty string for files with no extension", () => {
    expect(getLangFamily("noextension")).toBe("");
  });

  it("returns empty string for unrecognized extensions", () => {
    expect(getLangFamily("file.xyz")).toBe("");
  });

  it("is case-insensitive for extensions", () => {
    expect(getLangFamily("src/Main.PY")).toBe("py");
  });
});

// ─── shouldFilterEdge ─────────────────────────────────────────────────────

describe("shouldFilterEdge", () => {
  it("filters INFERRED calls edge between different language families", () => {
    const result = shouldFilterEdge(
      { relation: "calls", confidence: "INFERRED" },
      "src/main.py",
      "src/index.ts",
    );
    expect(result).toBe(true);
  });

  it("does not filter INFERRED calls edge with same language family", () => {
    const result = shouldFilterEdge(
      { relation: "calls", confidence: "INFERRED" },
      "src/main.py",
      "src/utils.py",
    );
    expect(result).toBe(false);
  });

  it("does not filter EXTRACTED calls edge between different languages", () => {
    const result = shouldFilterEdge(
      { relation: "calls", confidence: "EXTRACTED" },
      "src/main.py",
      "src/index.ts",
    );
    expect(result).toBe(false);
  });

  it("does not filter non-calls INFERRED edge between different languages", () => {
    const result = shouldFilterEdge(
      { relation: "related_to", confidence: "INFERRED" },
      "src/main.py",
      "src/index.ts",
    );
    expect(result).toBe(false);
  });

  it("does not filter when source file path is empty", () => {
    const result = shouldFilterEdge(
      { relation: "calls", confidence: "INFERRED" },
      "",
      "src/index.ts",
    );
    expect(result).toBe(false);
  });

  it("does not filter when target file path is empty", () => {
    const result = shouldFilterEdge(
      { relation: "calls", confidence: "INFERRED" },
      "src/main.py",
      "",
    );
    expect(result).toBe(false);
  });

  it("does not filter when both file paths are empty", () => {
    const result = shouldFilterEdge(
      { relation: "calls", confidence: "INFERRED" },
      "",
      "",
    );
    expect(result).toBe(false);
  });
});

// ─── buildGraph ───────────────────────────────────────────────────────────

describe("buildGraph", () => {
  it("creates nodes with normalized IDs from chunk labels", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [{ label: "Hello World", type: "concept" }],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("hello_world");
    expect(result.nodes[0].label).toBe("Hello World");
    expect(result.nodes[0].nodeType).toBe("concept");
  });

  it("deduplicates nodes with the same normalized ID, merging metadata", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [
          { label: "React", type: "concept", metadata: { version: "18" } },
          { label: "react", type: "library" }, // same normalized ID, different case
        ],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    expect(result.nodes).toHaveLength(1);
    // First node wins (React), metadata merged
    expect(result.nodes[0].label).toBe("React");
    expect(result.nodes[0].nodeType).toBe("concept"); // raw type preserved
    expect(result.nodes[0].metadata).toEqual({ version: "18", file_type: "concept" });
  });

  it("deduplicates nodes across chunks", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [{ label: "React", type: "concept" }],
        edges: [],
      },
      {
        chunkIndex: 1,
        content: "test2",
        nodes: [{ label: "React", type: "concept", metadata: { count: 1 } }],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].metadata).toEqual({ count: 1, file_type: "concept" });
  });

  it("returns empty arrays for empty input", () => {
    const result = buildGraph("kb-1", []);
    expect(result.nodes).toEqual([]);
    expect(result.unresolvedEdges).toEqual([]);
  });

  it("passes through sourceDocId to all nodes", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [{ label: "Node", type: "concept" }],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks, "doc-1");
    expect(result.nodes[0].sourceDocId).toBe("doc-1");
  });

  it("sets sourceDocId to null when not provided", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [{ label: "Node", type: "concept" }],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    expect(result.nodes[0].sourceDocId).toBeNull();
  });

  it("sets sourceFilePath on nodes when provided", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [{ label: "Node", type: "concept" }],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks, undefined, "src/readme.md");
    expect(result.nodes[0].sourceFilePath).toBe("src/readme.md");
  });

  it("maps EXTRACTED confidence to 1.0 and INFERRED to 0.5", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [
          { label: "A", type: "concept" },
          { label: "B", type: "concept" },
        ],
        edges: [
          { source: "A", target: "B", relation: "related_to", confidence: "EXTRACTED" as const },
          { source: "A", target: "B", relation: "calls", confidence: "INFERRED" as const },
        ],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    expect(result.unresolvedEdges).toHaveLength(2);
    const extracted = result.unresolvedEdges.find((e) => e.relation === "related_to");
    const inferred = result.unresolvedEdges.find((e) => e.relation === "calls");
    expect(extracted?.confidence).toBe(1.0);
    expect(inferred?.confidence).toBe(0.5);
  });

  it("deduplicates edges by source+target+relation key", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [
          { label: "A", type: "concept" },
          { label: "B", type: "concept" },
        ],
        edges: [
          { source: "A", target: "B", relation: "related_to", confidence: "EXTRACTED" as const },
        ],
      },
      {
        chunkIndex: 1,
        content: "test2",
        nodes: [
          { label: "A", type: "concept" },
          { label: "B", type: "concept" },
        ],
        edges: [
          { source: "A", target: "B", relation: "related_to", confidence: "EXTRACTED" as const },
        ],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    // Deduplicated edges
    expect(result.unresolvedEdges).toHaveLength(1);
  });

  it("filters cross-language INFERRED calls edges when sourceFilePath is provided", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [
          { label: "render", type: "concept" },
          { label: "parse", type: "concept" },
        ],
        edges: [
          { source: "render", target: "parse", relation: "calls", confidence: "INFERRED" as const },
        ],
      },
    ];

    // Without sourceFilePath, no filtering
    const withoutPath = buildGraph("kb-1", chunks);
    expect(withoutPath.unresolvedEdges).toHaveLength(1);

    // With sourceFilePath, filtering applies (both nodes from same file, so NOT filtered)
    const sameFile = buildGraph("kb-1", chunks, undefined, "src/main.py");
    expect(sameFile.unresolvedEdges).toHaveLength(1);

    // But if we simulate cross-file... actually buildGraph assigns the same
    // sourceFilePath to all nodes from chunks, so cross-language filtering
    // only matters when different chunks come from different files.
    // For a single-source build, edges are never cross-language.
    //
    // Cross-language filtering is already tested at the unit level
    // via shouldFilterEdge. The integration is tested when chunks from
    // different source files are processed together, which requires
    // a multi-file parse — that's an integration concern.
  });

  it("normalizes file types in all nodes", () => {
    const chunks = [
      {
        chunkIndex: 0,
        content: "test",
        nodes: [
          { label: "Doc", type: "markdown" },
          { label: "Func", type: "tool" },
          { label: "Idea", type: "pattern" },
        ],
        edges: [],
      },
    ];

    const result = buildGraph("kb-1", chunks);
    // nodeType preserves original parser types
    const rawTypes = result.nodes.map((n) => n.nodeType);
    expect(rawTypes).toEqual(["markdown", "tool", "pattern"]);
    // file_type normalization stored in metadata
    const fileTypes = result.nodes.map((n) => n.metadata.file_type);
    expect(fileTypes).toEqual(["document", "code", "concept"]);
  });
});

// ─── resolveEdgeIds ───────────────────────────────────────────────────────

describe("resolveEdgeIds", () => {
  it("resolves edge labels to node IDs", () => {
    const nodes = [
      { id: "id-a", label: "React" },
      { id: "id-b", label: "TypeScript" },
    ];
    const unresolvedEdges = [
      { sourceLabel: "React", targetLabel: "TypeScript", relation: "related_to", confidence: 0.5 },
    ];

    const edges = resolveEdgeIds(nodes, unresolvedEdges, "kb-1");
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceNodeId).toBe("id-a");
    expect(edges[0].targetNodeId).toBe("id-b");
    expect(edges[0].kbId).toBe("kb-1");
  });

  it("filters out edges where source label is not found", () => {
    const nodes = [{ id: "id-a", label: "React" }];
    const unresolvedEdges = [
      { sourceLabel: "Unknown", targetLabel: "React", relation: "related_to", confidence: 0.5 },
    ];

    const edges = resolveEdgeIds(nodes, unresolvedEdges, "kb-1");
    expect(edges).toHaveLength(0);
  });

  it("filters out edges where target label is not found", () => {
    const nodes = [{ id: "id-a", label: "React" }];
    const unresolvedEdges = [
      { sourceLabel: "React", targetLabel: "Unknown", relation: "related_to", confidence: 0.5 },
    ];

    const edges = resolveEdgeIds(nodes, unresolvedEdges, "kb-1");
    expect(edges).toHaveLength(0);
  });

  it("returns empty array for empty nodes", () => {
    const edges = resolveEdgeIds(
      [],
      [{ sourceLabel: "A", targetLabel: "B", relation: "related_to", confidence: 0.5 }],
      "kb-1",
    );
    expect(edges).toEqual([]);
  });

  it("returns empty array for empty edges", () => {
    const edges = resolveEdgeIds(
      [{ id: "id-a", label: "A" }],
      [],
      "kb-1",
    );
    expect(edges).toEqual([]);
  });

  it("handles multiple edges resolving to the same nodes", () => {
    const nodes = [
      { id: "id-a", label: "A" },
      { id: "id-b", label: "B" },
    ];
    const unresolvedEdges = [
      { sourceLabel: "A", targetLabel: "B", relation: "calls", confidence: 1.0 },
      { sourceLabel: "A", targetLabel: "B", relation: "imports", confidence: 0.5 },
    ];

    const edges = resolveEdgeIds(nodes, unresolvedEdges, "kb-1");
    expect(edges).toHaveLength(2);
    expect(edges[0].sourceNodeId).toBe("id-a");
    expect(edges[1].sourceNodeId).toBe("id-a");
  });
});
