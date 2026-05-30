import { describe, it, expect } from "vitest";
import type { GraphNodeRecord, GraphEdgeRecord } from "../types";
import {
  buildSymbolIndex,
  resolveImportPath,
  collectExportFacts,
  resolveCrossFileEdges,
  resolveCrossFileCalls,
} from "../symbol-resolver";

// ─── test helpers ─────────────────────────────────────────────────────────

function makeNode(
  id: string,
  label: string,
  nodeType: string,
  filePath?: string,
): GraphNodeRecord {
  return {
    id,
    kbId: "kb-test",
    label,
    nodeType,
    sourceDocId: null,
    metadata: filePath ? { filePath } : {},
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

function makeEdge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  relation: string,
  confidence: number = 1.0,
): GraphEdgeRecord {
  return {
    id,
    kbId: "kb-test",
    sourceNodeId,
    targetNodeId,
    relation,
    confidence,
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

// ─── buildSymbolIndex ─────────────────────────────────────────────────────

describe("buildSymbolIndex", () => {
  it("builds index from multiple nodes across files", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("foo_a", "Foo", "class", "src/fileA.ts"),
      makeNode("bar", "bar", "function", "src/fileA.ts"),
      makeNode("foo_b", "Foo", "stub", "src/fileB.ts"),
    ];

    const index = buildSymbolIndex(nodes);

    expect(index.get("Foo")).toHaveLength(2);
    expect(index.get("Foo")?.[0].nodeId).toBe("foo_a");
    expect(index.get("Foo")?.[0].type).toBe("class");
    expect(index.get("Foo")?.[0].filePath).toBe("src/fileA.ts");
    expect(index.get("Foo")?.[1].nodeId).toBe("foo_b");
    expect(index.get("Foo")?.[1].type).toBe("stub");
    expect(index.get("Foo")?.[1].filePath).toBe("src/fileB.ts");
    expect(index.get("bar")).toHaveLength(1);
    expect(index.get("bar")?.[0].nodeId).toBe("bar");
  });

  it("returns empty map for empty input", () => {
    const index = buildSymbolIndex([]);
    expect(index.size).toBe(0);
  });

  it("handles nodes without filePath in metadata", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("n1", "X", "class"),
      makeNode("n2", "X", "function"),
    ];

    const index = buildSymbolIndex(nodes);

    expect(index.get("X")).toHaveLength(2);
    expect(index.get("X")?.[0].filePath).toBeUndefined();
    expect(index.get("X")?.[1].filePath).toBeUndefined();
  });

  it("handles single node", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("only", "OnlyNode", "concept", "src/test.ts"),
    ];

    const index = buildSymbolIndex(nodes);

    expect(index.size).toBe(1);
    expect(index.get("OnlyNode")?.[0].nodeId).toBe("only");
  });

  it("preserves label and type from node", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f1", "MyFunc", "function", "src/util.ts"),
    ];

    const index = buildSymbolIndex(nodes);

    const info = index.get("MyFunc")?.[0];
    expect(info?.label).toBe("MyFunc");
    expect(info?.type).toBe("function");
    expect(info?.filePath).toBe("src/util.ts");
  });
});

// ─── resolveImportPath ────────────────────────────────────────────────────

