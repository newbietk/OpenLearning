import { describe, it, expect } from "vitest";
import { exportGraphJson, generateReport } from "../export";
import type { GraphNodeRecord, GraphEdgeRecord } from "../types";

// ─── helpers ──────────────────────────────────────────────────────────────

function makeNode(
  overrides: Partial<GraphNodeRecord> & { id: string; label: string },
): GraphNodeRecord {
  return {
    kbId: "kb-1",
    nodeType: "concept",
    sourceDocId: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEdge(
  overrides: Partial<GraphEdgeRecord> & {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
  },
): GraphEdgeRecord {
  return {
    kbId: "kb-1",
    relation: "related_to",
    confidence: 0.5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── exportGraphJson ─────────────────────────────────────────────────────

describe("exportGraphJson", () => {
  it("returns a structure with nodes, links, and graph fields", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
    ];
    const edges: GraphEdgeRecord[] = [];

    const result = exportGraphJson(nodes, edges);

    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("links");
    expect(result).toHaveProperty("graph");
  });

  it("returns correct node_count and edge_count in graph field", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "Node.js" }),
    ];
    const edge = makeEdge({
      id: "e1",
      sourceNodeId: "n1",
      targetNodeId: "n2",
    });
    const edges: GraphEdgeRecord[] = [edge];

    const result = exportGraphJson(nodes, edges);

    expect(result.graph).toMatchObject({ node_count: 2, edge_count: 1 });
  });

  it("returns empty graph fields for empty nodes and edges", () => {
    const result = exportGraphJson([], []);

    expect(result.nodes).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.graph).toMatchObject({ node_count: 0, edge_count: 0 });
  });

  it("maps node fields correctly: id, label, file_type, source_file, metadata", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({
        id: "n1",
        label: "React",
        nodeType: "concept",
        metadata: { file_type: "markdown", source_file: "docs/react.md", extra: 42 },
      }),
    ];

    const result = exportGraphJson(nodes, []);

    const node = result.nodes[0] as Record<string, unknown>;
    expect(node.id).toBe("n1");
    expect(node.label).toBe("React");
    expect(node.file_type).toBe("markdown");
    expect(node.source_file).toBe("docs/react.md");
    expect(node.metadata).toEqual({ file_type: "markdown", source_file: "docs/react.md", extra: 42 });
  });

  it("handles nodes with no file_type in metadata gracefully", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React", metadata: { version: "18" } }),
    ];

    const result = exportGraphJson(nodes, []);

    const node = result.nodes[0] as Record<string, unknown>;
    expect(node.file_type).toBeUndefined();
    expect(node.source_file).toBeUndefined();
    expect(node.metadata).toEqual({ version: "18" });
  });

  it("maps link fields with source/target using node labels for D3 compat", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "Node.js" }),
    ];
    const edges: GraphEdgeRecord[] = [
      makeEdge({
        id: "e1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
        relation: "depends_on",
        confidence: 0.95,
      }),
    ];

    const result = exportGraphJson(nodes, edges);

    const link = result.links[0] as Record<string, unknown>;
    expect(link.source).toBe("React");
    expect(link.target).toBe("Node.js");
    expect(link.relation).toBe("depends_on");
    expect(link.confidence).toBe(0.95);
  });

  it("resolves source and target labels using a lookup from nodes", () => {
    // Node "n2" appears first but edge references "n1"→"n2"
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n2", label: "Babel" }),
      makeNode({ id: "n1", label: "Alpha" }),
    ];
    const edges: GraphEdgeRecord[] = [
      makeEdge({
        id: "e1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
      }),
    ];

    const result = exportGraphJson(nodes, edges);

    const link = result.links[0] as Record<string, unknown>;
    expect(link.source).toBe("Alpha");
    expect(link.target).toBe("Babel");
  });

  it("includes community on nodes when communities map is provided", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "Angular" }),
    ];
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1"]);
    communities.set(1, ["n2"]);

    const result = exportGraphJson(nodes, [], communities);

    const node1 = result.nodes[0] as Record<string, unknown>;
    const node2 = result.nodes[1] as Record<string, unknown>;
    expect(node1.community).toBe(0);
    expect(node2.community).toBe(1);
  });

  it("omits community from nodes when communities map is not provided", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
    ];

    const result = exportGraphJson(nodes, []);

    const node = result.nodes[0] as Record<string, unknown>;
    expect(node).not.toHaveProperty("community");
  });

  it("handles node IDs not present in communities map (community undefined)", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "Vue" }),
    ];
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1"]); // n2 not in any community

    const result = exportGraphJson(nodes, [], communities);

    const node1 = result.nodes[0] as Record<string, unknown>;
    const node2 = result.nodes[1] as Record<string, unknown>;
    expect(node1.community).toBe(0);
    expect(node2).not.toHaveProperty("community");
  });

  it("includes modularity in graph field when cohesionScores is provided", () => {
    const cohesionScores = new Map<number, number>();
    cohesionScores.set(0, 0.85);
    cohesionScores.set(1, 0.32);

    const result = exportGraphJson([], [], undefined, cohesionScores);

    expect(result.graph).toHaveProperty("modularity");
    expect(result.graph.modularity).toBe(0.85); // max score
  });

  it("omits modularity when cohesionScores is not provided", () => {
    const result = exportGraphJson([], []);

    expect(result.graph).not.toHaveProperty("modularity");
  });

  it("handles empty communities map", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
    ];
    const communities = new Map<number, string[]>();

    const result = exportGraphJson(nodes, [], communities);

    // Should not crash; community not set on any node
    const node = result.nodes[0] as Record<string, unknown>;
    expect(node).not.toHaveProperty("community");
  });

  it("handles empty cohesionScores map", () => {
    const cohesionScores = new Map<number, number>();

    const result = exportGraphJson([], [], undefined, cohesionScores);

    expect(result.graph).not.toHaveProperty("modularity");
  });

  it("returns communities array in graph field when communities are provided", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3"]);

    const result = exportGraphJson([], [], communities);

    expect(result.graph).toHaveProperty("communities");
    expect(result.graph.communities).toHaveLength(2);
    // Check each community's members are present
    const commMembers = (result.graph.communities as Array<{ members: string[] }>).map(
      (c) => c.members.sort(),
    );
    expect(commMembers).toContainEqual(["n1", "n2"]);
    expect(commMembers).toContainEqual(["n3"]);
  });

  it("creates new objects and does not mutate inputs (immutability)", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React", metadata: { foo: "bar" } }),
    ];
    const edges: GraphEdgeRecord[] = [
      makeEdge({
        id: "e1",
        sourceNodeId: "n1",
        targetNodeId: "n1",
      }),
    ];

    const result = exportGraphJson(nodes, edges);

    // Mutating result should not affect inputs
    (result.nodes[0] as Record<string, unknown>).extra = "mutated";
    expect(nodes[0]).not.toHaveProperty("extra");

    // Self-loops (source === target) should still be exported for D3
    const link = result.links[0] as Record<string, unknown>;
    expect(link.source).toBe("React");
    expect(link.target).toBe("React");
  });

  it("handles nodes with special characters in labels (D3 compat)", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "C++" }),
      makeNode({ id: "n2", label: "Node.js" }),
    ];
    const edges: GraphEdgeRecord[] = [
      makeEdge({
        id: "e1",
        sourceNodeId: "n1",
        targetNodeId: "n2",
      }),
    ];

    const result = exportGraphJson(nodes, edges);

    const link = result.links[0] as Record<string, unknown>;
    expect(link.source).toBe("C++");
    expect(link.target).toBe("Node.js");
  });

  it("handles unicode labels including CJK and emoji", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "机器学习" }),
      makeNode({ id: "n2", label: "data processing" }),
    ];

    const result = exportGraphJson(nodes, []);

    const node1 = result.nodes[0] as Record<string, unknown>;
    expect(node1.label).toBe("机器学习");
  });
});

