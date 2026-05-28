import { describe, it, expect } from "vitest";
import { autoLabelCommunity, autoLabelAllCommunities } from "../community-label";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

type NodeInfo = { label: string; nodeType: string };
type EdgeInfo = { source: string; target: string; relation: string };

function makeNodeMap(
  nodes: Array<{ id: string; label: string; nodeType: string }>,
): Map<string, NodeInfo> {
  const map = new Map<string, NodeInfo>();
  for (const n of nodes) {
    map.set(n.id, { label: n.label, nodeType: n.nodeType });
  }
  return map;
}

// ---------------------------------------------------------------------------
// autoLabelCommunity
// ---------------------------------------------------------------------------

describe("autoLabelCommunity", () => {
  // -----------------------------------------------------------------------
  // Heuristic 2: file type node → use filename as label base
  // -----------------------------------------------------------------------
  it("uses filename when community has a file type node", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "src/auth/login.ts", nodeType: "file" },
      { id: "n2", label: "authenticate", nodeType: "function" },
      { id: "n3", label: "User", nodeType: "class" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "contains" },
      { source: "n1", target: "n3", relation: "contains" },
    ];

    const label = autoLabelCommunity(1, ["n1", "n2", "n3"], nodeMap, edges);
    expect(label).toContain("login");
  });

  it("uses filename without extension as label base", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "components/Header.tsx", nodeType: "file" },
      { id: "n2", label: "Header", nodeType: "class" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "contains" },
    ];

    const label = autoLabelCommunity(1, ["n1", "n2"], nodeMap, edges);
    expect(label).toContain("Header");
    expect(label).not.toContain(".tsx");
  });

  // -----------------------------------------------------------------------
  // Heuristic 3: heading type nodes → use most connected heading
  // -----------------------------------------------------------------------
  it("uses the most connected heading label when no file node exists", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Introduction", nodeType: "heading" },
      { id: "n2", label: "Getting Started", nodeType: "heading" },
      { id: "n3", label: "React Hooks", nodeType: "concept" },
      { id: "n4", label: "useState", nodeType: "function" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n3", relation: "documents" },
      { source: "n2", target: "n3", relation: "documents" },
      { source: "n2", target: "n4", relation: "documents" },
      { source: "n2", target: "n1", relation: "references" },
    ];
    // n2 ("Getting Started") has degree 3 (connected to n3, n4, n1)
    // n1 ("Introduction") has degree 2 (connected to n3, n2)
    // Most connected heading is n2

    const label = autoLabelCommunity(
      1,
      ["n1", "n2", "n3", "n4"],
      nodeMap,
      edges,
    );
    expect(label).toBe("Getting Started");
  });

  it("uses the only heading when there is just one heading node", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "API Reference", nodeType: "heading" },
      { id: "n2", label: "fetchUsers", nodeType: "function" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "documents" },
    ];

    const label = autoLabelCommunity(1, ["n1", "n2"], nodeMap, edges);
    expect(label).toBe("API Reference");
  });

  // -----------------------------------------------------------------------
  // Heuristic 4: mostly class type → "{ClassName} module"
  // -----------------------------------------------------------------------
  it('labels as "{ClassName} module" when class nodes are majority', () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "AuthService", nodeType: "class" },
      { id: "n2", label: "UserRepository", nodeType: "class" },
      { id: "n3", label: "TokenManager", nodeType: "class" },
      { id: "n4", label: "validateToken", nodeType: "function" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "uses" },
      { source: "n1", target: "n3", relation: "uses" },
      { source: "n1", target: "n4", relation: "calls" },
    ];
    // n1 ("AuthService") has degree 3, n2 ("UserRepository") has degree 1,
    // n3 ("TokenManager") has degree 1

    const label = autoLabelCommunity(
      1,
      ["n1", "n2", "n3", "n4"],
      nodeMap,
      edges,
    );
    expect(label).toBe("AuthService module");
  });

  it("uses the most connected class when multiple classes exist", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Logger", nodeType: "class" },
      { id: "n2", label: "Database", nodeType: "class" },
      { id: "n3", label: "Config", nodeType: "class" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n2", target: "n1", relation: "uses" },
      { source: "n2", target: "n3", relation: "uses" },
    ];
    // n2 ("Database") has degree 2, n1 has 1, n3 has 1

    const label = autoLabelCommunity(1, ["n1", "n2", "n3"], nodeMap, edges);
    expect(label).toBe("Database module");
  });

  // -----------------------------------------------------------------------
  // Heuristic 5: mostly function type with dependencies → "{topFunc} + dependencies"
  // -----------------------------------------------------------------------
  it('labels as "{topFunc} + dependencies" when function nodes are majority with imports', () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "authenticate", nodeType: "function" },
      { id: "n2", label: "hashPassword", nodeType: "function" },
      { id: "n3", label: "verifyToken", nodeType: "function" },
      { id: "n4", label: "bcrypt", nodeType: "module" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "calls" },
      { source: "n1", target: "n3", relation: "calls" },
      { source: "n1", target: "n4", relation: "imports" },
    ];
    // function nodes: n1, n2, n3 (3 of 4 = 75% majority)
    // n1 has degree 3 (most connected function)

    const label = autoLabelCommunity(
      1,
      ["n1", "n2", "n3", "n4"],
      nodeMap,
      edges,
    );
    expect(label).toBe("authenticate + dependencies");
  });

  it("does not use function heuristic when function nodes have no edges", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "isolatedFunc", nodeType: "function" },
      { id: "n2", label: "anotherFunc", nodeType: "function" },
      { id: "n3", label: "HelperClass", nodeType: "class" },
    ]);
    const edges: EdgeInfo[] = [];
    // function nodes are majority (2 of 3) but no edges = no imports
    // Should fall through to step 6 (mix) or step 7 (fallback)

    const label = autoLabelCommunity(1, ["n1", "n2", "n3"], nodeMap, edges);
    // Since function majority without imports falls through to step 6 (mix)
    // All nodes have degree 0, so fallback to step 7
    // Two node labels sorted alphabetically: "HelperClass / anotherFunc / ..."
    // Wait, step 7: top 2 node labels joined with " / "
    // Labels: "isolatedFunc", "anotherFunc", "HelperClass"
    // Sorted: "HelperClass", "anotherFunc", "isolatedFunc"
    // Top 2: "HelperClass / anotherFunc"
    expect(label).toContain("/");
  });

  // -----------------------------------------------------------------------
  // Heuristic 6: mixed types → highest-degree node label + "cluster"
  // -----------------------------------------------------------------------
  it('labels as "{label} cluster" for mixed type communities', () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "React Hooks", nodeType: "concept" },
      { id: "n2", label: "useState", nodeType: "function" },
      { id: "n3", label: "useEffect", nodeType: "function" },
      { id: "n4", label: "Component", nodeType: "class" },
      { id: "n5", label: "Virtual DOM", nodeType: "concept" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "has_function" },
      { source: "n1", target: "n3", relation: "has_function" },
      { source: "n1", target: "n4", relation: "related_to" },
      { source: "n1", target: "n5", relation: "related_to" },
    ];
    // Mixed: 2 concepts, 2 functions, 1 class. No majority type.
    // n1 ("React Hooks") has degree 4 (most connected)

    const label = autoLabelCommunity(
      1,
      ["n1", "n2", "n3", "n4", "n5"],
      nodeMap,
      edges,
    );
    expect(label).toBe("React Hooks cluster");
  });

  it("uses highest-degree node from mixed community", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Logger", nodeType: "class" },
      { id: "n2", label: "formatLog", nodeType: "function" },
      { id: "n3", label: "LogLevel", nodeType: "enum" },
      { id: "n4", label: "console", nodeType: "module" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n2", target: "n1", relation: "belongs_to" },
      { source: "n2", target: "n3", relation: "uses" },
      { source: "n2", target: "n4", relation: "imports" },
    ];
    // Mixed: 1 class, 1 function, 1 enum, 1 module. No majority.
    // n2 ("formatLog") has degree 3 (most connected)

    const label = autoLabelCommunity(
      1,
      ["n1", "n2", "n3", "n4"],
      nodeMap,
      edges,
    );
    expect(label).toBe("formatLog cluster");
  });

  // -----------------------------------------------------------------------
  // Heuristic 7: fallback → top 2 node labels joined with " / "
  // -----------------------------------------------------------------------
  it('falls back to top 2 labels with " / " when no node has edges', () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Alpha", nodeType: "concept" },
      { id: "n2", label: "Beta", nodeType: "concept" },
      { id: "n3", label: "Gamma", nodeType: "concept" },
    ]);
    const edges: EdgeInfo[] = [];
    // All same type (concept), no file/heading, not class/function majority,
    // falls to mix (step 6), but all nodes have degree 0,
    // so fallback to top 2 labels sorted alphabetically: "Alpha / Beta"

    const label = autoLabelCommunity(1, ["n1", "n2", "n3"], nodeMap, edges);
    expect(label).toContain("/");
    expect(label).toContain("Alpha");
    expect(label).toContain("Beta");
  });

  it("handles single-node community with fallback", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Singleton", nodeType: "concept" },
    ]);
    const edges: EdgeInfo[] = [];

    const label = autoLabelCommunity(1, ["n1"], nodeMap, edges);
    expect(label).toBe("Singleton");
  });

  it("handles two-node community with fallback when no edges", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Foo", nodeType: "concept" },
      { id: "n2", label: "Bar", nodeType: "function" },
    ]);
    const edges: EdgeInfo[] = [];

    const label = autoLabelCommunity(1, ["n1", "n2"], nodeMap, edges);
    expect(label).toBe("Bar / Foo"); // sorted alphabetically
  });

  // -----------------------------------------------------------------------
  // Edge case: empty nodeIds
  // -----------------------------------------------------------------------
  it("handles empty community gracefully", () => {
    const nodeMap = makeNodeMap([]);
    const edges: EdgeInfo[] = [];

    const label = autoLabelCommunity(1, [], nodeMap, edges);
    expect(typeof label).toBe("string");
  });

  // -----------------------------------------------------------------------
  // Edge case: nodeIds not found in nodeMap
  // -----------------------------------------------------------------------
  it("handles nodeIds not in nodeMap gracefully", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Alpha", nodeType: "concept" },
    ]);
    const edges: EdgeInfo[] = [];

    const label = autoLabelCommunity(1, ["n1", "n_missing"], nodeMap, edges);
    expect(typeof label).toBe("string");
  });

  // -----------------------------------------------------------------------
  // Heuristic ordering: file takes priority over heading
  // -----------------------------------------------------------------------
  it("prefers file heuristic over heading heuristic when both exist", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "src/index.ts", nodeType: "file" },
      { id: "n2", label: "Overview", nodeType: "heading" },
      { id: "n3", label: "main", nodeType: "function" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "contains" },
      { source: "n1", target: "n3", relation: "contains" },
    ];

    const label = autoLabelCommunity(1, ["n1", "n2", "n3"], nodeMap, edges);
    // File heuristic should win, not heading
    expect(label).toContain("index");
    expect(label).not.toBe("Overview");
  });

  // -----------------------------------------------------------------------
  // Heuristic ordering: heading over class majority
  // -----------------------------------------------------------------------
  it("prefers heading over class majority when heading exists", () => {
    const nodeMap = makeNodeMap([
      { id: "n1", label: "Setup Guide", nodeType: "heading" },
      { id: "n2", label: "ConfigService", nodeType: "class" },
      { id: "n3", label: "AppConfig", nodeType: "class" },
    ]);
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "documents" },
      { source: "n1", target: "n3", relation: "documents" },
    ];

    const label = autoLabelCommunity(1, ["n1", "n2", "n3"], nodeMap, edges);
    // n1 is heading, even though class is majority (2 of 3)
    // heading heuristic should win
    expect(label).toBe("Setup Guide");
  });
});

