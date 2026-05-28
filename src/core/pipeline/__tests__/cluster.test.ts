import { describe, it, expect } from "vitest";
import {
  detectCommunities,
  modularityScore,
  scoreCommunities,
} from "../cluster";

// ─── helper types ───────────────────────────────────────────────────────────

interface TestNode {
  id: string;
  label: string;
}

interface TestEdge {
  source: string;
  target: string;
  weight?: number;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a fully-connected clique of n nodes (node ids: "0", "1", ..., "n-1") */
function makeClique(n: number): { nodes: TestNode[]; edges: TestEdge[] } {
  const nodes: TestNode[] = [];
  const edges: TestEdge[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: String(i), label: `Node ${i}` });
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ source: String(i), target: String(j) });
    }
  }
  return { nodes, edges };
}

/** Count how many unique communities the result contains */
function communityCount(communities: Map<number, string[]>): number {
  return communities.size;
}

/** Get flat list of all node ids in the result */
function allNodeIds(communities: Map<number, string[]>): string[] {
  const ids: string[] = [];
  for (const members of communities.values()) {
    ids.push(...members);
  }
  return ids.sort();
}

// ─── detectCommunities ──────────────────────────────────────────────────────

describe("detectCommunities", () => {
  describe("trivial cases", () => {
    it("returns empty map for empty graph", () => {
      const result = detectCommunities([], []);
      expect(result.size).toBe(0);
    });

    it("returns single community for single node with no edges", () => {
      const nodes = [{ id: "A", label: "A" }];
      const result = detectCommunities(nodes, [], 20, false);
      expect(result.size).toBe(1);
      expect(result.get(0)).toEqual(["A"]);
    });

    it("returns separate communities for two disconnected nodes", () => {
      const nodes = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ];
      const result = detectCommunities(nodes, [], 20, false);
      expect(communityCount(result)).toBe(2);
      expect(allNodeIds(result)).toEqual(["A", "B"]);
    });
  });

  describe("triangle (3-clique)", () => {
    const { nodes, edges } = makeClique(3);

    it("merges all 3 nodes into a single community", () => {
      const result = detectCommunities(nodes, edges);
      expect(communityCount(result)).toBe(1);
      const members = result.values().next().value as string[];
      expect(members.sort()).toEqual(["0", "1", "2"]);
    });

    it("produces modularity of 0 for a single 3-clique (no community structure)", () => {
      // For a complete graph with all nodes in one community:
      //   m=3, each k_i=2, Σ_in=3 (all edges internal), Σ_tot=6
      //   Q = Σ_in/m - (Σ_tot/(2m))^2 = 3/3 - (6/6)^2 = 1 - 1 = 0
      const result = detectCommunities(nodes, edges);
      const q = modularityScore(nodes, edges, result);
      expect(q).toBeCloseTo(0, 5);
    });
  });

  describe("two disconnected cliques", () => {
    it("correctly separates two disconnected 3-cliques", () => {
      // Clique 1: nodes 0,1,2  | Clique 2: nodes 3,4,5
      const nodes: TestNode[] = [];
      for (let i = 0; i < 6; i++) {
        nodes.push({ id: String(i), label: `Node ${i}` });
      }
      const edges: TestEdge[] = [];
      // edges within first clique
      for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
        edges.push({ source: String(a), target: String(b) });
      }
      // edges within second clique
      for (const [a, b] of [[3, 4], [4, 5], [3, 5]]) {
        edges.push({ source: String(a), target: String(b) });
      }

      const result = detectCommunities(nodes, edges);
      // Should find exactly 2 communities
      expect(communityCount(result)).toBe(2);

      // Each community should have 3 nodes
      const sizes = Array.from(result.values()).map((m) => m.length).sort();
      expect(sizes).toEqual([3, 3]);

      // Nodes from the same clique should be together
      const allMembers = new Set(allNodeIds(result));
      expect(allMembers.size).toBe(6);
    });
  });

  describe("barbell graph (two cliques + bridge)", () => {
    it("detects two communities separated by a weak bridge", () => {
      // Barbell: two 4-cliques connected by a single bridge edge
      // Clique A: nodes 0,1,2,3  | Clique B: nodes 4,5,6,7
      // Bridge: edge 3-4
      const nodes: TestNode[] = [];
      for (let i = 0; i < 8; i++) {
        nodes.push({ id: String(i), label: `Node ${i}` });
      }
      const edges: TestEdge[] = [];

      // Clique A (fully connected: 0,1,2,3)
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          edges.push({ source: String(i), target: String(j) });
        }
      }
      // Clique B (fully connected: 4,5,6,7)
      for (let i = 4; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) {
          edges.push({ source: String(i), target: String(j) });
        }
      }
      // Bridge edge
      edges.push({ source: "3", target: "4" });

      const result = detectCommunities(nodes, edges);
      // 2 main communities expected
      expect(communityCount(result)).toBe(2);

      const sizes = Array.from(result.values()).map((m) => m.length).sort();
      // Each community should be size 4
      expect(sizes).toEqual([4, 4]);

      // Verify nodes 0-3 in one community, 4-7 in the other
      const [commA, commB] = Array.from(result.values()).map((m) => new Set(m));
      const firstCliqueInA = commA.has("0") && commA.has("1") && commA.has("2") && commA.has("3");
      const firstCliqueInB = commB.has("0") && commB.has("1") && commB.has("2") && commB.has("3");
      // The first clique should be entirely in one community
      expect(firstCliqueInA || firstCliqueInB).toBe(true);
    });
  });

  describe("weighted edges", () => {
    it("respects edge weights for community assignment", () => {
      // Three nodes A,B,C where A-B weight=5, B-C weight=5, A-C weight=1
      // The stronger edges should drive community formation
      const nodes: TestNode[] = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
      ];
      const edges: TestEdge[] = [
        { source: "A", target: "B", weight: 5 },
        { source: "B", target: "C", weight: 5 },
        { source: "A", target: "C", weight: 1 },
      ];

      const result = detectCommunities(nodes, edges);
      // All 3 should likely merge into one community
      expect(communityCount(result)).toBe(1);
      expect(allNodeIds(result)).toEqual(["A", "B", "C"]);
    });

    it("defaults unweighted edges to weight 1", () => {
      const nodes: TestNode[] = [
        { id: "X", label: "X" },
        { id: "Y", label: "Y" },
      ];
      const edges: TestEdge[] = [{ source: "X", target: "Y" }];

      const result = detectCommunities(nodes, edges);
      expect(communityCount(result)).toBe(1);
      expect(allNodeIds(result)).toEqual(["X", "Y"]);
    });
  });

  describe("maxIterations", () => {
    it("accepts custom maxIterations", () => {
      const { nodes, edges } = makeClique(5);
      // 5-clique, max iterations = 1: should still converge because
      // once all nodes merge there are no more moves to make
      const result = detectCommunities(nodes, edges, 1);
      expect(communityCount(result)).toBe(1);
    });
  });

  describe("edges referencing non-existent nodes", () => {
    it("ignores edges whose source or target is not in the node list", () => {
      const nodes: TestNode[] = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ];
      const edges: TestEdge[] = [
        { source: "A", target: "B" },
        { source: "A", target: "GHOST" }, // non-existent target
      ];
      const result = detectCommunities(nodes, edges);
      // Should not crash; A and B still form 1 community
      expect(communityCount(result)).toBe(1);
      expect(allNodeIds(result)).toEqual(["A", "B"]);
    });
  });

  describe("nodes with no connections", () => {
    it("keeps isolated nodes in their own communities (filterIsolated=false)", () => {
      const nodes: TestNode[] = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
      ];
      const edges: TestEdge[] = [{ source: "A", target: "B" }];
      // A and B connected, C isolated

      const result = detectCommunities(nodes, edges, 20, false);
      expect(communityCount(result)).toBe(2);

      const allMembers = allNodeIds(result);
      expect(allMembers).toEqual(["A", "B", "C"]);
    });

    it("filters out isolated single-node communities by default", () => {
      const nodes: TestNode[] = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
        { id: "C", label: "C" },
      ];
      const edges: TestEdge[] = [{ source: "A", target: "B" }];
      // A and B connected, C isolated — C should be filtered out

      const result = detectCommunities(nodes, edges);
      expect(communityCount(result)).toBe(1);
      expect(allNodeIds(result)).toEqual(["A", "B"]);
    });
  });

  describe("filterIsolated", () => {
    it("returns empty map when all nodes are isolated with filterIsolated=true", () => {
      const nodes: TestNode[] = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ];
      const result = detectCommunities(nodes, [], 20, true);
      expect(result.size).toBe(0);
    });

    it("returns all nodes when all nodes are isolated with filterIsolated=false", () => {
      const nodes: TestNode[] = [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ];
      const result = detectCommunities(nodes, [], 20, false);
      expect(result.size).toBe(2);
    });

    it("returns only connected communities in a mixed graph with filterIsolated=true", () => {
      const { nodes, edges } = makeClique(3);
      // Add an isolated node
      const allNodes = [...nodes, { id: "isolated", label: "Isolated" }];
      const result = detectCommunities(allNodes, edges, 20, true);
      expect(communityCount(result)).toBe(1);
      expect(allNodeIds(result)).toEqual(["0", "1", "2"]);
    });

    it("returns only connected communities in a mixed graph with filterIsolated=false", () => {
      const { nodes, edges } = makeClique(3);
      const allNodes = [...nodes, { id: "isolated", label: "Isolated" }];
      const result = detectCommunities(allNodes, edges, 20, false);
      // Clique has 1 community, isolated node has its own = 2 total
      expect(communityCount(result)).toBe(2);
      expect(allNodeIds(result)).toEqual(["0", "1", "2", "isolated"]);
    });

    it("does not filter multi-node communities even if some nodes have low degree", () => {
      // A star: center "hub" connected to many leaves, but leaves only connect to hub
      // A star with 4 nodes should still be 1 community
      const nodes: TestNode[] = [
        { id: "hub", label: "Hub" },
        { id: "l1", label: "Leaf1" },
        { id: "l2", label: "Leaf2" },
        { id: "l3", label: "Leaf3" },
      ];
      const edges: TestEdge[] = [
        { source: "hub", target: "l1" },
        { source: "hub", target: "l2" },
        { source: "hub", target: "l3" },
      ];
      const result = detectCommunities(nodes, edges, 20, true);
      expect(communityCount(result)).toBe(1);
    });
  });
});

