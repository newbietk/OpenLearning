import type { GraphNodeRecord, GraphEdgeRecord } from "./types";

// ─── surprisingConnections ──────────────────────────────────────────────────

/**
 * Find cross-community edges, sorted by bridge score (rarer = higher).
 * Bridge score = 1/(cross_edges_between_communities + 1) * confidence.
 * Returns top 20 most surprising connections.
 *
 * @param minCommunitySize Skip edges where either community has fewer members
 *                         than this threshold (default 2).
 * @param minBridgeScore   Minimum bridge score for a connection to be included
 *                         (default 0.01).
 */
export function surprisingConnections(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  communities: Map<number, string[]>,
  minCommunitySize: number = 2,
  minBridgeScore: number = 0.01,
): Array<{
  from: string;
  to: string;
  relation: string;
  fromCommunity: number;
  toCommunity: number;
  bridgeScore: number;
  reason: string;
}> {
  if (nodes.length === 0 || edges.length === 0 || communities.size === 0) {
    return [];
  }

  const nodeIdToLabel = buildLabelLookup(nodes);
  const nodeIdToCommunity = buildNodeCommunityIndex(communities);
  const crossEdges = collectCrossCommunityEdges(edges, nodeIdToCommunity);
  if (crossEdges.length === 0) return [];

  // Build community size lookup
  const commSizes = new Map<number, number>();
  for (const [commId, members] of communities) {
    commSizes.set(commId, members.length);
  }

  // Filter to only cross-community edges where both communities meet min size
  const validCrossEdges = crossEdges.filter((ce) => {
    const fromSize = commSizes.get(ce.fromCommunity) ?? 0;
    const toSize = commSizes.get(ce.toCommunity) ?? 0;
    return fromSize >= minCommunitySize && toSize >= minCommunitySize;
  });
  if (validCrossEdges.length === 0) return [];

  const pairCounts = countEdgesPerCommunityPair(validCrossEdges);
  const results = validCrossEdges.map((ce) =>
    buildSurprisingResult(ce, pairCounts, nodeIdToLabel),
  );

  results.sort((a, b) => b.bridgeScore - a.bridgeScore);
  const filtered = results.filter((r) => r.bridgeScore >= minBridgeScore);
  return filtered.slice(0, 20);
}

// ─── suggestQuestions ────────────────────────────────────────────────────────

/**
 * Generate 5-10 natural language questions about the graph structure,
 * based on bridge nodes, sparse community connections, high-degree nodes,
 * community relationships, key symbols, and file bridging.
 *
 * Only communities with size > 1 are considered for question generation.
 */
export function suggestQuestions(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  communities: Map<number, string[]>,
  communityLabels?: Map<number, string>,
): string[] {
  if (nodes.length === 0 || edges.length === 0 || communities.size === 0) {
    return [];
  }

  const nodeIdToCommunity = buildNodeCommunityIndex(communities);

  // Only consider communities with size > 1
  const largeComms = filterLargeCommunities(communities, 2);
  if (largeComms.size === 0) return [];

  const commSizes = buildCommSizeLookup(communities);
  const questions: string[] = [];

  // 1. Questions about bridge nodes
  questions.push(
    ...generateBridgeNodeQuestions(nodes, edges, largeComms, communityLabels),
  );

  // 2. Community pair relationship questions (1-2 edge sparse pairs)
  questions.push(
    ...generateCommunityPairQuestions(edges, nodeIdToCommunity, commSizes, communityLabels),
  );

  // 3. Key symbol questions for largest communities
  questions.push(
    ...generateKeySymbolQuestions(largeComms, communityLabels),
  );

  // 4. File bridge questions
  questions.push(
    ...generateFileBridgeQuestions(nodes, edges, largeComms, communityLabels, nodeIdToCommunity),
  );

  // 5. Questions about community pairs with sparse edges (1-3)
  questions.push(
    ...generateSparsePairQuestions(edges, nodeIdToCommunity, commSizes, communityLabels),
  );

  // 6. Questions about high-degree nodes per community
  questions.push(
    ...generateHighDegreeQuestions(nodes, edges, nodeIdToCommunity, communityLabels),
  );

  return questions.slice(0, 10);
}

// ─── findBridgeNodes ─────────────────────────────────────────────────────────

/**
 * Find nodes that have edges connecting to 2 or more communities.
 * A node's own community is excluded from the count.
 */