// ─── generateReport ──────────────────────────────────────────────────────

describe("generateReport", () => {
  const baseParams = {
    graphName: "Test Graph",
    nodeCount: 10,
    edgeCount: 25,
    communities: new Map<number, string[]>(),
    cohesionScores: new Map<number, number>(),
    communityLabels: new Map<number, string>(),
    godNodes: [] as Array<{ label: string; nodeType: string; degree: number }>,
    surprisingConnections: [] as Array<{
      from: string;
      to: string;
      relation: string;
      reason: string;
    }>,
    suggestedQuestions: [] as string[],
    detection: {
      totalFiles: 5,
      totalWords: 1200,
      byType: { markdown: 3, txt: 2 },
    },
    tokens: { input: 500, output: 300 },
  };

  it("returns a markdown string", () => {
    const report = generateReport(baseParams);

    expect(typeof report).toBe("string");
    // Should start with a heading
    expect(report).toMatch(/^# /);
  });

  it("includes the graph name as a top-level heading", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("# Test Graph");
  });

  it("includes an Overview section", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("## Overview");
    expect(report).toContain("10"); // nodeCount
    expect(report).toContain("25"); // edgeCount
    expect(report).toContain("5");  // totalFiles
  });

  it("includes God Nodes table when godNodes are provided", () => {
    const params = {
      ...baseParams,
      godNodes: [
        { label: "React", nodeType: "concept", degree: 15 },
        { label: "GraphExtractor", nodeType: "class", degree: 8 },
      ],
    };

    const report = generateReport(params);

    expect(report).toContain("## God Nodes");
    expect(report).toContain("React");
    expect(report).toContain("15");
    expect(report).toContain("GraphExtractor");
    expect(report).toContain("8");
    // Should have markdown table structure
    expect(report).toMatch(/\|.*Label.*\|.*Type.*\|.*Degree.*\|/);
  });

  it("shows 'None' when godNodes array is empty", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("## God Nodes");
    expect(report).toContain("None");
  });

  it("includes Communities table with cohesion scores when communities are provided", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3", "n4", "n5"]);

    const cohesionScores = new Map<number, number>();
    cohesionScores.set(0, 0.85);
    cohesionScores.set(1, 0.32);

    const communityLabels = new Map<number, string>();
    communityLabels.set(0, "Frontend");
    communityLabels.set(1, "Backend");

    const params = { ...baseParams, communities, cohesionScores, communityLabels };

    const report = generateReport(params);

    expect(report).toContain("## Communities");
    expect(report).toContain("Frontend");
    expect(report).toContain("0.85");
    expect(report).toContain("Backend");
    expect(report).toContain("0.32");
    // Check format: should show size
    expect(report).toContain("2"); // community 0 size
    expect(report).toContain("3"); // community 1 size
  });

  it("shows 'None' when communities map is empty", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("## Communities");
    expect(report).toContain("None");
  });

  it("handles missing cohesion scores for communities gracefully", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);

    const communityLabels = new Map<number, string>();
    communityLabels.set(0, "Core");

    const params = {
      ...baseParams,
      communities,
      communityLabels,
      // no cohesionScores for community 0
    };

    const report = generateReport(params);

    expect(report).toContain("Core");
    expect(report).toContain("N/A"); // No cohesion score available
  });

  it("sorts communities by size descending (largest first)", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3", "n4", "n5", "n6"]);
    communities.set(2, ["n7", "n8", "n9"]);

    const cohesionScores = new Map<number, number>();
    cohesionScores.set(0, 0.5);
    cohesionScores.set(1, 0.8);
    cohesionScores.set(2, 0.6);

    const communityLabels = new Map<number, string>();
    communityLabels.set(0, "Small");
    communityLabels.set(1, "Large");
    communityLabels.set(2, "Medium");

    const params = { ...baseParams, communities, cohesionScores, communityLabels };
    const report = generateReport(params);

    // Find positions of each community label in the report
    const largePos = report.indexOf("Large");
    const mediumPos = report.indexOf("Medium");
    const smallPos = report.indexOf("Small");

    expect(largePos).toBeLessThan(mediumPos);
    expect(mediumPos).toBeLessThan(smallPos);
  });

  it("omits single-node communities from the Communities table", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3"]); // single node — should be omitted

    const communityLabels = new Map<number, string>();
    communityLabels.set(0, "Connected");
    communityLabels.set(1, "Singleton");

    const params = { ...baseParams, communities, communityLabels };
    const report = generateReport(params);

    expect(report).toContain("Connected");
    expect(report).not.toContain("Singleton");
  });

  it("shows omitted single-node community count", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3"]);
    communities.set(2, ["n4"]);
    communities.set(3, ["n5"]);

    const params = { ...baseParams, communities };
    const report = generateReport(params);

    expect(report).toContain("(3 single-node communities omitted)");
  });

  it("shows singular form when exactly one single-node community is omitted", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3"]);

    const params = { ...baseParams, communities };
    const report = generateReport(params);

    expect(report).toContain("(1 single-node community omitted)");
  });

  it("shows None and omitted count when all communities are single-node", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1"]);
    communities.set(1, ["n2"]);
    communities.set(2, ["n3"]);

    const params = { ...baseParams, communities };
    const report = generateReport(params);

    expect(report).toContain("None");
    expect(report).toContain("(3 single-node communities omitted)");
  });

  it("does not show omitted message when there are no single-node communities", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3", "n4"]);

    const params = { ...baseParams, communities };
    const report = generateReport(params);

    expect(report).not.toContain("omitted");
  });

  it("includes Surprising Connections section when provided", () => {
    const params = {
      ...baseParams,
      surprisingConnections: [
        {
          from: "React",
          to: "SQLite",
          relation: "bundled_with",
          reason: "Unexpected coupling between UI library and database",
        },
      ],
    };

    const report = generateReport(params);

    expect(report).toContain("## Surprising Connections");
    expect(report).toContain("React");
    expect(report).toContain("SQLite");
    expect(report).toContain("bundled_with");
    expect(report).toContain("Unexpected coupling");
  });

  it("shows 'None' when surprisingConnections array is empty", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("## Surprising Connections");
    expect(report).toContain("None");
  });

  it("includes Suggested Questions as bullet list when provided", () => {
    const params = {
      ...baseParams,
      suggestedQuestions: [
        "What is the relationship between React and Node.js?",
        "How does the GraphExtractor work?",
      ],
    };

    const report = generateReport(params);

    expect(report).toContain("## Suggested Questions");
    expect(report).toContain("- What is the relationship between React and Node.js?");
    expect(report).toContain("- How does the GraphExtractor work?");
  });

  it("shows 'None' when suggestedQuestions array is empty", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("## Suggested Questions");
    expect(report).toContain("None");
  });

  it("includes Graph Statistics section", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("## Graph Statistics");
    expect(report).toContain("Total Files");
    expect(report).toContain("Total Words");
    expect(report).toContain("5");
    expect(report).toContain("1200");
  });

  it("includes detection by type breakdown in Graph Statistics", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("**markdown:** 3");
    expect(report).toContain("**txt:** 2");
  });

  it("includes token usage in Graph Statistics", () => {
    const report = generateReport(baseParams);

    expect(report).toContain("Input Tokens");
    expect(report).toContain("500");
    expect(report).toContain("Output Tokens");
    expect(report).toContain("300");
  });

  it("handles all sections together in a long report", () => {
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1"]);

    const cohesionScores = new Map<number, number>();
    cohesionScores.set(0, 0.92);

    const communityLabels = new Map<number, string>();
    communityLabels.set(0, "Core");

    const params = {
      graphName: "Complete Test Graph",
      nodeCount: 42,
      edgeCount: 128,
      communities,
      cohesionScores,
      communityLabels,
      godNodes: [{ label: "Main", nodeType: "module", degree: 20 }],
      surprisingConnections: [
        { from: "A", to: "B", relation: "imports", reason: "Circular dependency" },
      ],
      suggestedQuestions: ["What is A?"],
      detection: { totalFiles: 10, totalWords: 5000, byType: { ts: 7, md: 3 } },
      tokens: { input: 1200, output: 800 },
    };

    const report = generateReport(params);

    // Every major section should exist
    expect(report).toContain("# Complete Test Graph");
    expect(report).toContain("## Overview");
    expect(report).toContain("## God Nodes");
    expect(report).toContain("## Communities");
    expect(report).toContain("## Surprising Connections");
    expect(report).toContain("## Suggested Questions");
    expect(report).toContain("## Graph Statistics");
  });

  it("does not include empty or undefined strings in output", () => {
    const report = generateReport(baseParams);

    // No literal "undefined" or "null" should appear
    expect(report).not.toContain("undefined");
    expect(report).not.toContain("null");
  });
});
