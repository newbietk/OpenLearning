// ─── internal types ───────────────────────────────────────────────────────

interface Adjacency {
  neighbors: Map<string, number>;
}

interface LouvainState {
  nodeComm: Map<string, number>;
  commTot: Map<number, number>;
  commIn: Map<number, number>;
}

interface ScoreContext {
  m: number;
  commIn: Map<number, number>;
  commTot: Map<number, number>;
}

// ─── buildAdjacencyMap ──────────────────────────────────────────────────────

function buildAdjacencyMap(
  nodes: { id: string; label: string }[],
  edges: { source: string; target: string; weight?: number }[],
): Map<string, Adjacency> {
  const adj = new Map<string, Adjacency>();
  for (const node of nodes) {
    adj.set(node.id, { neighbors: new Map() });
  }
  for (const edge of edges) {
    const w = edge.weight ?? 1;
    const src = adj.get(edge.source);
    const tgt = adj.get(edge.target);
    if (!src || !tgt) {
      continue;
    }
    const curSrc = src.neighbors.get(edge.target) ?? 0;
    src.neighbors.set(edge.target, curSrc + w);
    const curTgt = tgt.neighbors.get(edge.source) ?? 0;
    tgt.neighbors.set(edge.source, curTgt + w);
  }
  return adj;
}

// ─── computeDegrees ─────────────────────────────────────────────────────────

function computeDegrees(adj: Map<string, Adjacency>): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const [nodeId, entry] of adj) {
    let deg = 0;
    for (const w of entry.neighbors.values()) {
      deg += w;
    }
    degrees.set(nodeId, deg);
  }
  return degrees;
}

// ─── computeTotalWeight ─────────────────────────────────────────────────────

function computeTotalWeight(degrees: Map<string, number>): number {
  let total = 0;
  for (const deg of degrees.values()) {
    total += deg;
  }
  return total / 2;
}

// ─── buildNodeCommIndex ─────────────────────────────────────────────────────

function buildNodeCommIndex(
  communities: Map<number, string[]>,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const [commIdx, members] of communities) {
    for (const nodeId of members) {
      index.set(nodeId, commIdx);
    }
  }
  return index;
}

// ─── buildScoreContext ──────────────────────────────────────────────────────

/** Compute commIn, commTot, and m for a given community partition. */
function buildScoreContext(
  nodes: { id: string; label: string }[],
  edges: { source: string; target: string; weight?: number }[],
  communities: Map<number, string[]>,
): ScoreContext | null {
  if (nodes.length === 0 || communities.size === 0) {
    return null;
  }

  const adj = buildAdjacencyMap(nodes, edges);
  const degrees = computeDegrees(adj);
  const m = computeTotalWeight(degrees);

  const nodeCommIdx = buildNodeCommIndex(communities);

  // Compute Σ_tot per community from degrees
  const commTot = new Map<number, number>();
  for (const [commIdx, members] of communities) {
    let tot = 0;
    for (const nodeId of members) {
      tot += degrees.get(nodeId) ?? 0;
    }
    commTot.set(commIdx, tot);
  }

  // Compute Σ_in per community by iterating edges once
  const commIn = new Map<number, number>();
  for (const commIdx of communities.keys()) {
    commIn.set(commIdx, 0);
  }

  const visitedPairs = new Set<string>();
  for (const [nodeId, entry] of adj) {
    const nodeComm = nodeCommIdx.get(nodeId) as number;
    for (const [nbrId, w] of entry.neighbors) {
      if (nodeCommIdx.get(nbrId) !== nodeComm) {
        continue;
      }
      const pairKey =
        nodeId < nbrId ? `${nodeId}|${nbrId}` : `${nbrId}|${nodeId}`;
      if (visitedPairs.has(pairKey)) {
        continue;
      }
      visitedPairs.add(pairKey);
      commIn.set(nodeComm, (commIn.get(nodeComm) ?? 0) + w);
    }
  }

  return { m, commIn, commTot };
}