export function findBridgeNodes(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  communities: Map<number, string[]>,
): Array<{ node: GraphNodeRecord; connectingCommunities: number[] }> {
  if (nodes.length === 0 || edges.length === 0 || communities.size === 0) {
    return [];
  }

  const nodeIdToCommunity = buildNodeCommunityIndex(communities);
  const nodeMap = buildNodeMap(nodes);
  const nodeConnections = gatherNodeCommunityConnections(edges, nodeIdToCommunity);

  const result: Array<{
    node: GraphNodeRecord;
    connectingCommunities: number[];
  }> = [];

  for (const [nodeId, commSet] of nodeConnections) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const otherCommunities = filterOwnCommunity(
      commSet, nodeIdToCommunity.get(nodeId),
    );

    if (otherCommunities.length >= 2) {
      result.push({ node, connectingCommunities: otherCommunities });
    }
  }

  return result;
}

// ─── graphDiff ──────────────────────────────────────────────────────────────

/**
 * Compute the difference between two graph snapshots (old vs new).
 * Returns added/removed node IDs, edge counts, and a human-readable summary.
 */
export function graphDiff(
  oldNodes: GraphNodeRecord[],
  oldEdges: GraphEdgeRecord[],
  newNodes: GraphNodeRecord[],
  newEdges: GraphEdgeRecord[],
): {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: number;
  removedEdges: number;
  summary: string;
} {
  const oldNodeIds = new Set(oldNodes.map((n) => n.id));
  const newNodeIds = new Set(newNodes.map((n) => n.id));
  const oldEdgeIds = new Set(oldEdges.map((e) => e.id));
  const newEdgeIds = new Set(newEdges.map((e) => e.id));

  const addedNodes = setDifference(newNodeIds, oldNodeIds);
  const removedNodes = setDifference(oldNodeIds, newNodeIds);
  const addedEdges = countSetDifference(newEdgeIds, oldEdgeIds);
  const removedEdges = countSetDifference(oldEdgeIds, newEdgeIds);

  const summary = buildDiffSummary(addedNodes, removedNodes, addedEdges, removedEdges);
  return { addedNodes, removedNodes, addedEdges, removedEdges, summary };
}

// ─── surprisingConnections helpers ──────────────────────────────────────────

interface CrossEdge {
  edge: GraphEdgeRecord;
  fromCommunity: number;
  toCommunity: number;
}

function collectCrossCommunityEdges(
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
): CrossEdge[] {
  const result: CrossEdge[] = [];
  for (const edge of edges) {
    const srcComm = nodeIdToCommunity.get(edge.sourceNodeId);
    const tgtComm = nodeIdToCommunity.get(edge.targetNodeId);
    if (srcComm === undefined || tgtComm === undefined || srcComm === tgtComm) {
      continue;
    }
    result.push({ edge, fromCommunity: srcComm, toCommunity: tgtComm });
  }
  return result;
}