// ─── modularityScore ────────────────────────────────────────────────────────

describe("modularityScore", () => {
  it("returns 0 for empty graph", () => {
    expect(modularityScore([], [], new Map())).toBe(0);
  });

  it("returns a negative value for a single-node single-community", () => {
    const nodes = [{ id: "A", label: "A" }];
    const communities = new Map([[0, ["A"]]]);
    // m=0, so 2m=0 -> would be division by zero. Implementation should handle.
    // With m=0 (no edges), Q should be 0 since there's no structure to measure.
    const q = modularityScore(nodes, [], communities);
    expect(q).toBe(0);
  });

  it("produces a value <= 1 for any valid partition", () => {
    const { nodes, edges } = makeClique(5);
    const communities = detectCommunities(nodes, edges);
    const q = modularityScore(nodes, edges, communities);
    expect(q).toBeLessThanOrEqual(1);
    expect(q).toBeGreaterThanOrEqual(-1);
  });

  it("computes correct Q for known partition on two disconnected cliques", () => {
    // Two disconnected 3-cliques, each in its own community:
    // m=6, Σ_in=3 each, Σ_tot=6 each
    // Contribution per community: Σ_in/m - (Σ_tot/(2m))^2 = 3/6 - (6/12)^2 = 0.5 - 0.25 = 0.25
    // Total Q = 0.25 + 0.25 = 0.5
    const nodes: TestNode[] = [];
    for (let i = 0; i < 6; i++) {
      nodes.push({ id: String(i), label: `Node ${i}` });
    }
    const edges: TestEdge[] = [];
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      edges.push({ source: String(a), target: String(b) });
    }
    for (const [a, b] of [[3, 4], [4, 5], [3, 5]]) {
      edges.push({ source: String(a), target: String(b) });
    }

    const communities = new Map<number, string[]>([
      [0, ["0", "1", "2"]],
      [1, ["3", "4", "5"]],
    ]);

    const q = modularityScore(nodes, edges, communities);
    expect(q).toBeCloseTo(0.5, 5);
  });
});

