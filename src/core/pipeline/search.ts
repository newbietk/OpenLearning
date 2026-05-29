import type { GraphNodeRecord, GraphEdgeRecord, SearchResult } from "./types";

// ---------------------------------------------------------------------------
// Vocabulary helpers (for graphify query expansion)
// ---------------------------------------------------------------------------

const CAMEL_BOUNDARY_1 = /([a-z])([A-Z])/g;
const CAMEL_BOUNDARY_2 = /([A-Z]+)([A-Z][a-z])/g;
const SEPARATORS = /[_\-.()\/{}\[\],:;\s]+/;

/**
 * Build a vocabulary of cleaned tokens from node labels.
 *
 * Steps:
 *   1. Split label on common separators (_, -, ., /, etc.)
 *   2. Split CamelCase / PascalCase within each chunk
 *   3. Keep words 3-30 chars, lowercase, deduplicate, sort
 */
export function buildVocabulary(nodes: Array<{ label: string }>): string[] {
  const tokenSet = new Set<string>();

  for (const node of nodes) {
    const label = node.label;
    if (label.length === 0) continue;

    const chunks = label.split(SEPARATORS).filter(Boolean);

    for (const chunk of chunks) {
      const camelTokens = chunk
        .replace(CAMEL_BOUNDARY_1, "$1 $2")
        .replace(CAMEL_BOUNDARY_2, "$1 $2")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      for (const token of camelTokens) {
        if (token.length >= 3 && token.length <= 30) {
          tokenSet.add(token);
        }
      }
    }
  }

  return [...tokenSet].sort();
}

const MAX_EXPAND_TOKENS = 12;

/**
 * Expand a user query using a pre-built vocabulary from graph node labels.
 *
 * Algorithm (graphify query mode Step 0):
 *   1. Tokenize the query
 *   2. For each query token, find vocabulary tokens that semantically match
 *      (exact match, substring, or reverse-substring containment)
 *   3. Only return tokens PRESENT in the vocabulary — never invent
 *   4. Return at most 12 tokens
 *   5. Return empty array if no matches
 */
export function expandQuery(
  query: string,
  vocabulary: string[],
): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0 || vocabulary.length === 0) return [];

  const queryTokens = trimmed
    .split(SEPARATORS)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const matched = new Set<string>();

  for (const qToken of queryTokens) {
    if (qToken.length < 3) continue;

    for (const vocabToken of vocabulary) {
      if (matched.has(vocabToken)) continue;

      if (vocabToken === qToken || vocabToken.includes(qToken) || qToken.includes(vocabToken)) {
        matched.add(vocabToken);
      }
    }
  }

  return [...matched].slice(0, MAX_EXPAND_TOKENS);
}

// ---------------------------------------------------------------------------
// Character helpers
// ---------------------------------------------------------------------------

function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x2e80 && cp <= 0x2eff) || // CJK Radicals Supplement
    (cp >= 0x3000 && cp <= 0x303f) || // CJK Symbols and Punctuation
    (cp >= 0x3200 && cp <= 0x32ff) || // Enclosed CJK Letters and Months
    (cp >= 0x3300 && cp <= 0x33ff)    // CJK Compatibility
  );
}

function isAsciiPrintable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i);
    if (cp === undefined || cp < 32 || cp > 126) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Label normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a label for matching:
 * - lowercase
 * - NFKD + strip combining diacritical marks
 * - strip trailing "()"
 */
function cleanLabel(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(\)$/, "");
}

// ---------------------------------------------------------------------------
// Adjacency helpers
// ---------------------------------------------------------------------------

function addAdjacency(
  adj: Map<string, Set<string>>,
  a: string,
  b: string,
): void {
  let set = adj.get(a);
  if (!set) {
    set = new Set<string>();
    adj.set(a, set);
  }
  set.add(b);
}

function buildUndirectedAdjacency(
  edges: readonly GraphEdgeRecord[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    addAdjacency(adj, e.sourceNodeId, e.targetNodeId);
    addAdjacency(adj, e.targetNodeId, e.sourceNodeId);
  }
  return adj;
}

