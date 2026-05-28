import type { ToolDef, ToolResult } from "../types";

interface LightDB {
  graphNode: {
    findByKbId(kbId: string): Array<{ id: string; label: string; nodeType: string; metadata: Record<string, unknown> }>;
    findByLabel(kbId: string, label: string): { id: string; label: string; nodeType: string } | null;
    findNeighbors(nodeId: string, kbId: string): Array<{ id: string; label: string; nodeType: string }>;
    search(kbId: string, query: string): Array<{ id: string; label: string }>;
  };
  graphEdge: {
    findByKbId(kbId: string): Array<{ id: string; sourceNodeId: string; targetNodeId: string; relation: string; confidence: number }>;
    findByNode(nodeId: string, kbId: string): Array<{ id: string; sourceNodeId: string; targetNodeId: string; relation: string }>;
  };
  document: {
    findByKbId(kbId: string): Array<{ id: string; title: string }>;
    findById(id: string): { id: string; title: string; sourceType: string } | null;
  };
}

export function createTools(db: LightDB, kbId: string): {
  definitions: ToolDef[];
  execute: (name: string, args: Record<string, unknown>, toolCallId: string) => Promise<ToolResult>;
} {
  const definitions: ToolDef[] = [
    {
      name: "search_knowledge",
      description: "Search the knowledge graph using keywords. Returns matching nodes and their neighbors via BFS traversal.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          maxDepth: { type: "number", description: "BFS traversal depth (default: 1)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_node",
      description: "Get detailed information about a specific node by its label.",
      parameters: {
        type: "object",
        properties: { label: { type: "string", description: "Node label to look up" } },
        required: ["label"],
      },
    },
    {
      name: "get_neighbors",
      description: "Get the neighboring nodes and edges for a given node.",
      parameters: {
        type: "object",
        properties: {
          nodeLabel: { type: "string", description: "Node label to get neighbors for" },
          relation: { type: "string", description: "Optional relation type filter" },
        },
        required: ["nodeLabel"],
      },
    },
    {
      name: "get_community",
      description: "Get all nodes that belong to the same community as the given node.",
      parameters: {
        type: "object",
        properties: { nodeLabel: { type: "string", description: "Node label in the target community" } },
        required: ["nodeLabel"],
      },
    },
    {
      name: "god_nodes",
      description: "Get the most connected (hub) nodes in the knowledge graph.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Number of top nodes (default: 10)" } },
        required: [],
      },
    },
    {
      name: "graph_stats",
      description: "Get summary statistics about the knowledge graph.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "shortest_path",
      description: "Find the shortest connection path between two concepts in the graph.",
      parameters: {
        type: "object",
        properties: {
          fromLabel: { type: "string", description: "Starting node label" },
          toLabel: { type: "string", description: "Target node label" },
        },
        required: ["fromLabel", "toLabel"],
      },
    },
    {
      name: "get_document",
      description: "Get documents whose title matches the query.",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "Document title (partial match)" } },
        required: ["title"],
      },
    },
  ];

  async function execute(name: string, args: Record<string, unknown>, toolCallId: string): Promise<ToolResult> {
    const ok = (output: unknown): ToolResult => ({
      toolCallId,
      output: JSON.stringify(output),
    });
    const err = (msg: string): ToolResult => ({
      toolCallId,
      output: JSON.stringify({ error: msg }),
    });

    switch (name) {
      case "search_knowledge": {
        const query = args.query as string;
        const maxDepth = (args.maxDepth as number) ?? 1;
        const matched = db.graphNode.search(kbId, query);
        const seen = new Set(matched.map((n) => n.id));
        const allNodes = [...matched];
        const allEdges: Array<Record<string, unknown>> = [];

        if (maxDepth > 0) {
          // BFS queue: [nodeId, depth]
          const queue: Array<[string, number]> = matched.map((n) => [n.id, 0]);

          while (queue.length > 0) {
            const [currentId, depth] = queue.shift()!;
            if (depth >= maxDepth) continue;

            const neighbors = db.graphNode.findNeighbors(currentId, kbId);
            const nodeEdges = db.graphEdge.findByNode(currentId, kbId);

            for (const n of neighbors) {
              if (!seen.has(n.id)) {
                seen.add(n.id);
                allNodes.push(n);
                queue.push([n.id, depth + 1]);
              }
            }

            for (const e of nodeEdges) {
              if (!allEdges.some((x) => x.id === e.id)) allEdges.push(e);
            }
          }
        }

        return ok({ nodes: allNodes, edges: allEdges, query });
      }

      case "get_node": {
        const node = db.graphNode.findByLabel(kbId, args.label as string);
        return node ? ok(node) : err(`Node "${args.label}" not found`);
      }

      case "get_neighbors": {
        const node = db.graphNode.findByLabel(kbId, args.nodeLabel as string);
        if (!node) return err(`Node "${args.nodeLabel}" not found`);
        const neighbors = db.graphNode.findNeighbors(node.id, kbId);
        const edges = db.graphEdge.findByNode(node.id, kbId);
        const relationFilter = args.relation as string | undefined;
        const filtered = relationFilter
          ? edges.filter((e) => e.relation === relationFilter)
          : edges;
        return ok({ node, neighbors, edges: filtered });
      }

      case "get_community": {
        const node = db.graphNode.findByLabel(kbId, args.nodeLabel as string);
        if (!node) return err(`Node "${args.nodeLabel}" not found`);

        // BFS connected component as community proxy
        const visited = new Set<string>();
        const queue = [node.id];
        visited.add(node.id);

        while (queue.length > 0) {
          const current = queue.shift()!;
          const neighbors = db.graphNode.findNeighbors(current, kbId);
          for (const n of neighbors) {
            if (!visited.has(n.id)) { visited.add(n.id); queue.push(n.id); }
          }
        }

        const members = db.graphNode.findByKbId(kbId).filter((n) => visited.has(n.id));
        return ok({ nodeLabel: args.nodeLabel, members });
      }

      case "god_nodes": {
        const limit = (args.limit as number) ?? 10;
        const nodes = db.graphNode.findByKbId(kbId);
        const edges = db.graphEdge.findByKbId(kbId);
        const degree = new Map<string, number>();
        for (const e of edges) {
          degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) ?? 0) + 1);
          degree.set(e.targetNodeId, (degree.get(e.targetNodeId) ?? 0) + 1);
        }
        const sorted = nodes
          .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
          .sort((a, b) => b.degree - a.degree)
          .slice(0, limit);
        return ok(sorted);
      }

      case "graph_stats": {
        const nodes = db.graphNode.findByKbId(kbId);
        const edges = db.graphEdge.findByKbId(kbId);
        return ok({ nodeCount: nodes.length, edgeCount: edges.length });
      }

      case "shortest_path": {
        const fromLabel = args.fromLabel as string;
        const toLabel = args.toLabel as string;
        const fromNode = db.graphNode.findByLabel(kbId, fromLabel);
        const toNode = db.graphNode.findByLabel(kbId, toLabel);
        if (!fromNode || !toNode) return err("One or both nodes not found");

        // Build adjacency list
        const edges = db.graphEdge.findByKbId(kbId);
        const adj = new Map<string, string[]>();
        for (const e of edges) {
          if (!adj.has(e.sourceNodeId)) adj.set(e.sourceNodeId, []);
          adj.get(e.sourceNodeId)!.push(e.targetNodeId);
          if (!adj.has(e.targetNodeId)) adj.set(e.targetNodeId, []);
          adj.get(e.targetNodeId)!.push(e.sourceNodeId);
        }

        // BFS
        const parent = new Map<string, string>();
        const visited = new Set<string>();
        const queue = [fromNode.id];
        visited.add(fromNode.id);

        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (cur === toNode.id) break;
          for (const nb of adj.get(cur) ?? []) {
            if (!visited.has(nb)) { visited.add(nb); parent.set(nb, cur); queue.push(nb); }
          }
        }

        if (!visited.has(toNode.id)) return err("No path found between these nodes");

        // Reconstruct path
        const path: string[] = [];
        let cur = toNode.id;
        while (cur !== fromNode.id) {
          path.unshift(cur);
          cur = parent.get(cur)!;
        }
        path.unshift(fromNode.id);

        const allNodes = db.graphNode.findByKbId(kbId);
        const pathLabels = path.map((id) => {
          const n = allNodes.find((x) => x.id === id);
          return n?.label ?? id;
        });

        return ok({ path: pathLabels, length: path.length - 1 });
      }

      case "get_document": {
        const title = args.title as string;
        const docs = db.document.findByKbId(kbId);
        const matched = docs.filter((d) => d.title.toLowerCase().includes(title.toLowerCase()));
        return ok(matched);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  }

  return { definitions, execute };
}