// ─── tryMoveNode ────────────────────────────────────────────────────────────

/**
 * Evaluate moving a single node to each neighbor's community and apply the
 * best move. Returns true if the node changed communities.
 */
function tryMoveNode(
  state: LouvainState,
  nodeId: string,
  ki: number,
  nbrs: Map<string, number> | undefined,
  m: number,
  twoM2: number,
): boolean {
  // Remove node from its current community
  const oldComm = state.nodeComm.get(nodeId) as number;

  let kiInOld = 0;
  if (nbrs) {
    for (const [nbrId, w] of nbrs) {
      if (state.nodeComm.get(nbrId) === oldComm) {
        kiInOld += w;
      }
    }
  }

  const oldTot = state.commTot.get(oldComm) ?? 0;
  const oldIn = state.commIn.get(oldComm) ?? 0;
  state.commTot.set(oldComm, oldTot - ki);
  state.commIn.set(oldComm, oldIn - kiInOld);

  // Collect k_i_in for each neighbor community
  const commGains = new Map<number, number>();
  if (nbrs && ki > 0 && m > 0) {
    for (const [nbrId, w] of nbrs) {
      const nbrComm = state.nodeComm.get(nbrId) as number;
      const cur = commGains.get(nbrComm) ?? 0;
      commGains.set(nbrComm, cur + w);
    }
  }
  // Always consider original community (for staying put)
  if (!commGains.has(oldComm)) {
    commGains.set(oldComm, 0);
  }

  // Find best community
  let bestComm = oldComm;
  let bestDelta = 0;

  if (m > 0) {
    for (const [candComm, kiIn] of commGains) {
      const totC = state.commTot.get(candComm) ?? 0;
      const delta = kiIn / m - (totC * ki) / twoM2;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestComm = candComm;
      }
    }
  }

  // Apply the move
  state.nodeComm.set(nodeId, bestComm);

  let kiInNew = 0;
  if (nbrs) {
    for (const [nbrId, w] of nbrs) {
      if (state.nodeComm.get(nbrId) === bestComm) {
        kiInNew += w;
      }
    }
  }

  const newTot = state.commTot.get(bestComm) ?? 0;
  const newIn = state.commIn.get(bestComm) ?? 0;
  state.commTot.set(bestComm, newTot + ki);
  state.commIn.set(bestComm, newIn + kiInNew);

  // Clean up empty communities
  if (bestComm !== oldComm) {
    const remainingTot = state.commTot.get(oldComm) ?? 0;
    if (remainingTot <= 0) {
      state.commTot.delete(oldComm);
      state.commIn.delete(oldComm);
    }
  }

  return bestComm !== oldComm;
}

// ─── detectCommunities ──────────────────────────────────────────────────────

/**
 * Detect communities using the Louvain algorithm (Phase 1 iterative
 * refinement only, without super-node aggregation).
 *
 * Each node starts in its own community. For each node, the algorithm
 * evaluates moving it to each neighbor's community based on the modularity
 * gain ΔQ, and moves the node to the community with the highest positive ΔQ.
 * This repeats until no moves occur or `maxIterations` is reached.
 *
 * @param nodes       Array of node objects with `id` and `label`.
 * @param edges       Array of edge objects with `source`, `target`, and
 *                    optional `weight` (defaults to 1).
 * @param maxIterations Maximum number of refinement passes (default 20).
 * @param filterIsolated When true (default), removes communities composed of a
 *                       single node with degree 0 (no edges). This reduces noise
 *                       and returns only meaningful communities.
 * @returns Map from community index to array of node IDs in that community.
 */