function computeDegrees(
  nodeIds: readonly string[],
  adj: Map<string, Set<string>>,
): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const id of nodeIds) {
    degrees.set(id, adj.get(id)?.size ?? 0);
  }
  return degrees;
}

function percentile99(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = 0.99 * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ---------------------------------------------------------------------------
// processQuery
// ---------------------------------------------------------------------------

export function processQuery(query: string): string[] {
  const raw = query.trim();
  if (raw.length === 0) return [];

  const rawTokens = raw.split(/\s+/);
  const normalized: string[] = [];

  for (const token of rawTokens) {
    if (token.length === 0) continue;

    const norm = token
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "");

    const hasCJK = [...norm].some((ch) => isCJK(ch.codePointAt(0) ?? 0));

    if (hasCJK) {
      const chars = [...norm];
      if (chars.length === 1) {
        normalized.push(norm);
      } else {
        for (let i = 0; i < chars.length; i++) {
          normalized.push(chars[i]);
          if (i + 1 < chars.length) {
            normalized.push(chars[i] + chars[i + 1]);
          }
        }
      }
    } else {
      normalized.push(norm);
    }
  }

  return normalized.filter((t) => t.length >= 3 || !isAsciiPrintable(t));
}

// ---------------------------------------------------------------------------
// scoreNodes helpers
// ---------------------------------------------------------------------------

function computeTermIdfs(
  nodes: readonly GraphNodeRecord[],
  queryTerms: readonly string[],
): number[] {
  const N = nodes.length;
  const idfs: number[] = [];
  for (const term of queryTerms) {
    let df = 0;
    for (const node of nodes) {
      if (cleanLabel(node.label).includes(term)) df++;
    }
    idfs.push(Math.log(1 + N / (1 + df)));
  }
  return idfs;
}

// ---------------------------------------------------------------------------
// scoreNodes
// ---------------------------------------------------------------------------