describe("resolveImportPath", () => {
  const allFiles = [
    "src/fileA.ts",
    "src/fileA.tsx",
    "src/fileB.ts",
    "src/sub/deep.tsx",
    "src/utils/index.ts",
    "src/utils/helper.js",
    "src/utils/helper.jsx",
    "lib/external.ts",
  ];

  it("resolves ./foo relative to source file (with extension)", () => {
    const result = resolveImportPath("./fileA", "src/fileB.ts", allFiles);
    expect(result).toBe("src/fileA.ts");
  });

  it("resolves ../foo going up a directory", () => {
    const result = resolveImportPath("../fileA", "src/sub/deep.tsx", allFiles);
    expect(result).toBe("src/fileA.ts");
  });

  it("resolves directory import to index.ts", () => {
    const result = resolveImportPath("./utils", "src/fileB.ts", allFiles);
    expect(result).toBe("src/utils/index.ts");
  });

  it("tries .ts extension before .tsx", () => {
    // Both src/fileA.ts and src/fileA.tsx exist — .ts should win
    const result = resolveImportPath("./fileA", "src/fileB.ts", allFiles);
    expect(result).toBe("src/fileA.ts");
  });

  it("falls back to .tsx when .ts is not available", () => {
    const files = ["src/fileA.tsx", "src/fileB.ts"];
    const result = resolveImportPath("./fileA", "src/fileB.ts", files);
    expect(result).toBe("src/fileA.tsx");
  });

  it("falls back to .js when no .ts or .tsx", () => {
    const files = ["src/helper.js", "src/main.ts"];
    const result = resolveImportPath("./helper", "src/main.ts", files);
    expect(result).toBe("src/helper.js");
  });

  it("falls back to .jsx when no .ts, .tsx, or .js", () => {
    const files = ["src/helper.jsx", "src/main.ts"];
    const result = resolveImportPath("./helper", "src/main.ts", files);
    expect(result).toBe("src/helper.jsx");
  });

  it("supports directory index with .js fallback", () => {
    const files = ["src/utils/index.js", "src/main.ts"];
    const result = resolveImportPath("./utils", "src/main.ts", files);
    expect(result).toBe("src/utils/index.js");
  });

  it("returns undefined for unresolvable path", () => {
    const result = resolveImportPath("./nonexistent", "src/fileB.ts", allFiles);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty allFilePaths", () => {
    const result = resolveImportPath("./foo", "src/bar.ts", []);
    expect(result).toBeUndefined();
  });

  it("handles path with no extension on source file", () => {
    const files = ["src/fileA.ts"];
    const result = resolveImportPath("./fileA", "src/fileB", files);
    expect(result).toBe("src/fileA.ts");
  });

  it("handles '.' as import path (directory index)", () => {
    const files = ["src/index.ts", "src/foo.ts"];
    const result = resolveImportPath(".", "src/foo.ts", files);
    expect(result).toBe("src/index.ts");
  });

  it("is case-sensitive for file paths", () => {
    const files = ["src/FileA.ts"];
    const result = resolveImportPath("./FileA", "src/fileB.ts", files);
    expect(result).toBe("src/FileA.ts");
  });

  it("does not match partial filename prefixes", () => {
    const files = ["src/fileA_extra.ts"];
    // fileA should not match fileA_extra
    const result = resolveImportPath("./fileA", "src/fileB.ts", files);
    expect(result).toBeUndefined();
  });
});

// ─── collectExportFacts ───────────────────────────────────────────────────

describe("collectExportFacts", () => {
  it("collects symbols contained by a file as exports", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
      makeNode("bar", "bar", "function", "src/fileA.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "foo", "contains"),
      makeEdge("e2", "f_a", "bar", "contains"),
    ];

    const facts = collectExportFacts(nodes, edges, "src/fileA.ts");

    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.symbolName).sort()).toEqual(["Foo", "bar"]);
    expect(facts[0].filePath).toBe("src/fileA.ts");
    expect(facts[0].isReExport).toBe(false);
  });

  it("excludes file nodes from export facts", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "f_a", "contains"),
    ];

    const facts = collectExportFacts(nodes, edges, "src/fileA.ts");
    expect(facts).toHaveLength(0);
  });

  it("returns empty array for file with no symbols", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
    ];

    const facts = collectExportFacts(nodes, [], "src/fileA.ts");
    expect(facts).toEqual([]);
  });

  it("returns empty array when file not found", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
    ];

    const facts = collectExportFacts(nodes, [], "src/other.ts");
    expect(facts).toEqual([]);
  });

  it("returns empty array for empty inputs", () => {
    const facts = collectExportFacts([], [], "src/fileA.ts");
    expect(facts).toEqual([]);
  });
});

// ─── resolveCrossFileEdges ────────────────────────────────────────────────