export function detectCommunities(
  nodes: { id: string; label: string }[],
  edges: { source: string; target: string; weight?: number }[],
  maxIterations: number = 20,
  filterIsolated: boolean = true,
): Map<number, string[]> {
  if (nodes.length === 0) {
    return new Map();
  }

  const adj = buildAdjacencyMap(nodes, edges);
  const degrees = computeDegrees(adj);
  const m = computeTotalWeight(degrees);
  const twoM2 = 2 * m * m;

  // Initialize: each node in its own community
  const state: LouvainState = {
    nodeComm: new Map(),
    commTot: new Map(),
    commIn: new Map(),
  };

  let nextCommIdx = 0;
  for (const node of nodes) {
    state.nodeComm.set(node.id, nextCommIdx);
    const deg = degrees.get(node.id) ?? 0;
    state.commTot.set(nextCommIdx, deg);
    state.commIn.set(nextCommIdx, 0);
    nextCommIdx++;
  }

  // Louvain passes
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;

    for (const node of nodes) {
      const nodeId = node.id;
      const ki = degrees.get(nodeId) ?? 0;
      const nbrs = adj.get(nodeId)?.neighbors;

      if (tryMoveNode(state, nodeId, ki, nbrs, m, twoM2)) {
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  // Build result: community index -> node IDs
  const result = new Map<number, string[]>();
  for (const [nodeId, commIdx] of state.nodeComm) {
    const members = result.get(commIdx);
    if (members) {
      members.push(nodeId);
    } else {
      result.set(commIdx, [nodeId]);
    }
  }

  // Filter isolated single-node communities
  if (filterIsolated) {
    for (const [commIdx, members] of result) {
      if (members.length === 1 && (degrees.get(members[0]) ?? 0) === 0) {
        result.delete(commIdx);
      }
    }
  }

  return result;
}

// ─── modularityScore ────────────────────────────────────────────────────────

/**
 * Compute the modularity Q for the given community partition.
 *
 * Q = Σ_c [ Σ_in(c) / m - (Σ_tot(c) / (2m))^2 ]
 *
 * @param nodes       Array of node objects with `id` and `label`.
 * @param edges       Array of edge objects with `source`, `target`, and
 *                    optional `weight` (defaults to 1).
 * @param communities Map from community index to array of node IDs.
 * @returns Modularity score (typically in [-0.5, 1] range).
 */
export function modularityScore(
  nodes: { id: string; label: string }[],
  edges: { source: string; target: string; weight?: number }[],
  communities: Map<number, string[]>,
): number {
  const ctx = buildScoreContext(nodes, edges, communities);
  if (!ctx || ctx.m === 0) {
    return 0;
  }

  let q = 0;
  const twoM = 2 * ctx.m;
  for (const commIdx of communities.keys()) {
    const inC = ctx.commIn.get(commIdx) ?? 0;
    const totC = ctx.commTot.get(commIdx) ?? 0;
    q += inC / ctx.m - (totC / twoM) * (totC / twoM);
  }

  return q;
}

// ─── scoreCommunities ───────────────────────────────────────────────────────

/**
 * Compute a cohesion score for each community.
 *
 * Cohesion = Σ_in(c) / max(Σ_tot(c), 1)
 *
 * Ranges from 0 (no internal edges) to 1 (all edges are internal).
 *
 * @param nodes       Array of node objects with `id` and `label`.
 * @param edges       Array of edge objects with `source`, `target`, and
 *                    optional `weight` (defaults to 1).
 * @param communities Map from community index to array of node IDs.
 * @returns Map from community index to its cohesion score.
 */
export function scoreCommunities(
  nodes: { id: string; label: string }[],
  edges: { source: string; target: string; weight?: number }[],
  communities: Map<number, string[]>,
): Map<number, number> {
  const result = new Map<number, number>();
  const ctx = buildScoreContext(nodes, edges, communities);
  if (!ctx) {
    return result;
  }

  for (const commIdx of communities.keys()) {
    const tot = ctx.commTot.get(commIdx) ?? 0;
    const internal = ctx.commIn.get(commIdx) ?? 0;
    result.set(commIdx, tot > 0 ? internal / tot : 0);
  }

  return result;
}
