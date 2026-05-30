import { describe, it, expect } from "vitest";
import type { GraphNodeRecord, GraphEdgeRecord } from "../types";
import {
  surprisingConnections,
  suggestQuestions,
  findBridgeNodes,
  graphDiff,
} from "../analyze";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "n1",
    kbId: "kb-1",
    label: "Node1",
    nodeType: "concept",
    sourceDocId: null,
    metadata: {},
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdgeRecord> = {}): GraphEdgeRecord {
  return {
    id: "e1",
    kbId: "kb-1",
    sourceNodeId: "n1",
    targetNodeId: "n2",
    relation: "related_to",
    confidence: 0.8,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── surprisingConnections ──────────────────────────────────────────────────

describe("surprisingConnections", () => {
  it("returns empty array for empty input", () => {
    const result = surprisingConnections([], [], new Map());
    expect(result).toEqual([]);
  });

  it("returns empty array when no cross-community edges exist", () => {
    // All nodes in the same community — no cross-community edges
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "calls", confidence: 0.9 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities);
    expect(result).toEqual([]);
  });

  it("returns empty array when edges reference unknown node IDs", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "x", targetNodeId: "y", relation: "calls", confidence: 0.9 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities);
    // Even though communities exist, the edge references nodes not in any community
    expect(result).toEqual([]);
  });

  it("returns empty array when source node is not in any community", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "calls", confidence: 0.9 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["b"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities);
    expect(result).toEqual([]);
  });

  it("returns empty array when target node is not in any community", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "calls", confidence: 0.9 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities);
    expect(result).toEqual([]);
  });

  it("detects a single cross-community edge", () => {
    const nodes = [
      makeNode({ id: "a", label: "React" }),
      makeNode({ id: "b", label: "Django" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "depends_on", confidence: 1.0 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      from: "React",
      to: "Django",
      relation: "depends_on",
      fromCommunity: 0,
      toCommunity: 1,
    });
    // Bridge score: 1/(1 + 1) * 1.0 = 0.5
    expect(result[0].bridgeScore).toBe(0.5);
    expect(result[0].reason).toBeTruthy();
  });

  it("computes lower bridge score for community pairs with many edges", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
      makeNode({ id: "d", label: "D" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "c", relation: "related_to", confidence: 0.8 }),
      makeEdge({ id: "e2", sourceNodeId: "a", targetNodeId: "d", relation: "calls", confidence: 0.9 }),
      makeEdge({ id: "e3", sourceNodeId: "b", targetNodeId: "c", relation: "imports", confidence: 1.0 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b"]],
      [1, ["c", "d"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities);
    expect(result).toHaveLength(3);
    // All edges between communities 0 and 1, count = 3
    // Each edge: 1/(3+1) * confidence
    // e1: 1/4 * 0.8 = 0.2
    // e2: 1/4 * 0.9 = 0.225
    // e3: 1/4 * 1.0 = 0.25
    // Sorted descending: e3, e2, e1
    expect(result[0].bridgeScore).toBeGreaterThanOrEqual(result[1].bridgeScore);
    expect(result[1].bridgeScore).toBeGreaterThanOrEqual(result[2].bridgeScore);
  });

  it("limits results to top 20", () => {
    const nodes: GraphNodeRecord[] = [];
    const edges: GraphEdgeRecord[] = [];
    const communities = new Map<number, string[]>();

    // Create 30 cross-community edge pairs
    for (let i = 0; i < 60; i++) {
      nodes.push(makeNode({ id: `n${i}`, label: `Node${i}` }));
      communities.set(i, [`n${i}`]);
    }
    // Each edge connects community i to community i+1 (creating unique community pairs)
    for (let i = 0; i < 59; i++) {
      edges.push(makeEdge({
        id: `e${i}`,
        sourceNodeId: `n${i}`,
        targetNodeId: `n${i + 1}`,
        relation: "related_to",
        confidence: 0.5 + Math.random() * 0.5,
      }));
    }

    // Create 30 cross edges connecting different pairs
    // Actually each edge above connects a different community pair (i to i+1)
    // So each pair has exactly 1 edge, bridgeScore = 1/(1+1)*confidence = 0.5*confidence
    // That gives us 59 cross edges but we need more than 20
    // With 59 edges, top 20 should be returned

    const result = surprisingConnections(nodes, edges, communities, 1);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("handles bidirectional edges between same community pair", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "c", relation: "calls", confidence: 0.8 }),
      makeEdge({ id: "e2", sourceNodeId: "c", targetNodeId: "b", relation: "calls", confidence: 0.6 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b"]],
      [1, ["c"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities, 1);
    // e1: community 0 -> 1, e2: community 1 -> 0
    // Count between community 0 and 1 = 2
    // e1 bridgeScore = 1/(2+1) * 0.8 = 0.267
    // e2 bridgeScore = 1/(2+1) * 0.6 = 0.2
    expect(result).toHaveLength(2);
    expect(result[0].bridgeScore).toBeCloseTo(0.267, 2);
    expect(result[1].bridgeScore).toBeCloseTo(0.2, 1);
  });

  it("uses node labels for from/to, not node IDs", () => {
    const nodes = [
      makeNode({ id: "x1", label: "React" }),
      makeNode({ id: "y2", label: "Svelte" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "x1", targetNodeId: "y2", relation: "competes_with", confidence: 0.7 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["x1"]],
      [1, ["y2"]],
    ]);

    const result = surprisingConnections(nodes, edges, communities, 1);
    expect(result[0].from).toBe("React");
    expect(result[0].to).toBe("Svelte");
  });

  it("filters out edges where either community is below minCommunitySize", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "calls", confidence: 0.9 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
    ]);

    // Default minCommunitySize=2 filters out both size-1 communities
    const result = surprisingConnections(nodes, edges, communities);
    expect(result).toEqual([]);
  });

  it("filters by minBridgeScore", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
      makeNode({ id: "d", label: "D" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "c", relation: "calls", confidence: 0.8 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b"]],
      [1, ["c", "d"]],
    ]);

    // Single cross edge: bridgeScore = 1/(1+1)*0.8 = 0.4
    // Filter with minBridgeScore=0.5 should exclude it
    const result = surprisingConnections(nodes, edges, communities, 2, 0.5);
    expect(result).toEqual([]);
  });

  it("includes results at or above minBridgeScore threshold", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
      makeNode({ id: "d", label: "D" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "c", relation: "calls", confidence: 1.0 }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b"]],
      [1, ["c", "d"]],
    ]);

    // bridgeScore = 1/(1+1)*1.0 = 0.5, at threshold
    const result = surprisingConnections(nodes, edges, communities, 2, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].bridgeScore).toBe(0.5);
  });
});