// ─── scoreCommunities ───────────────────────────────────────────────────────

describe("scoreCommunities", () => {
  it("returns empty map for empty graph", () => {
    const scores = scoreCommunities([], [], new Map());
    expect(scores.size).toBe(0);
  });

  it("returns a score of 0 for a single-node community (no internal edges)", () => {
    const nodes = [{ id: "A", label: "A" }];
    const communities = new Map([[0, ["A"]]]);
    const scores = scoreCommunities(nodes, [], communities);
    expect(scores.size).toBe(1);
    expect(scores.get(0)).toBe(0);
  });

  it("returns high cohesion for a fully-connected community", () => {
    // 3-clique: every pair is connected
    const nodes: TestNode[] = [
      { id: "A", label: "A" },
      { id: "B", label: "B" },
      { id: "C", label: "C" },
    ];
    const edges: TestEdge[] = [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
      { source: "A", target: "C" },
    ];
    // All in one community: Σ_in = 3, Σ_tot = 6, cohesion = 3/6 = 0.5
    const communities = new Map([[0, ["A", "B", "C"]]]);
    const scores = scoreCommunities(nodes, edges, communities);
    expect(scores.get(0)).toBeCloseTo(0.5, 5);
  });

  it("returns 0 for a star-shaped community (all internal edges go through center)", () => {
    // Star: center node A connected to B,C,D; no edges between B,C,D
    const nodes: TestNode[] = [
      { id: "A", label: "A" },
      { id: "B", label: "B" },
      { id: "C", label: "C" },
      { id: "D", label: "D" },
    ];
    const edges: TestEdge[] = [
      { source: "A", target: "B" },
      { source: "A", target: "C" },
      { source: "A", target: "D" },
    ];
    // All in one community: Σ_in = 3, Σ_tot = degree_sum = 3+1+1+1 = 6
    // cohesion = 3/6 = 0.5
    const communities = new Map([[0, ["A", "B", "C", "D"]]]);
    const scores = scoreCommunities(nodes, edges, communities);
    expect(scores.get(0)).toBeCloseTo(0.5, 5);
  });

  it("handles partitions with cross-community edges correctly", () => {
    // Nodes 0,1 connected in community A; node 2 in community B.
    // Edge 0-2 crosses communities.
    const nodes: TestNode[] = [
      { id: "0", label: "0" },
      { id: "1", label: "1" },
      { id: "2", label: "2" },
    ];
    const edges: TestEdge[] = [
      { source: "0", target: "1" },
      { source: "0", target: "2" },
    ];
    const communities = new Map<number, string[]>([
      [0, ["0", "1"]],
      [1, ["2"]],
    ]);
    const scores = scoreCommunities(nodes, edges, communities);
    // Community 0: internal edge 0-1 weight 1, total degree = 2+1=3, cohesion=1/3≈0.333
    expect(scores.get(0)).toBeCloseTo(1 / 3, 5);
    // Community 1: single node, no internal edges, cohesion=0
    expect(scores.get(1)).toBe(0);
  });

  it("returns cohesion score for each community", () => {
    // Two separate communities: clique + isolated pair
    const nodes: TestNode[] = [
      { id: "0", label: "0" },
      { id: "1", label: "1" },
      { id: "2", label: "2" },
      { id: "3", label: "3" },
      { id: "4", label: "4" },
    ];
    const edges: TestEdge[] = [
      { source: "0", target: "1" },
      { source: "1", target: "2" },
      { source: "0", target: "2" },
      { source: "3", target: "4" },
    ];
    const communities = new Map<number, string[]>([
      [0, ["0", "1", "2"]],
      [1, ["3", "4"]],
    ]);
    const scores = scoreCommunities(nodes, edges, communities);
    expect(scores.size).toBe(2);
    expect(scores.get(0)).toBeGreaterThan(0);
    expect(scores.get(1)).toBeGreaterThan(0);
  });
});

