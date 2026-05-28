import { describe, it, expect, beforeAll } from "vitest";

function makeMockDb() {
  const nodes = [
    { id: "n1", label: "React", nodeType: "concept", kbId: "kb1", sourceDocId: null, metadata: {}, createdAt: "" },
    { id: "n2", label: "TypeScript", nodeType: "concept", kbId: "kb1", sourceDocId: null, metadata: {}, createdAt: "" },
    { id: "n3", label: "useState", nodeType: "function", kbId: "kb1", sourceDocId: null, metadata: {}, createdAt: "" },
  ];
  const edges = [
    { id: "e1", sourceNodeId: "n1", targetNodeId: "n2", relation: "related_to", confidence: 1.0, kbId: "kb1", createdAt: "" },
    { id: "e2", sourceNodeId: "n2", targetNodeId: "n3", relation: "imports", confidence: 1.0, kbId: "kb1", createdAt: "" },
  ];

  return {
    graphNode: {
      findByKbId: () => nodes,
      findByLabel: (_kbId: string, label: string) => nodes.find((n) => n.label === label) ?? null,
      findNeighbors: (nodeId: string) => {
        const neighborIds = edges
          .filter((e) => e.sourceNodeId === nodeId)
          .map((e) => e.targetNodeId);
        return nodes.filter((n) => neighborIds.includes(n.id));
      },
      search: () => nodes.filter((n) => n.label.toLowerCase().includes("react")),
      batchCreate: () => {},
      deleteByKbId: () => {},
    },
    graphEdge: {
      findByKbId: () => edges,
      findByNode: (nodeId: string) => edges.filter((e) => e.sourceNodeId === nodeId),
      batchCreate: () => {},
      deleteByKbId: () => {},
    },
    document: {
      findByKbId: () => [{ id: "d1", title: "React Docs", kbId: "kb1", sourceType: "link" as const, sourceUrl: "https://react.dev", filePath: null, fileSize: null, status: "done" as const, errorMessage: null, parsedAt: null, createdAt: "" }],
      findById: () => null,
      create: () => ({ id: "", kbId: "", title: "", sourceType: "" as const, sourceUrl: null, filePath: null, fileSize: null, status: "pending" as const, errorMessage: null, parsedAt: null, createdAt: "" }),
      updateStatus: () => {},
      delete: () => {},
    },
    documentChunk: { findByDocId: () => [], batchCreate: () => {}, deleteByDocId: () => {} },
  };
}

describe("tools", () => {
  let createTools: typeof import("../tools/index").createTools;

  beforeAll(async () => {
    const mod = await import("../tools/index");
    createTools = mod.createTools;
  });

  it("search_knowledge returns matching nodes", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("search_knowledge", { query: "React" }, "tc1");
    expect(result.toolCallId).toBe("tc1");
    const parsed = JSON.parse(result.output);
    expect(parsed.nodes.some((n: any) => n.label === "React")).toBe(true);
  });

  it("get_node finds by label", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_node", { label: "React" }, "tc2");
    const parsed = JSON.parse(result.output);
    expect(parsed.label).toBe("React");
  });

  it("get_node returns error for missing node", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_node", { label: "NoSuchNode" }, "tc3");
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toBeDefined();
  });

  it("get_neighbors returns 1-hop subgraph", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_neighbors", { nodeLabel: "React" }, "tc4");
    const parsed = JSON.parse(result.output);
    expect(parsed.neighbors.length).toBeGreaterThan(0);
    expect(parsed.edges.length).toBeGreaterThan(0);
  });

  it("graph_stats returns counts", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("graph_stats", {}, "tc5");
    const parsed = JSON.parse(result.output);
    expect(parsed.nodeCount).toBe(3);
    expect(parsed.edgeCount).toBe(2);
  });

  it("god_nodes returns top nodes by degree", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("god_nodes", { limit: 2 }, "tc6");
    const parsed = JSON.parse(result.output);
    expect(parsed.length).toBeLessThanOrEqual(2);
  });

  it("shortest_path finds path between two nodes", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("shortest_path", { fromLabel: "React", toLabel: "useState" }, "tc7");
    const parsed = JSON.parse(result.output);
    expect(parsed.path).toBeDefined();
  });

  it("get_document finds by title", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_document", { title: "React" }, "tc8");
    const parsed = JSON.parse(result.output);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("unknown tool returns error", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("nonexistent_tool", {}, "tc9");
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toBeDefined();
  });

  it("definitions return all 8 tools", () => {
    const { definitions } = createTools(makeMockDb() as any, "kb1");
    expect(definitions.length).toBe(8);
    const names = definitions.map((d) => d.name);
    expect(names).toContain("search_knowledge");
    expect(names).toContain("get_node");
    expect(names).toContain("get_neighbors");
    expect(names).toContain("get_community");
    expect(names).toContain("god_nodes");
    expect(names).toContain("graph_stats");
    expect(names).toContain("shortest_path");
    expect(names).toContain("get_document");
  });
});