function countEdgesPerCommunityPair(
  crossEdges: CrossEdge[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ce of crossEdges) {
    const key = communityPairKey(ce.fromCommunity, ce.toCommunity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function buildSurprisingResult(
  ce: CrossEdge,
  pairCounts: Map<string, number>,
  nodeIdToLabel: Map<string, string>,
): {
  from: string;
  to: string;
  relation: string;
  fromCommunity: number;
  toCommunity: number;
  bridgeScore: number;
  reason: string;
} {
  const pairKey = communityPairKey(ce.fromCommunity, ce.toCommunity);
  const pairEdgeCount = pairCounts.get(pairKey) ?? 1;
  const bridgeScore =
    (1 / (pairEdgeCount + 1)) * ce.edge.confidence;

  const fromLabel = nodeIdToLabel.get(ce.edge.sourceNodeId) ?? ce.edge.sourceNodeId;
  const toLabel = nodeIdToLabel.get(ce.edge.targetNodeId) ?? ce.edge.targetNodeId;

  return {
    from: fromLabel,
    to: toLabel,
    relation: ce.edge.relation,
    fromCommunity: ce.fromCommunity,
    toCommunity: ce.toCommunity,
    bridgeScore: Math.round(bridgeScore * 10000) / 10000,
    reason: `Cross-community edge (${fromLabel} -> ${toLabel}) between community ${ce.fromCommunity} and ${ce.toCommunity}`,
  };
}

// ─── suggestQuestions helpers ────────────────────────────────────────────────

function generateBridgeNodeQuestions(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  communities: Map<number, string[]>,
  communityLabels?: Map<number, string>,
): string[] {
  const questions: string[] = [];
  const bridgeNodes = findBridgeNodes(nodes, edges, communities);

  for (const bn of bridgeNodes.slice(0, 3)) {
    const connComms = bn.connectingCommunities;
    if (connComms.length >= 2) {
      questions.push(
        `How does ${bn.node.label} connect ${communityLabel(connComms[0], communityLabels)} and ${communityLabel(connComms[1], communityLabels)}?`,
      );
    }
  }
  return questions;
}

function generateCommunityPairQuestions(
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
  commSizes: Map<number, number>,
  communityLabels?: Map<number, string>,
): string[] {
  const questions: string[] = [];
  const pairEdges = countCommunityPairEdges(edges, nodeIdToCommunity);

  let count = 0;
  for (const [pairKey, edgeCount] of pairEdges) {
    if (edgeCount < 1 || edgeCount > 2) continue;
    if (count >= 2) break;

    const [c1, c2] = pairKey.split(":").map(Number);
    const size1 = commSizes.get(c1) ?? 0;
    const size2 = commSizes.get(c2) ?? 0;
    if (size1 < 2 || size2 < 2) continue;

    questions.push(
      `How does ${communityLabel(c1, communityLabels)} relate to ${communityLabel(c2, communityLabels)}?`,
    );
    count++;
  }
  return questions;
}

function generateKeySymbolQuestions(
  communities: Map<number, string[]>,
  communityLabels?: Map<number, string>,
): string[] {
  const sorted = Array.from(communities.entries())
    .sort((a, b) => b[1].length - a[1].length);

  const questions: string[] = [];
  for (const [commId] of sorted.slice(0, 2)) {
    const name = communityLabel(commId, communityLabels);
    questions.push(`What are the key symbols in ${name}?`);
  }
  return questions;
}

function generateFileBridgeQuestions(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  communities: Map<number, string[]>,
  communityLabels: Map<number, string> | undefined,
  nodeIdToCommunity: Map<string, number>,
): string[] {
  const nodeMap = buildNodeMap(nodes);
  const bridgeNodes = findBridgeNodes(nodes, edges, communities);
  const questions: string[] = [];

  for (const bn of bridgeNodes) {
    if (questions.length >= 2) break;

    const sourceFile = getSourceFile(bn.node);
    if (!sourceFile) continue;

    // Find a connected node in a different community with a different source file
    for (const commId of bn.connectingCommunities) {
      if (questions.length >= 2) break;
      const members = communities.get(commId);
      if (!members) continue;

      for (const memberId of members) {
        const member = nodeMap.get(memberId);
        if (!member) continue;
        const memberFile = getSourceFile(member);
        if (!memberFile || memberFile === sourceFile) continue;

        questions.push(
          `Which symbols bridge ${sourceFile} and ${memberFile}?`,
        );
        break;
      }
    }
  }
  return questions;
}

function getSourceFile(node: GraphNodeRecord): string | null {
  const val = node.metadata.source_file;
  if (typeof val === "string" && val.length > 0) {
    return val;
  }
  return null;
}

function generateSparsePairQuestions(
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
  commSizes: Map<number, number>,
  communityLabels?: Map<number, string>,
): string[] {
  const questions: string[] = [];
  const pairEdges = countCommunityPairEdges(edges, nodeIdToCommunity);

  let count = 0;
  for (const [pairKey, edgeCount] of pairEdges) {
    if (edgeCount < 1 || edgeCount > 3) continue;
    if (count >= 3) break;

    const [c1, c2] = pairKey.split(":").map(Number);
    const size1 = commSizes.get(c1) ?? 0;
    const size2 = commSizes.get(c2) ?? 0;
    if (size1 < 2 || size2 < 2) continue;

    questions.push(
      `What connects ${communityLabel(c1, communityLabels)} and ${communityLabel(c2, communityLabels)}?`,
    );
    count++;
  }
  return questions;
}

function generateHighDegreeQuestions(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
  communityLabels?: Map<number, string>,
): string[] {
  const questions: string[] = [];
  const topNodes = topNodePerCommunity(nodes, edges, nodeIdToCommunity);

  for (const [commId, topNodeLabel] of topNodes) {
    if (questions.length >= 8) break;
    questions.push(
      `What are the dependencies of ${topNodeLabel} in ${communityLabel(commId, communityLabels)}?`,
    );
  }
  return questions;
}

function filterLargeCommunities(
  communities: Map<number, string[]>,
  minSize: number,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const [commId, members] of communities) {
    if (members.length >= minSize) {
      result.set(commId, members);
    }
  }
  return result;
}

function buildCommSizeLookup(
  communities: Map<number, string[]>,
): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const [commId, members] of communities) {
    sizes.set(commId, members.length);
  }
  return sizes;
}

// ─── graphDiff helpers ──────────────────────────────────────────────────────

function setDifference<T>(a: Set<T>, b: Set<T>): T[] {
  const result: T[] = [];
  for (const item of a) {
    if (!b.has(item)) result.push(item);
  }
  return result;
}