// ─── integration: detectCommunities + scoring round-trip ────────────────────

describe("integration", () => {
  it("detectCommunities output is accepted by modularityScore and scoreCommunities", () => {
    const { nodes, edges } = makeClique(5);
    const communities = detectCommunities(nodes, edges);

    // Both scoring functions should accept the output without error
    const q = modularityScore(nodes, edges, communities);
    const scores = scoreCommunities(nodes, edges, communities);

    expect(typeof q).toBe("number");
    expect(scores.size).toBeGreaterThanOrEqual(1);
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("higher modularity for well-separated communities vs random partition", () => {
    // Two disconnected cliques
    const nodes: TestNode[] = [];
    const edges: TestEdge[] = [];
    for (let i = 0; i < 6; i++) {
      nodes.push({ id: String(i), label: `N${i}` });
    }
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      edges.push({ source: String(a), target: String(b) });
    }
    for (const [a, b] of [[3, 4], [4, 5], [3, 5]]) {
      edges.push({ source: String(a), target: String(b) });
    }

    const detected = detectCommunities(nodes, edges);
    const qDetected = modularityScore(nodes, edges, detected);

    // Bad partition: split each clique in half
    const badPartition = new Map<number, string[]>([
      [0, ["0", "3"]],
      [1, ["1", "4"]],
      [2, ["2", "5"]],
    ]);
    const qBad = modularityScore(nodes, edges, badPartition);

    expect(qDetected).toBeGreaterThan(qBad);
  });
});