export function scoreNodes(
  nodes: readonly GraphNodeRecord[],
  queryTerms: readonly string[],
): Map<string, number> {
  const scores = new Map<string, number>();
  if (nodes.length === 0 || queryTerms.length === 0) return scores;

  const termIdfs = computeTermIdfs(nodes, queryTerms);

  for (const node of nodes) {
    const cleaned = cleanLabel(node.label);
    let totalScore = 0;
    let hasMatch = false;

    for (let t = 0; t < queryTerms.length; t++) {
      const term = queryTerms[t];
      if (!cleaned.includes(term)) continue;

      hasMatch = true;
      const idfWeight = termIdfs[t];

      // Three-tier matching -- only ONE tier per term (highest wins)
      if (cleaned === term) {
        totalScore += 1000.0 * idfWeight;
      } else if (cleaned.startsWith(term)) {
        totalScore += 100.0 * idfWeight;
      } else {
        totalScore += 1.0 * idfWeight;
      }

      // Source file match bonus (additive)
      if (node.sourceDocId !== null) {
        totalScore += 0.5 * idfWeight;
      }
    }

    if (hasMatch) {
      scores.set(node.id, totalScore);
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// pickSeeds
// ---------------------------------------------------------------------------

const MAX_K = 3;
const DEFAULT_GAP_RATIO = 0.2;

export function pickSeeds(
  scored: Map<string, number>,
  gapRatio: number = DEFAULT_GAP_RATIO,
): string[] {
  if (scored.size === 0) return [];

  const entries = [...scored.entries()].sort((a, b) => b[1] - a[1]);
  const topScore = entries[0][1];
  const threshold = topScore * gapRatio;

  const seeds: string[] = [];
  for (const [id, score] of entries) {
    if (score < threshold) break;
    seeds.push(id);
    if (seeds.length >= MAX_K) break;
  }

  return seeds;
}

// ---------------------------------------------------------------------------
// bfsTraverse helpers
// ---------------------------------------------------------------------------

const DEFAULT_HUB_THRESHOLD = 50;

function computeHubThreshold(degrees: Map<string, number>): number {
  const values = [...degrees.values()];
  const p99 = percentile99(values);
  return Math.max(DEFAULT_HUB_THRESHOLD, p99);
}

function collectEdgesForNode(
  edges: readonly GraphEdgeRecord[],
  currentId: string,
  visited: ReadonlySet<string>,
  seenEdgeIds: Set<string>,
  resultEdges: GraphEdgeRecord[],
): void {
  for (const e of edges) {
    if (seenEdgeIds.has(e.id)) continue;
    if (
      (e.sourceNodeId === currentId || e.targetNodeId === currentId) &&
      visited.has(e.sourceNodeId) &&
      visited.has(e.targetNodeId)
    ) {
      seenEdgeIds.add(e.id);
      resultEdges.push(e);
    }
  }
}

function collectRemainingEdges(
  edges: readonly GraphEdgeRecord[],
  visited: ReadonlySet<string>,
  seenEdgeIds: Set<string>,
  resultEdges: GraphEdgeRecord[],
): void {
  for (const e of edges) {
    if (seenEdgeIds.has(e.id)) continue;
    if (visited.has(e.sourceNodeId) && visited.has(e.targetNodeId)) {
      seenEdgeIds.add(e.id);
      resultEdges.push(e);
    }
  }
}

// ---------------------------------------------------------------------------
// bfsTraverse
// ---------------------------------------------------------------------------

export function bfsTraverse(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
  seedIds: readonly string[],
  maxDepth: number = 2,
): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] } {
  if (seedIds.length === 0) return { nodes: [], edges: [] };

  const nodeMap = new Map<string, GraphNodeRecord>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const adj = buildUndirectedAdjacency(edges);
  const degrees = computeDegrees(
    nodes.map((n) => n.id),
    adj,
  );
  const hubThreshold = computeHubThreshold(degrees);
  const seedSet = new Set(seedIds);

  const visited = new Set<string>();
  const resultNodes: GraphNodeRecord[] = [];
  const resultEdges: GraphEdgeRecord[] = [];
  const seenEdgeIds = new Set<string>();

  let frontier: string[] = [...seedIds].filter((id) => nodeMap.has(id));
  for (const id of frontier) {
    if (!visited.has(id)) {
      visited.add(id);
      const node = nodeMap.get(id);
      if (node) resultNodes.push(node);
    }
  }

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const currentId of frontier) {
      const neighbors = adj.get(currentId);
      if (!neighbors) continue;

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;

        if (!seedSet.has(neighborId)) {
          const deg = degrees.get(neighborId) ?? 0;
          if (deg >= hubThreshold) continue;
        }

        visited.add(neighborId);
        const neighborNode = nodeMap.get(neighborId);
        if (neighborNode) resultNodes.push(neighborNode);
        nextFrontier.push(neighborId);
      }

      collectEdgesForNode(edges, currentId, visited, seenEdgeIds, resultEdges);
    }

    collectRemainingEdges(edges, visited, seenEdgeIds, resultEdges);

    frontier = nextFrontier;
  }

  return { nodes: resultNodes, edges: resultEdges };
}

// ---------------------------------------------------------------------------
// keywordsSearch
// ---------------------------------------------------------------------------