function countSetDifference<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const item of a) {
    if (!b.has(item)) count++;
  }
  return count;
}

function buildDiffSummary(
  addedNodes: string[],
  removedNodes: string[],
  addedEdges: number,
  removedEdges: number,
): string {
  const parts: string[] = [];
  if (addedNodes.length > 0) parts.push(`${addedNodes.length} node(s) added`);
  if (removedNodes.length > 0) parts.push(`${removedNodes.length} node(s) removed`);
  if (addedEdges > 0) parts.push(`${addedEdges} edge(s) added`);
  if (removedEdges > 0) parts.push(`${removedEdges} edge(s) removed`);
  return parts.length > 0
    ? `Graph diff: ${parts.join(", ")}.`
    : "Graph diff: no changes.";
}

// ─── internal helpers ───────────────────────────────────────────────────────

function buildLabelLookup(nodes: GraphNodeRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    map.set(node.id, node.label);
  }
  return map;
}

function buildNodeMap(nodes: GraphNodeRecord[]): Map<string, GraphNodeRecord> {
  const map = new Map<string, GraphNodeRecord>();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}

function buildNodeCommunityIndex(
  communities: Map<number, string[]>,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const [commId, nodeIds] of communities) {
    for (const nodeId of nodeIds) {
      index.set(nodeId, commId);
    }
  }
  return index;
}

function communityPairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function communityLabel(
  commId: number,
  communityLabels?: Map<number, string>,
): string {
  const label = communityLabels?.get(commId);
  if (label) return label;
  return `Community ${commId}`;
}

function addConnection(
  map: Map<string, Set<number>>,
  nodeId: string,
  communityId: number,
): void {
  const set = map.get(nodeId);
  if (set) {
    set.add(communityId);
  } else {
    map.set(nodeId, new Set([communityId]));
  }
}

function gatherNodeCommunityConnections(
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
): Map<string, Set<number>> {
  const connections = new Map<string, Set<number>>();
  for (const edge of edges) {
    const tgtComm = nodeIdToCommunity.get(edge.targetNodeId);
    if (tgtComm !== undefined) {
      addConnection(connections, edge.sourceNodeId, tgtComm);
    }
    const srcComm = nodeIdToCommunity.get(edge.sourceNodeId);
    if (srcComm !== undefined) {
      addConnection(connections, edge.targetNodeId, srcComm);
    }
  }
  return connections;
}

function filterOwnCommunity(
  commSet: Set<number>,
  ownComm: number | undefined,
): number[] {
  const filtered = ownComm !== undefined
    ? Array.from(commSet).filter((c) => c !== ownComm)
    : Array.from(commSet);
  filtered.sort((a, b) => a - b);
  return filtered;
}

function computeNodeDegrees(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of nodes) {
    degrees.set(node.id, 0);
  }
  for (const edge of edges) {
    degrees.set(edge.sourceNodeId, (degrees.get(edge.sourceNodeId) ?? 0) + 1);
    degrees.set(edge.targetNodeId, (degrees.get(edge.targetNodeId) ?? 0) + 1);
  }
  return degrees;
}

function countCommunityPairEdges(
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const edge of edges) {
    const srcComm = nodeIdToCommunity.get(edge.sourceNodeId);
    const tgtComm = nodeIdToCommunity.get(edge.targetNodeId);
    if (srcComm === undefined || tgtComm === undefined || srcComm === tgtComm) {
      continue;
    }
    const key = communityPairKey(srcComm, tgtComm);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function topNodePerCommunity(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  nodeIdToCommunity: Map<string, number>,
): Map<number, string> {
  const degrees = computeNodeDegrees(nodes, edges);
  const communityNodes = groupNodesByCommunity(nodes, nodeIdToCommunity, degrees);
  const result = new Map<number, string>();

  for (const [commId, nodeList] of communityNodes) {
    if (nodeList.length === 0) continue;
    nodeList.sort((a, b) => b.degree - a.degree);
    const top = nodes.find((n) => n.id === nodeList[0].id);
    if (top) result.set(commId, top.label);
  }
  return result;
}

function groupNodesByCommunity(
  nodes: GraphNodeRecord[],
  nodeIdToCommunity: Map<string, number>,
  degrees: Map<string, number>,
): Map<number, Array<{ id: string; degree: number }>> {
  const groups = new Map<number, Array<{ id: string; degree: number }>>();
  for (const node of nodes) {
    const comm = nodeIdToCommunity.get(node.id);
    if (comm === undefined) continue;
    const list = groups.get(comm) ?? [];
    list.push({ id: node.id, degree: degrees.get(node.id) ?? 0 });
    groups.set(comm, list);
  }
  return groups;
}