describe("resolveCrossFileEdges", () => {
  it("returns empty arrays for empty inputs", () => {
    const result = resolveCrossFileEdges([], [], []);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("returns unchanged when no imports exist", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
    ];
    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "foo", "contains"),
    ];

    const result = resolveCrossFileEdges(nodes, edges, ["src/fileA.ts"]);

    // Nodes unchanged, edges may have been augmented but no cross-file ones
    expect(result.nodes).toHaveLength(2);
    // Only the original contains edge
    expect(result.edges.filter((e) => e.relation !== "contains")).toHaveLength(0);
  });

  it("creates cross-file import edges when symbol is referenced across files", () => {
    // fileA.ts: defines Foo (class) and bar (function)
    // fileB.ts: imports from fileA, defines Baz extends Foo
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
      makeNode("bar", "bar", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("baz", "Baz", "class", "src/fileB.ts"),
      makeNode("mod_filea", "./fileA", "concept"),
    ];

    const edges: GraphEdgeRecord[] = [
      // fileA contains Foo and bar
      makeEdge("e1", "f_a", "foo", "contains"),
      makeEdge("e2", "f_a", "bar", "contains"),
      // fileB contains Baz
      makeEdge("e3", "f_b", "baz", "contains"),
      // fileB imports ./fileA
      makeEdge("e4", "f_b", "mod_filea", "imports"),
      // Baz inherits Foo (cross-file reference)
      makeEdge("e5", "baz", "foo", "inherits"),
    ];

    const filePaths = ["src/fileA.ts", "src/fileB.ts"];

    const result = resolveCrossFileEdges(nodes, edges, filePaths);

    // Original nodes preserved
    expect(result.nodes).toHaveLength(nodes.length);

    // Should have new cross-file import edge: fileB -> Foo
    const crossEdges = result.edges.filter(
      (e) => e.relation === "imports" && e.sourceNodeId === "f_b" && e.targetNodeId === "foo",
    );
    expect(crossEdges.length).toBeGreaterThanOrEqual(1);
    // Confidence should be EXTRACTED (1.0) since import evidence exists
    const importEdge = crossEdges[0];
    expect(importEdge.confidence).toBe(1.0);
  });

  it("does not create cross-file edges for same-file references", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
      makeNode("baz", "Baz", "class", "src/fileA.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "foo", "contains"),
      makeEdge("e2", "f_a", "baz", "contains"),
      makeEdge("e3", "baz", "foo", "inherits"),
    ];

    const filePaths = ["src/fileA.ts"];

    const result = resolveCrossFileEdges(nodes, edges, filePaths);

    // Should not create import edge since both are in same file
    const importEdges = result.edges.filter((e) => e.relation === "imports");
    expect(importEdges).toHaveLength(0);
  });

  it("handles multiple files with cross-references", () => {
    // fileA: defines Foo, Bar
    // fileB: imports fileA, uses Foo
    // fileC: imports fileA, uses Bar
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
      makeNode("bar", "bar", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("useFoo", "useFoo", "function", "src/fileB.ts"),
      makeNode("mod_a_b", "./fileA", "concept"),
      makeNode("f_c", "fileC.ts", "file", "src/fileC.ts"),
      makeNode("useBar", "useBar", "function", "src/fileC.ts"),
      makeNode("mod_a_c", "./fileA", "concept"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "foo", "contains"),
      makeEdge("e2", "f_a", "bar", "contains"),
      makeEdge("e3", "f_b", "useFoo", "contains"),
      makeEdge("e4", "f_b", "mod_a_b", "imports"),
      makeEdge("e5", "useFoo", "foo", "calls"),
      makeEdge("e6", "f_c", "useBar", "contains"),
      makeEdge("e7", "f_c", "mod_a_c", "imports"),
      makeEdge("e8", "useBar", "bar", "calls"),
    ];

    const filePaths = ["src/fileA.ts", "src/fileB.ts", "src/fileC.ts"];

    const result = resolveCrossFileEdges(nodes, edges, filePaths);

    // fileB -> Foo import edge
    const bToFoo = result.edges.filter(
      (e) => e.relation === "imports" && e.sourceNodeId === "f_b" && e.targetNodeId === "foo",
    );
    expect(bToFoo.length).toBeGreaterThanOrEqual(1);

    // fileC -> bar import edge
    const cToBar = result.edges.filter(
      (e) => e.relation === "imports" && e.sourceNodeId === "f_c" && e.targetNodeId === "bar",
    );
    expect(cToBar.length).toBeGreaterThanOrEqual(1);
  });

  it("handles unresolvable import paths gracefully", () => {
    // fileB imports from a path that can't be resolved
    const nodes: GraphNodeRecord[] = [
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("baz", "Baz", "class", "src/fileB.ts"),
      makeNode("mod_x", "nonexistent", "concept"),
      makeNode("foo_stub", "Foo", "stub", "src/fileB.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_b", "baz", "contains"),
      makeEdge("e2", "f_b", "mod_x", "imports"),
      makeEdge("e3", "baz", "foo_stub", "inherits"),
    ];

    const filePaths = ["src/fileB.ts"];

    const result = resolveCrossFileEdges(nodes, edges, filePaths);

    // Should not crash, and no cross-file edges should be created
    expect(result.nodes).toHaveLength(nodes.length);
    const newEdges = result.edges.filter((e) => !edges.includes(e));
    expect(newEdges).toHaveLength(0);
  });

  it("skips ambiguous names (same label in multiple files without import evidence)", () => {
    // Foo appears in both fileA and fileC, fileB imports fileA but Foo is in both
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo_a", "Foo", "class", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("baz", "Baz", "class", "src/fileB.ts"),
      makeNode("mod_a", "./fileA", "concept"),
      makeNode("f_c", "fileC.ts", "file", "src/fileC.ts"),
      makeNode("foo_c", "Foo", "class", "src/fileC.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "foo_a", "contains"),
      makeEdge("e2", "f_b", "baz", "contains"),
      makeEdge("e3", "f_b", "mod_a", "imports"),
      makeEdge("e4", "f_c", "foo_c", "contains"),
      makeEdge("e5", "baz", "foo_a", "inherits"),
    ];

    const filePaths = ["src/fileA.ts", "src/fileB.ts", "src/fileC.ts"];

    const result = resolveCrossFileEdges(nodes, edges, filePaths);

    // Should create edge to foo_a (fileA) since fileB imports fileA
    const crossEdges = result.edges.filter(
      (e) => e.relation === "imports" && e.sourceNodeId === "f_b",
    );
    // Should have edge to foo_a from fileA
    expect(crossEdges.some((e) => e.targetNodeId === "foo_a")).toBe(true);
  });
});

