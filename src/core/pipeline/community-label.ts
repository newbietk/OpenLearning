// ---------------------------------------------------------------------------
// Community auto-labeling — replaces "Community N: a/b/c" with smarter labels
// ---------------------------------------------------------------------------

interface CommunityNode {
  id: string;
  label: string;
  nodeType: string;
}

// ---- helpers ----

function selectByDegree(
  items: CommunityNode[],
  getDegree: (id: string) => number,
): CommunityNode {
  return items.reduce((best, cur) =>
    getDegree(cur.id) > getDegree(best.id) ? cur : best,
  );
}

function extractBasename(fileLabel: string): string {
  const parts = fileLabel.split(/[/\\]/);
  const basename = parts[parts.length - 1];
  const dotIdx = basename.lastIndexOf(".");
  return dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
}

// ---- main ----

/**
 * Label a single community using type-based heuristics.
 *
 * Heuristic cascade (first match wins):
 *   1. "file" type node present  →  use filename (basename, no extension)
 *   2. "heading" type nodes      →  most-connected heading label
 *   3. "class" majority          →  "{most-connected-class} module"
 *   4. "function" majority + edges →  "{most-connected-func} + dependencies"
 *   5. Mixed types               →  highest-degree node label + " cluster"
 *   6. Fallback                  →  top 2 node labels joined with " / "
 */
export function autoLabelCommunity(
  communityId: number,
  nodeIds: string[],
  nodeMap: Map<string, { label: string; nodeType: string }>,
  edges: Array<{ source: string; target: string; relation: string }>,
): string {
  const communityNodes: CommunityNode[] = [];
  for (const nid of nodeIds) {
    const info = nodeMap.get(nid);
    if (info) communityNodes.push({ id: nid, label: info.label, nodeType: info.nodeType });
  }
  if (communityNodes.length === 0) return `Community ${communityId}`;

  const degree = new Map<string, number>();
  for (const n of communityNodes) degree.set(n.id, 0);
  for (const e of edges) {
    const sd = degree.get(e.source);
    if (sd !== undefined) degree.set(e.source, sd + 1);
    const td = degree.get(e.target);
    if (td !== undefined) degree.set(e.target, td + 1);
  }
  const getDegree = (nid: string): number => degree.get(nid) ?? 0;

  // Heuristic 1: file type
  const fileNodes = communityNodes.filter((n) => n.nodeType === "file");
  if (fileNodes.length > 0) {
    return extractBasename(selectByDegree(fileNodes, getDegree).label);
  }

  // Heuristic 2: heading type
  const headingNodes = communityNodes.filter((n) => n.nodeType === "heading");
  if (headingNodes.length > 0) {
    return selectByDegree(headingNodes, getDegree).label;
  }

  // Heuristic 3: class majority
  const classNodes = communityNodes.filter((n) => n.nodeType === "class");
  if (classNodes.length > communityNodes.length / 2) {
    return `${selectByDegree(classNodes, getDegree).label} module`;
  }

  // Heuristic 4: function majority with dependencies
  const funcNodes = communityNodes.filter((n) => n.nodeType === "function");
  if (funcNodes.length > communityNodes.length / 2) {
    const hasEdges = funcNodes.some((n) => getDegree(n.id) > 0);
    if (hasEdges) {
      return `${selectByDegree(funcNodes, getDegree).label} + dependencies`;
    }
  }

  // Heuristic 5: mixed — highest-degree node + "cluster"
  const maxDegNode = selectByDegree(communityNodes, getDegree);
  if (getDegree(maxDegNode.id) > 0) {
    return `${maxDegNode.label} cluster`;
  }

  // Heuristic 6: fallback — top 2 labels (sorted) joined with " / "
  if (communityNodes.length === 1) return communityNodes[0].label;
  const sorted = [...communityNodes].sort((a, b) => a.label.localeCompare(b.label));
  return sorted.slice(0, 2).map((n) => n.label).join(" / ");
}

// ---------------------------------------------------------------------------
// autoLabelAllCommunities
// ---------------------------------------------------------------------------

/**
 * Label every community in a communities map.
 *
 * @param communities  Map of communityId → nodeId[]
 * @param nodes        All graph nodes
 * @param edges        All graph edges
 * @returns            Map of communityId → auto-generated label
 */
export function autoLabelAllCommunities(
  communities: Map<number, string[]>,
  nodes: Array<{ id: string; label: string; nodeType: string }>,
  edges: Array<{ source: string; target: string; relation: string }>,
): Map<number, string> {
  const nodeMap = new Map<string, { label: string; nodeType: string }>();
  for (const n of nodes) {
    nodeMap.set(n.id, { label: n.label, nodeType: n.nodeType });
  }

  const labels = new Map<number, string>();
  for (const [communityId, nodeIds] of communities) {
    labels.set(communityId, autoLabelCommunity(communityId, nodeIds, nodeMap, edges));
  }

  return labels;
}