export function keywordsSearch(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
  query: string,
  kbId: string,
  maxDepth: number = 2,
  maxResults: number = 20,
): SearchResult[] {
  const terms = processQuery(query);
  if (terms.length === 0) return [];

  const kbNodes = nodes.filter((n) => n.kbId === kbId);
  if (kbNodes.length === 0) return [];

  const kbEdges = edges.filter((e) => e.kbId === kbId);

  const scored = scoreNodes(kbNodes, terms);
  const seeds = pickSeeds(scored);
  if (seeds.length === 0) return [];

  const results: SearchResult[] = [];

  for (const seedId of seeds.slice(0, maxResults)) {
    const traversed = bfsTraverse(kbNodes, kbEdges, [seedId], maxDepth);
    const seedScore = scored.get(seedId) ?? 0;

    const seenNodeIds = new Set<string>();
    const uniqueNodes: GraphNodeRecord[] = [];
    for (const n of traversed.nodes) {
      if (!seenNodeIds.has(n.id)) {
        seenNodeIds.add(n.id);
        uniqueNodes.push(n);
      }
    }

    results.push({
      nodes: uniqueNodes,
      edges: traversed.edges,
      chunks: [],
      score: seedScore,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// getNode
// ---------------------------------------------------------------------------

export function getNode(
  nodes: readonly GraphNodeRecord[],
  label: string,
): GraphNodeRecord | null {
  const normalized = cleanLabel(label);
  if (normalized.length === 0 || nodes.length === 0) return null;

  let best: GraphNodeRecord | null = null;

  // Tier 1: exact
  for (const node of nodes) {
    if (cleanLabel(node.label) === normalized) return node;
  }

  // Tier 2: prefix
  for (const node of nodes) {
    if (cleanLabel(node.label).startsWith(normalized)) {
      best = best ?? node;
    }
  }
  if (best) return best;

  // Tier 3: substring
  for (const node of nodes) {
    if (cleanLabel(node.label).includes(normalized)) {
      best = best ?? node;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// getNeighbors
// ---------------------------------------------------------------------------

export function getNeighbors(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
  nodeId: string,
  kbId: string,
  relation?: string,
): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] } {
  const nodeMap = new Map<string, GraphNodeRecord>();
  for (const n of nodes) {
    if (n.kbId === kbId) nodeMap.set(n.id, n);
  }

  let filteredEdges = edges.filter((e) => e.kbId === kbId);
  if (relation !== undefined) {
    filteredEdges = filteredEdges.filter((e) => e.relation === relation);
  }

  const adj = buildUndirectedAdjacency(filteredEdges);
  const neighborIds = adj.get(nodeId);
  if (!neighborIds) return { nodes: [], edges: [] };

  const resultNodes: GraphNodeRecord[] = [];
  const resultEdges: GraphEdgeRecord[] = [];

  for (const nid of neighborIds) {
    const node = nodeMap.get(nid);
    if (node) resultNodes.push(node);
  }

  for (const e of filteredEdges) {
    if (
      (e.sourceNodeId === nodeId && neighborIds.has(e.targetNodeId)) ||
      (e.targetNodeId === nodeId && neighborIds.has(e.sourceNodeId))
    ) {
      resultEdges.push(e);
    }
  }

  return { nodes: resultNodes, edges: resultEdges };
}

// ---------------------------------------------------------------------------
// godNodes
// ---------------------------------------------------------------------------

export function godNodes(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
  limit: number = 10,
): GraphNodeRecord[] {
  if (nodes.length === 0) return [];

  const adj = buildUndirectedAdjacency(edges);
  const degrees = computeDegrees(
    nodes.map((n) => n.id),
    adj,
  );

  const sorted = [...nodes].sort((a, b) => {
    const degB = degrees.get(b.id) ?? 0;
    const degA = degrees.get(a.id) ?? 0;
    return degB - degA;
  });

  return sorted.slice(0, limit);
}

// ---------------------------------------------------------------------------
// graphStats
// ---------------------------------------------------------------------------

export function graphStats(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
): { nodeCount: number; edgeCount: number } {
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

// ---------------------------------------------------------------------------
// shortestPath
// ---------------------------------------------------------------------------

export function shortestPath(
  nodes: readonly GraphNodeRecord[],
  edges: readonly GraphEdgeRecord[],
  fromLabel: string,
  toLabel: string,
): GraphNodeRecord[] | null {
  if (nodes.length === 0) return null;

  const fromNode = getNode(nodes, fromLabel);
  const toNode = getNode(nodes, toLabel);
  if (!fromNode || !toNode) return null;
  if (fromNode.id === toNode.id) return [fromNode];

  const nodeMap = new Map<string, GraphNodeRecord>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  const adj = buildUndirectedAdjacency(edges);
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [fromNode.id];
  visited.add(fromNode.id);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === toNode.id) {
      const path: GraphNodeRecord[] = [];
      let cur: string | undefined = toNode.id;
      while (cur !== undefined) {
        const n = nodeMap.get(cur);
        if (n) path.unshift(n);
        cur = parent.get(cur);
      }
      return path;
    }

    const neighbors = adj.get(current);
    if (!neighbors) continue;

    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      parent.set(neighborId, current);
      queue.push(neighborId);
    }
  }

  return null;
}