// ─── resolveCrossFileCalls ────────────────────────────────────────────────

describe("resolveCrossFileCalls", () => {
  it("returns empty array for empty inputs", () => {
    const result = resolveCrossFileCalls([], []);
    expect(result).toEqual([]);
  });

  it("returns empty array when there are no calls edges", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("foo", "Foo", "class", "src/fileA.ts"),
    ];
    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "foo", "contains"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);
    expect(result).toEqual([]);
  });

  it("skips calls where target is in the same file", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("caller", "caller", "function", "src/fileA.ts"),
      makeNode("callee", "callee", "function", "src/fileA.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "caller", "contains"),
      makeEdge("e2", "f_a", "callee", "contains"),
      makeEdge("e3", "caller", "callee", "calls"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);
    // Same-file calls should not create cross-file edges
    expect(result).toEqual([]);
  });

  it("resolves cross-file calls with import evidence (confidence 1.0)", () => {
    // fileA: defines helper()
    // fileB: imports fileA, calls helper()
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("helper", "helper", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("caller", "caller", "function", "src/fileB.ts"),
      makeNode("mod_a", "./fileA", "concept"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "helper", "contains"),
      makeEdge("e2", "f_b", "caller", "contains"),
      makeEdge("e3", "f_b", "mod_a", "imports"),
      makeEdge("e4", "caller", "helper", "calls"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);

    expect(result).toHaveLength(1);
    expect(result[0].sourceNodeId).toBe("caller");
    expect(result[0].targetNodeId).toBe("helper");
    expect(result[0].relation).toBe("calls");
    expect(result[0].confidence).toBe(1.0);
  });

  it("resolves cross-file calls without import evidence (confidence 0.8)", () => {
    // fileA: defines helper()
    // fileB: calls helper() but does NOT have an import edge to fileA
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("helper", "helper", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("caller", "caller", "function", "src/fileB.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "helper", "contains"),
      makeEdge("e2", "f_b", "caller", "contains"),
      makeEdge("e3", "caller", "helper", "calls"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);

    expect(result).toHaveLength(1);
    expect(result[0].sourceNodeId).toBe("caller");
    expect(result[0].targetNodeId).toBe("helper");
    expect(result[0].relation).toBe("calls");
    expect(result[0].confidence).toBe(0.8);
  });

  it("skips ambiguous names (matching multiple nodes in different files)", () => {
    // helper defined in both fileA and fileC, fileB doesn't import either
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("helper_a", "helper", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("caller", "caller", "function", "src/fileB.ts"),
      makeNode("f_c", "fileC.ts", "file", "src/fileC.ts"),
      makeNode("helper_c", "helper", "function", "src/fileC.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "helper_a", "contains"),
      makeEdge("e2", "f_b", "caller", "contains"),
      makeEdge("e3", "f_c", "helper_c", "contains"),
      makeEdge("e4", "caller", "helper_a", "calls"), // ambiguous: which helper?
    ];

    const result = resolveCrossFileCalls(nodes, edges);
    // Should skip ambiguous names with no import evidence
    expect(result).toEqual([]);
  });

  it("resolves ambiguous name with import evidence (prefer imported file)", () => {
    // helper defined in both fileA and fileC
    // fileB imports fileA, so helper in fileA should be preferred
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("helper_a", "helper", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("caller", "caller", "function", "src/fileB.ts"),
      makeNode("mod_a", "./fileA", "concept"),
      makeNode("f_c", "fileC.ts", "file", "src/fileC.ts"),
      makeNode("helper_c", "helper", "function", "src/fileC.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "helper_a", "contains"),
      makeEdge("e2", "f_b", "caller", "contains"),
      makeEdge("e3", "f_b", "mod_a", "imports"),
      makeEdge("e4", "f_c", "helper_c", "contains"),
      makeEdge("e5", "caller", "helper_a", "calls"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);

    // Should resolve to helper_a (fileA) because fileB imports fileA
    expect(result).toHaveLength(1);
    expect(result[0].targetNodeId).toBe("helper_a");
    expect(result[0].confidence).toBe(1.0);
  });

  it("returns empty for calls edges referencing non-existent targets", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("caller", "caller", "function", "src/fileB.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_b", "caller", "contains"),
      makeEdge("e2", "caller", "nonexistent", "calls"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);
    expect(result).toEqual([]);
  });

  it("only processes edges with relation 'calls'", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode("f_a", "fileA.ts", "file", "src/fileA.ts"),
      makeNode("target", "target", "function", "src/fileA.ts"),
      makeNode("f_b", "fileB.ts", "file", "src/fileB.ts"),
      makeNode("src", "src", "function", "src/fileB.ts"),
    ];

    const edges: GraphEdgeRecord[] = [
      makeEdge("e1", "f_a", "target", "contains"),
      makeEdge("e2", "f_b", "src", "contains"),
      makeEdge("e3", "src", "target", "inherits"), // not a 'calls' edge
      makeEdge("e4", "src", "target", "calls"),
    ];

    const result = resolveCrossFileCalls(nodes, edges);
    // Should only produce one output for the 'calls' edge
    expect(result).toHaveLength(1);
    expect(result[0].relation).toBe("calls");
  });
});