// ---------------------------------------------------------------------------
// autoLabelAllCommunities
// ---------------------------------------------------------------------------

describe("autoLabelAllCommunities", () => {
  it("labels all communities in a map", () => {
    const nodes = [
      { id: "n1", label: "src/auth.ts", nodeType: "file" },
      { id: "n2", label: "authenticate", nodeType: "function" },
      { id: "n3", label: "src/db.ts", nodeType: "file" },
      { id: "n4", label: "query", nodeType: "function" },
    ];
    const edges: EdgeInfo[] = [
      { source: "n1", target: "n2", relation: "contains" },
      { source: "n3", target: "n4", relation: "contains" },
    ];

    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);
    communities.set(1, ["n3", "n4"]);

    const labels = autoLabelAllCommunities(communities, nodes, edges);

    expect(labels.size).toBe(2);
    expect(labels.get(0)).toContain("auth");
    expect(labels.get(1)).toContain("db");
  });

  it("handles empty communities map", () => {
    const nodes = [
      { id: "n1", label: "A", nodeType: "concept" },
    ];
    const edges: EdgeInfo[] = [];

    const labels = autoLabelAllCommunities(new Map(), nodes, edges);
    expect(labels.size).toBe(0);
  });

  it("handles community with empty node list", () => {
    const nodes = [
      { id: "n1", label: "A", nodeType: "concept" },
    ];
    const edges: EdgeInfo[] = [];
    const communities = new Map<number, string[]>();
    communities.set(0, []);

    const labels = autoLabelAllCommunities(communities, nodes, edges);
    expect(labels.size).toBe(1);
    expect(labels.has(0)).toBe(true);
  });

  it("returns labels as a Map from community ID to string", () => {
    const nodes = [
      { id: "n1", label: "Alpha", nodeType: "concept" },
      { id: "n2", label: "Beta", nodeType: "concept" },
    ];
    const edges: EdgeInfo[] = [];
    const communities = new Map<number, string[]>();
    communities.set(0, ["n1", "n2"]);

    const labels = autoLabelAllCommunities(communities, nodes, edges);
    expect(labels).toBeInstanceOf(Map);
    expect(typeof labels.get(0)).toBe("string");
  });
});