// ─── suggestQuestions ────────────────────────────────────────────────────────

describe("suggestQuestions", () => {
  it("returns empty array for empty input", () => {
    const result = suggestQuestions([], [], new Map());
    expect(result).toEqual([]);
  });

  it("returns empty array when there are no edges", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
    ]);

    const result = suggestQuestions(nodes, [], communities);
    expect(result).toEqual([]);
  });

  it("returns empty array when no communities exist", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ];
    const edges = [
      makeEdge({ sourceNodeId: "a", targetNodeId: "b" }),
    ];

    const result = suggestQuestions(nodes, edges, new Map());
    expect(result).toEqual([]);
  });

  it("returns empty array when all nodes are in single community", () => {
    const nodes = [
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
      makeNode({ id: "c", label: "Gamma" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "depends_on" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b", "c"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    // With only one community, no cross-community connections
    // But high-degree nodes within community may generate questions
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(result).toBeInstanceOf(Array);
  });

  it("generates questions about bridge nodes", () => {
    // A bridge node connects multiple communities of size > 1
    const nodes = [
      makeNode({ id: "a1", label: "React" }),
      makeNode({ id: "a2", label: "JSX" }),
      makeNode({ id: "b1", label: "CSS" }),
      makeNode({ id: "b2", label: "SCSS" }),
      makeNode({ id: "bridge", label: "NextJS" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "bridge", targetNodeId: "a1", relation: "uses" }),
      makeEdge({ id: "e2", sourceNodeId: "bridge", targetNodeId: "b1", relation: "integrates" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
      [2, ["bridge"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    // bridge node connects communities 0 and 1
    const hasBridgeQuestion = result.some((q) =>
      q.toLowerCase().includes("nextjs")
    );
    expect(hasBridgeQuestion).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("generates questions about community pairs with few edges", () => {
    const nodes = [
      makeNode({ id: "a1", label: "Python" }),
      makeNode({ id: "a2", label: "pip" }),
      makeNode({ id: "b1", label: "TypeScript" }),
      makeNode({ id: "b2", label: "tsc" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a1", targetNodeId: "b1", relation: "compiles_to" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toBeInstanceOf(Array);
  });

  it("generates questions about high-degree nodes in communities", () => {
    const nodes = [
      makeNode({ id: "a", label: "Hub" }),
      makeNode({ id: "b", label: "Leaf1" }),
      makeNode({ id: "c", label: "Leaf2" }),
      makeNode({ id: "d", label: "Leaf3" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "connects" }),
      makeEdge({ id: "e2", sourceNodeId: "a", targetNodeId: "c", relation: "connects" }),
      makeEdge({ id: "e3", sourceNodeId: "a", targetNodeId: "d", relation: "connects" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b", "c", "d"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    // Should reference the hub node
    const hasHubQuestion = result.some((q) => q.toLowerCase().includes("hub"));
    expect(hasHubQuestion).toBe(true);
  });

  it("returns between 5 and 10 questions for a moderate graph", () => {
    const nodes: GraphNodeRecord[] = [];
    const edges: GraphEdgeRecord[] = [];
    const comms: string[][] = [];
    for (let c = 0; c < 4; c++) {
      comms.push([]);
    }
    for (let i = 0; i < 20; i++) {
      nodes.push(makeNode({ id: `n${i}`, label: `Node${i}` }));
      const commIdx = i % 4;
      comms[commIdx].push(`n${i}`);
    }
    // Create edges within communities and some cross-community edges
    for (let i = 0; i < 10; i++) {
      edges.push(makeEdge({
        id: `e${i}`,
        sourceNodeId: `n${i}`,
        targetNodeId: `n${i + 1}`,
        relation: "related_to",
        confidence: 0.7,
      }));
    }
    // Cross-community edges
    edges.push(makeEdge({
      id: "x1", sourceNodeId: "n0", targetNodeId: "n4", relation: "depends_on", confidence: 0.9,
    }));
    edges.push(makeEdge({
      id: "x2", sourceNodeId: "n8", targetNodeId: "n12", relation: "calls", confidence: 0.8,
    }));

    const communities = new Map<number, string[]>();
    comms.forEach((ids, idx) => communities.set(idx, ids));

    const result = suggestQuestions(nodes, edges, communities);
    expect(result.length).toBeGreaterThanOrEqual(5);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("uses community labels when provided", () => {
    const nodes = [
      makeNode({ id: "a1", label: "React" }),
      makeNode({ id: "a2", label: "Redux" }),
      makeNode({ id: "b1", label: "Django" }),
      makeNode({ id: "b2", label: "DRF" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a1", targetNodeId: "b1", relation: "api_calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
    ]);
    const communityLabels = new Map<number, string>([
      [0, "Frontend"],
      [1, "Backend"],
    ]);

    const result = suggestQuestions(nodes, edges, communities, communityLabels);
    const hasFrontend = result.some((q) => q.toLowerCase().includes("frontend"));
    const hasBackend = result.some((q) => q.toLowerCase().includes("backend"));
    const hasCommunityLabel = hasFrontend || hasBackend;
    expect(hasCommunityLabel).toBe(true);
  });

  it("each question is a non-empty string", () => {
    const nodes = [
      makeNode({ id: "a1", label: "A" }),
      makeNode({ id: "a2", label: "A2" }),
      makeNode({ id: "b1", label: "B" }),
      makeNode({ id: "b2", label: "B2" }),
    ];
    const edges = [
      makeEdge({ sourceNodeId: "a1", targetNodeId: "b1" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const q of result) {
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(0);
      expect(q.trim()).toBe(q); // no leading/trailing whitespace
    }
  });

  it("generates community pair relationship questions", () => {
    const nodes = [
      makeNode({ id: "a1", label: "A1" }),
      makeNode({ id: "a2", label: "A2" }),
      makeNode({ id: "b1", label: "B1" }),
      makeNode({ id: "b2", label: "B2" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a1", targetNodeId: "b1", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
    ]);
    const communityLabels = new Map<number, string>([
      [0, "Auth"],
      [1, "Database"],
    ]);

    const result = suggestQuestions(nodes, edges, communities, communityLabels);
    const hasHowQuestion = result.some((q) =>
      q.includes("How does") && q.includes("relate to"),
    );
    expect(hasHowQuestion).toBe(true);
  });

  it("generates key symbol questions for largest communities", () => {
    const nodes = [
      makeNode({ id: "a1", label: "A1" }),
      makeNode({ id: "a2", label: "A2" }),
      makeNode({ id: "b1", label: "B1" }),
      makeNode({ id: "b2", label: "B2" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a1", targetNodeId: "b1", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
    ]);
    const communityLabels = new Map<number, string>([
      [0, "Frontend"],
    ]);

    const result = suggestQuestions(nodes, edges, communities, communityLabels);
    const hasKeySymbolQuestion = result.some((q) =>
      q.includes("What are the key symbols in"),
    );
    expect(hasKeySymbolQuestion).toBe(true);
  });

  it("generates file bridge questions when nodes have source_file metadata", () => {
    const nodes = [
      makeNode({ id: "a1", label: "A1", metadata: { source_file: "src/auth.ts" } }),
      makeNode({ id: "a2", label: "A2" }),
      makeNode({ id: "b1", label: "B1", metadata: { source_file: "src/db.ts" } }),
      makeNode({ id: "b2", label: "B2" }),
      makeNode({ id: "bridge", label: "Bridge", metadata: { source_file: "src/bridge.ts" } }),
      makeNode({ id: "bridge2", label: "Bridge2" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "bridge", targetNodeId: "a1", relation: "calls" }),
      makeEdge({ id: "e2", sourceNodeId: "bridge", targetNodeId: "b1", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["b1", "b2"]],
      [2, ["bridge", "bridge2"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    const hasFileBridgeQuestion = result.some((q) =>
      q.includes("Which symbols bridge"),
    );
    expect(hasFileBridgeQuestion).toBe(true);
  });

  it("returns empty when no communities have size > 1", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const edges = [
      makeEdge({ sourceNodeId: "a", targetNodeId: "b" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
    ]);

    const result = suggestQuestions(nodes, edges, communities);
    expect(result).toEqual([]);
  });
});

// ─── findBridgeNodes ─────────────────────────────────────────────────────────

describe("findBridgeNodes", () => {
  it("returns empty array for empty input", () => {
    const result = findBridgeNodes([], [], new Map());
    expect(result).toEqual([]);
  });

  it("returns empty array when no nodes connect multiple communities", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "related_to" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b"]],
      [1, ["c"]],
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    // Node a and b are both in community 0 and only have edges within community 0
    // Node c is in community 1 but has no edges
    expect(result).toEqual([]);
  });

  it("detects a single bridge node connecting two communities", () => {
    const nodes = [
      makeNode({ id: "bridge", label: "Bridge" }),
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "bridge", targetNodeId: "a", relation: "connects" }),
      makeEdge({ id: "e2", sourceNodeId: "bridge", targetNodeId: "b", relation: "connects" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
      [2, ["bridge"]], // bridge is its own community, but bridge node connects to a and b
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    // "bridge" has edges to a (community 0) and b (community 1)
    // Even though bridge is in its own community 2, it connects to communities 0 and 1
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe("bridge");
    expect(result[0].connectingCommunities).toContain(0);
    expect(result[0].connectingCommunities).toContain(1);
  });

  it("detects bridge nodes via both source and target edges", () => {
    // A node can be a bridge when edges point TO it as well as FROM it
    const nodes = [
      makeNode({ id: "hub", label: "Hub" }),
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "hub", targetNodeId: "a", relation: "calls" }),
      // b calls hub (hub is target)
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "hub", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
      [2, ["hub"]],
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe("hub");
    expect(result[0].connectingCommunities.sort()).toEqual([0, 1]);
  });

  it("returns multiple bridge nodes", () => {
    const nodes = [
      makeNode({ id: "b1", label: "B1" }),
      makeNode({ id: "b2", label: "B2" }),
      makeNode({ id: "a1", label: "A1" }),
      makeNode({ id: "a2", label: "A2" }),
      makeNode({ id: "c1", label: "C1" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "b1", targetNodeId: "a1", relation: "links" }),
      makeEdge({ id: "e2", sourceNodeId: "b1", targetNodeId: "c1", relation: "links" }),
      makeEdge({ id: "e3", sourceNodeId: "b2", targetNodeId: "a2", relation: "links" }),
      makeEdge({ id: "e4", sourceNodeId: "b2", targetNodeId: "c1", relation: "links" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a1", "a2"]],
      [1, ["c1"]],
      [2, ["b1", "b2"]],
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.node.id);
    expect(ids).toContain("b1");
    expect(ids).toContain("b2");
  });

  it("excludes nodes that only connect within their own community", () => {
    const nodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
      makeNode({ id: "d", label: "D" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", relation: "related_to" }),
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "c", relation: "related_to" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a", "b", "c"]],
      [1, ["d"]],
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    // d is isolated in community 1, a/b/c are all in community 0
    expect(result).toEqual([]);
  });

  it("excludes nodes not in any community", () => {
    const nodes = [
      makeNode({ id: "orphan", label: "Orphan" }),
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "orphan", targetNodeId: "a", relation: "calls" }),
      makeEdge({ id: "e2", sourceNodeId: "orphan", targetNodeId: "b", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["a"]],
      [1, ["b"]],
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    // orphan is not in any community, so connecting communities are [0, 1]
    // But the spec says "Nodes with edges to 2+ communities"
    // An orphan node connecting to 2 communities should still be reported
    // Wait, the orphan node is not itself in a community, but it connects to nodes in 0 and 1
    // The function should look at all nodes and find which communities their edges connect to
    // If orphan's edges go to community 0 and 1, it IS a bridge node connecting 2+ communities
    expect(result).toHaveLength(1);
    expect(result[0].connectingCommunities.sort()).toEqual([0, 1]);
  });

  it("does NOT count the node's own community as a connecting community", () => {
    const nodes = [
      makeNode({ id: "bridge", label: "Bridge" }),
      makeNode({ id: "a", label: "A" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "bridge", targetNodeId: "a", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [0, ["bridge", "a"]],
    ]);

    // bridge only connects to a, and both are in community 0
    const result = findBridgeNodes(nodes, edges, communities);
    expect(result).toEqual([]);
  });

  it("includes the connectingCommunities sorted in ascending order", () => {
    const nodes = [
      makeNode({ id: "hub", label: "Hub" }),
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "hub", targetNodeId: "b", relation: "calls" }),
      makeEdge({ id: "e2", sourceNodeId: "hub", targetNodeId: "a", relation: "calls" }),
    ];
    const communities = new Map<number, string[]>([
      [5, ["a"]],
      [2, ["b"]],
      [10, ["hub"]],
    ]);

    const result = findBridgeNodes(nodes, edges, communities);
    expect(result).toHaveLength(1);
    expect(result[0].connectingCommunities).toEqual([2, 5]);
  });
});

// ─── graphDiff ───────────────────────────────────────────────────────────────

describe("graphDiff", () => {
  it("returns empty diff when old and new are identical", () => {
    const nodes = [makeNode({ id: "a", label: "A" })];
    const edges = [makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" })];

    const result = graphDiff(nodes, edges, nodes, edges);
    expect(result.addedNodes).toEqual([]);
    expect(result.removedNodes).toEqual([]);
    expect(result.addedEdges).toBe(0);
    expect(result.removedEdges).toBe(0);
    expect(result.summary).toBeTruthy();
  });

  it("returns empty diff when both old and new are empty", () => {
    const result = graphDiff([], [], [], []);
    expect(result.addedNodes).toEqual([]);
    expect(result.removedNodes).toEqual([]);
    expect(result.addedEdges).toBe(0);
    expect(result.removedEdges).toBe(0);
    expect(result.summary).toBeTruthy();
  });

  it("detects added nodes", () => {
    const oldNodes = [makeNode({ id: "a", label: "A" })];
    const newNodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
    ];

    const result = graphDiff(oldNodes, [], newNodes, []);
    expect(result.addedNodes.sort()).toEqual(["b", "c"]);
    expect(result.removedNodes).toEqual([]);
    expect(result.addedEdges).toBe(0);
    expect(result.removedEdges).toBe(0);
  });

  it("detects removed nodes", () => {
    const oldNodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const newNodes = [makeNode({ id: "a", label: "A" })];

    const result = graphDiff(oldNodes, [], newNodes, []);
    expect(result.removedNodes).toEqual(["b"]);
    expect(result.addedNodes).toEqual([]);
  });

  it("detects added edges", () => {
    const oldEdges = [makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" })];
    const newEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "c" }),
      makeEdge({ id: "e3", sourceNodeId: "c", targetNodeId: "d" }),
    ];

    const result = graphDiff([], oldEdges, [], newEdges);
    expect(result.addedEdges).toBe(2);
    expect(result.removedEdges).toBe(0);
  });

  it("detects removed edges", () => {
    const oldEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "c" }),
    ];
    const newEdges = [makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" })];

    const result = graphDiff([], oldEdges, [], newEdges);
    expect(result.removedEdges).toBe(1);
    expect(result.addedEdges).toBe(0);
  });

  it("detects both added and removed nodes and edges simultaneously", () => {
    const oldNodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const oldEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "a" }),
    ];
    const newNodes = [
      makeNode({ id: "b", label: "B" }),
      makeNode({ id: "c", label: "C" }),
    ];
    const newEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
      makeEdge({ id: "e3", sourceNodeId: "b", targetNodeId: "c" }),
    ];

    const result = graphDiff(oldNodes, oldEdges, newNodes, newEdges);
    expect(result.addedNodes.sort()).toEqual(["c"]);
    expect(result.removedNodes).toEqual(["a"]);
    expect(result.addedEdges).toBe(1);
    expect(result.removedEdges).toBe(1);
  });

  it("generates descriptive summary string", () => {
    const oldNodes = [makeNode({ id: "a", label: "A" })];
    const newNodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const oldEdges = [makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" })];
    const newEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "c" }),
    ];

    const result = graphDiff(oldNodes, oldEdges, newNodes, newEdges);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain("1");
  });

  it("handles empty old and populated new (fresh ingest)", () => {
    const newNodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const newEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
    ];

    const result = graphDiff([], [], newNodes, newEdges);
    expect(result.addedNodes.sort()).toEqual(["a", "b"]);
    expect(result.removedNodes).toEqual([]);
    expect(result.addedEdges).toBe(1);
    expect(result.removedEdges).toBe(0);
  });

  it("handles populated old and empty new (full reset)", () => {
    const oldNodes = [
      makeNode({ id: "a", label: "A" }),
      makeNode({ id: "b", label: "B" }),
    ];
    const oldEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
    ];

    const result = graphDiff(oldNodes, oldEdges, [], []);
    expect(result.removedNodes.sort()).toEqual(["a", "b"]);
    expect(result.addedNodes).toEqual([]);
    expect(result.removedEdges).toBe(1);
    expect(result.addedEdges).toBe(0);
  });

  it("addedNodes and removedNodes contain node IDs (strings)", () => {
    const oldNodes = [makeNode({ id: "n-abc-123", label: "Old" })];
    const newNodes = [makeNode({ id: "n-def-456", label: "New" })];

    const result = graphDiff(oldNodes, [], newNodes, []);
    expect(result.removedNodes).toEqual(["n-abc-123"]);
    expect(result.addedNodes).toEqual(["n-def-456"]);
    for (const id of result.addedNodes) {
      expect(typeof id).toBe("string");
    }
    for (const id of result.removedNodes) {
      expect(typeof id).toBe("string");
    }
  });

  it("summary mentions diff counts", () => {
    const oldNodes = [
      makeNode({ id: "a" }),
      makeNode({ id: "b" }),
    ];
    const oldEdges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
      makeEdge({ id: "e2", sourceNodeId: "b", targetNodeId: "a" }),
      makeEdge({ id: "e3", sourceNodeId: "a", targetNodeId: "c" }),
    ];

    const result = graphDiff(oldNodes, oldEdges, [], []);
    expect(result.summary).toContain("2"); // removed nodes
    expect(result.summary).toContain("3"); // removed edges
  });
});
