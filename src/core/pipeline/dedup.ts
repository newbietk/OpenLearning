import type { GraphNodeRecord, GraphEdgeRecord, MinHashLSH } from "./types";

// ─── MinHash / LSH constants ───────────────────────────────────────────────

const HASH_PRIME = 2147483647; // 2^31 - 1
const HASH_PRIME_BIG = BigInt(2147483647);
const DEFAULT_NUM_PERM = 128;
const K_GRAM = 3;

// ─── deterministic seed generation ─────────────────────────────────────────

function generateSeeds(numPerm: number): { a: number[]; b: number[] } {
  const a: number[] = [];
  const b: number[] = [];
  const MULT_A = 636413622;
  const MULT_B = 144269504;

  for (let i = 0; i < numPerm; i++) {
    a.push(1 + ((i + 1) * MULT_A) % (HASH_PRIME - 1));
    b.push(1 + ((i + 1) * MULT_B) % (HASH_PRIME - 1));
  }
  return { a, b };
}

// Precompute seeds for the default 128 permutations
const DEFAULT_SEEDS = generateSeeds(DEFAULT_NUM_PERM);

// ─── internal hash helpers ─────────────────────────────────────────────────

/** Hash a string to an integer in [0, HASH_PRIME). */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % HASH_PRIME;
  }
  return h;
}

/** Compute (a * x + b) % PRIME using BigInt for precision safety. */
function permuteHash(x: number, a: number, b: number): number {
  return Number(
    (BigInt(a) * BigInt(x) + BigInt(b)) % HASH_PRIME_BIG,
  );
}

// ─── makeMinHash ───────────────────────────────────────────────────────────

export function makeMinHash(
  text: string,
  numPerm: number = DEFAULT_NUM_PERM,
): number[] {
  // 1. Strip all whitespace so that "hello world" and "helloworld" are identical
  const stripped = text.replace(/\s/g, "");

  // 2. Build 3-gram shingles
  const shingles: string[] = [];
  if (stripped.length >= K_GRAM) {
    for (let i = 0; i <= stripped.length - K_GRAM; i++) {
      shingles.push(stripped.substring(i, i + K_GRAM));
    }
  } else if (stripped.length > 0) {
    // For text shorter than 3 chars, use the text itself as a single shingle
    shingles.push(stripped);
  }

  // 3. Hash each shingle to an integer
  const shingleHashes: number[] = [];
  for (const shingle of shingles) {
    shingleHashes.push(hashString(shingle));
  }

  // 4. Get seeds for the requested number of permutations
  const seeds =
    numPerm === DEFAULT_NUM_PERM ? DEFAULT_SEEDS : generateSeeds(numPerm);

  // 5. Compute MinHash: for each permutation, find min(permuteHash(hash, a_i, b_i))
  const signature: number[] = [];
  for (let i = 0; i < numPerm; i++) {
    if (shingleHashes.length === 0) {
      signature.push(HASH_PRIME - 1);
      continue;
    }
    let minVal = HASH_PRIME;
    const ai = seeds.a[i];
    const bi = seeds.b[i];
    for (const h of shingleHashes) {
      const ph = permuteHash(h, ai, bi);
      if (ph < minVal) {
        minVal = ph;
      }
    }
    signature.push(minVal);
  }

  return signature;
}

// ─── MinHashLSHImpl ────────────────────────────────────────────────────────

class MinHashLSHImpl implements MinHashLSH {
  private bands: number;
  private rows: number;
  private buckets: Map<string, Set<string>>[];

  constructor(bands: number, rows: number) {
    this.bands = bands;
    this.rows = rows;
    this.buckets = [];
    for (let i = 0; i < bands; i++) {
      this.buckets[i] = new Map<string, Set<string>>();
    }
  }

  insert(key: string, minhash: number[]): void {
    for (let b = 0; b < this.bands; b++) {
      const start = b * this.rows;
      const bandValues = minhash.slice(start, start + this.rows);
      const bucketKey = bandValues.join(",");
      const bandBuckets = this.buckets[b];
      let bucket = bandBuckets.get(bucketKey);
      if (!bucket) {
        bucket = new Set<string>();
        bandBuckets.set(bucketKey, bucket);
      }
      bucket.add(key);
    }
  }

  query(minhash: number[]): string[] {
    const candidates = new Set<string>();
    for (let b = 0; b < this.bands; b++) {
      const start = b * this.rows;
      const bandValues = minhash.slice(start, start + this.rows);
      const bucketKey = bandValues.join(",");
      const bucket = this.buckets[b].get(bucketKey);
      if (bucket) {
        for (const key of bucket) {
          candidates.add(key);
        }
      }
    }
    return Array.from(candidates);
  }
}

// ─── createMinHashLSH ──────────────────────────────────────────────────────

export function createMinHashLSH(
  threshold: number = 0.7,
  numPerm: number = DEFAULT_NUM_PERM,
): MinHashLSH {
  // Choose r (rows per band) based on target threshold.
  // For numPerm=128: r=8 gives band threshold ~0.71; r=16 gives ~0.88.
  let r: number;
  if (threshold <= 0.5) {
    r = 4;
  } else if (threshold <= 0.7) {
    r = 8;
  } else {
    r = 16;
  }
  const b = Math.floor(numPerm / r);
  return new MinHashLSHImpl(b, r);
}

// ─── constants ────────────────────────────────────────────────────────────

const ENTROPY_THRESHOLD = 2.5;
const MERGE_THRESHOLD = 92.0; // Jaro-Winkler similarity * 100
const CHUNK_SUFFIX_RE = /_c\d+$/;

// ─── variant suffix regex ─────────────────────────────────────────────────
// Matches labels whose trailing token is a version/variant suffix:
// digits optionally followed by letters, or 2+ letters.
// Requires the stem to end in a letter.
const VARIANT_SUFFIX_RE = /^(.*[a-z])([0-9]+[a-z]*|[a-z]{2,})$/;

// ─── normLabel ────────────────────────────────────────────────────────────

export function normLabel(label: string): string {
  const nfkc = label.normalize("NFKC");
  // Replace runs of non-letter, non-number characters with a single space.
  // Uses Unicode property escapes (\p{L} = any letter, \p{N} = any number)
  // for true Unicode word-character matching (equivalent to Python's
  // re.UNICODE \W negation). Underscores, hyphens, and punctuation all
  // become spaces; CJK and other Unicode letters are preserved.
  const cleaned = nfkc
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return cleaned;
}

// ─── labelEntropy ─────────────────────────────────────────────────────────

export function labelEntropy(label: string): number {
  const s = normLabel(label);
  if (s.length === 0) {
    return 0.0;
  }

  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let entropy = 0.0;
  const n = s.length;
  for (const count of freq.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ─── jaroWinkler ──────────────────────────────────────────────────────────

/**
 * Compute Jaro-Winkler similarity on [0, 100] scale.
 * Implements the standard algorithm: matching characters within a sliding
 * window, counting transpositions, and applying the Winkler prefix bonus.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) {
    return 100.0;
  }

  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0 || bLen === 0) {
    return aLen === 0 && bLen === 0 ? 100.0 : 0.0;
  }

  // Matching window
  const matchDistance = Math.floor(Math.max(aLen, bLen) / 2) - 1;
  const aMatched = new Array<boolean>(aLen).fill(false);
  const bMatched = new Array<boolean>(bLen).fill(false);

  let matches = 0;

  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(bLen, i + matchDistance + 1);
    for (let j = start; j < end; j++) {
      if (!bMatched[j] && a[i] === b[j]) {
        aMatched[i] = true;
        bMatched[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) {
    return 0.0;
  }

  // Count transpositions
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (aMatched[i]) {
      while (!bMatched[k]) {
        k++;
      }
      if (a[i] !== b[k]) {
        transpositions++;
      }
      k++;
    }
  }
  transpositions = Math.floor(transpositions / 2);

  const jaro =
    (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3;

  // Winkler prefix bonus (up to 4 chars)
  let prefixLen = 0;
  const maxPrefix = Math.min(4, aLen, bLen);
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) {
      prefixLen++;
    } else {
      break;
    }
  }

  const winkler = jaro + prefixLen * 0.1 * (1 - jaro);
  return Math.round(winkler * 1000) / 10; // one decimal place
}

// ─── damerauLevenshtein ───────────────────────────────────────────────────

export function damerauLevenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  // d[i][j] = edit distance between a[0..i) and b[0..j)
  const d: number[][] = [];
  for (let i = 0; i <= aLen; i++) {
    d[i] = new Array<number>(bLen + 1).fill(0);
    d[i][0] = i;
  }
  for (let j = 0; j <= bLen; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost, // substitution
      );

      // Transposition check
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  return d[aLen][bLen];
}

// ─── isVariantPair ────────────────────────────────────────────────────────

export function isVariantPair(a: string, b: string): boolean {
  if (a === b) {
    return false;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen >= 12) {
    return false;
  }
  const ma = VARIANT_SUFFIX_RE.exec(a);
  const mb = VARIANT_SUFFIX_RE.exec(b);
  if (!ma || !mb) {
    return false;
  }
  return ma[1] === mb[1] && ma[2] !== mb[2];
}

// ─── shortLabelBlocked ────────────────────────────────────────────────────

export function shortLabelBlocked(
  a: string,
  b: string,
  jwScore: number,
): boolean {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen >= 12) {
    return false;
  }
  // Allow same-length single-char substitutions (true typos)
  if (
    jwScore >= 97.0 &&
    a.length === b.length &&
    damerauLevenshtein(a, b) <= 1
  ) {
    return false;
  }
  return true;
}

// ─── union-find ───────────────────────────────────────────────────────────

class UnionFind {
  private parent: Map<string, string>;

  constructor() {
    this.parent = new Map();
  }

  find(x: string): string {
    let current = this.parent.get(x);
    if (current === undefined) {
      this.parent.set(x, x);
      return x;
    }
    // Path compression
    const root = this._findRoot(x);
    return root;
  }

  private _findRoot(x: string): string {
    let current = x;
    const visited: string[] = [];
    while (true) {
      const parent = this.parent.get(current);
      if (parent === undefined || parent === current) {
        // Compress path
        for (const node of visited) {
          this.parent.set(node, current);
        }
        return current;
      }
      visited.push(current);
      current = parent;
    }
  }

  union(x: string, y: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
    }
    if (!this.parent.has(y)) {
      this.parent.set(y, y);
    }
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) {
      this.parent.set(ry, rx);
    }
  }

  components(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      const group = groups.get(root);
      if (group) {
        group.push(x);
      } else {
        groups.set(root, [x]);
      }
    }
    return groups;
  }
}

// ─── pickWinner ───────────────────────────────────────────────────────────

function pickWinner(
  nodes: GraphNodeRecord[],
): GraphNodeRecord {
  if (nodes.length === 0) {
    throw new Error("Cannot pick winner from empty list");
  }

  let best = nodes[0];
  let bestScore = computePickScore(best);

  for (let i = 1; i < nodes.length; i++) {
    const score = computePickScore(nodes[i]);
    if (
      score.hasSuffix < bestScore.hasSuffix ||
      (score.hasSuffix === bestScore.hasSuffix &&
        score.idLen < bestScore.idLen)
    ) {
      best = nodes[i];
      bestScore = score;
    }
  }

  return best;
}

interface PickScore {
  hasSuffix: number; // 1 if has _c\d+ suffix, 0 otherwise
  idLen: number;
}

function computePickScore(node: GraphNodeRecord): PickScore {
  return {
    hasSuffix: CHUNK_SUFFIX_RE.test(node.id) ? 1 : 0,
    idLen: node.id.length,
  };
}

// ─── deduplicateEntities ──────────────────────────────────────────────────

export function deduplicateEntities(
  nodes: GraphNodeRecord[],
): { kept: GraphNodeRecord[]; remap: Map<string, string> } {
  if (nodes.length <= 1) {
    return { kept: [...nodes], remap: new Map() };
  }

  // Pre-deduplicate: keep first occurrence of each id
  const seenIds = new Map<string, GraphNodeRecord>();
  for (const node of nodes) {
    const nid = node.id;
    if (nid && !seenIds.has(nid)) {
      seenIds.set(nid, node);
    }
  }
  const uniqueNodes = Array.from(seenIds.values());

  if (uniqueNodes.length <= 1) {
    return { kept: [...uniqueNodes], remap: new Map() };
  }

  const uf = new UnionFind();

  // Pass 1: exact normalization
  const normToNodes = new Map<string, GraphNodeRecord[]>();
  for (const node of uniqueNodes) {
    const key = normLabel(node.label);
    if (key.length === 0) {
      continue;
    }
    const group = normToNodes.get(key);
    if (group) {
      group.push(node);
    } else {
      normToNodes.set(key, [node]);
    }
  }

  for (const [, group] of normToNodes) {
    if (group.length <= 1) {
      continue;
    }
    const winner = pickWinner(group);
    for (const node of group) {
      uf.union(winner.id, node.id);
    }
  }

  // Pass 2: fuzzy matching for high-entropy labels
  const candidates: GraphNodeRecord[] = [];
  const seenNorms = new Set<string>();
  for (const node of uniqueNodes) {
    const normed = normLabel(node.label);
    if (normed.length === 0) {
      continue;
    }
    if (!seenNorms.has(normed)) {
      seenNorms.add(normed);
      if (labelEntropy(node.label) >= ENTROPY_THRESHOLD) {
        candidates.push(node);
      }
    }
  }

  // Build MinHash signatures and index into LSH
  const idToCandidate = new Map<string, GraphNodeRecord>();
  const idToNormed = new Map<string, string>();
  const idToMinHash = new Map<string, number[]>();

  if (candidates.length > 0) {
    const lsh = createMinHashLSH();
    for (const node of candidates) {
      const normed = normLabel(node.label);
      const mh = makeMinHash(normed);
      lsh.insert(node.id, mh);
      idToCandidate.set(node.id, node);
      idToNormed.set(node.id, normed);
      idToMinHash.set(node.id, mh);
    }

    // Use LSH to identify candidate pairs, then compare via Jaro-Winkler
    const comparedPairs = new Set<string>();

    for (const nodeA of candidates) {
      const normA = idToNormed.get(nodeA.id)!;
      const mhA = idToMinHash.get(nodeA.id)!;
      const neighbors = lsh.query(mhA);

      for (const neighborId of neighbors) {
        if (neighborId === nodeA.id) {
          continue;
        }

        // Ensure each pair is compared only once (canonical pair key)
        const pairKey =
          nodeA.id < neighborId
            ? `${nodeA.id}:${neighborId}`
            : `${neighborId}:${nodeA.id}`;
        if (comparedPairs.has(pairKey)) {
          continue;
        }
        comparedPairs.add(pairKey);

        const nodeB = idToCandidate.get(neighborId);
        if (!nodeB) {
          continue;
        }

        if (uf.find(nodeA.id) === uf.find(nodeB.id)) {
          continue;
        }

        const normB = idToNormed.get(nodeB.id)!;
        const score = jaroWinkler(normA, normB);

        if (isVariantPair(normA, normB)) {
          continue;
        }
        if (shortLabelBlocked(normA, normB, score)) {
          continue;
        }

        if (score >= MERGE_THRESHOLD) {
          const group = [
            ...(normToNodes.get(normA) ?? [nodeA]),
            ...(normToNodes.get(normB) ?? [nodeB]),
          ];
          const winner = pickWinner(group);
          uf.union(winner.id, nodeA.id);
          uf.union(winner.id, nodeB.id);
        }
      }
    }
  }

  // Build remap table
  const components = uf.components();
  const remap = new Map<string, string>();

  for (const [, members] of components) {
    if (members.length <= 1) {
      continue;
    }
    const groupNodes = uniqueNodes.filter((n) => members.includes(n.id));
    const winner =
      groupNodes.length > 0 ? pickWinner(groupNodes) : { id: members[0] };
    const winnerId = winner.id;
    for (const member of members) {
      if (member !== winnerId) {
        remap.set(member, winnerId);
      }
    }
  }

  if (remap.size === 0) {
    return { kept: [...uniqueNodes], remap: new Map() };
  }

  // Filter out remapped nodes
  const kept = uniqueNodes.filter((n) => !remap.has(n.id));

  return { kept, remap };
}

// ─── remapEdges ───────────────────────────────────────────────────────────

export function remapEdges(
  edges: GraphEdgeRecord[],
  remap: Map<string, string>,
): GraphEdgeRecord[] {
  if (remap.size === 0) {
    return [...edges];
  }

  const result: GraphEdgeRecord[] = [];
  for (const edge of edges) {
    const newSrc = remap.get(edge.sourceNodeId) ?? edge.sourceNodeId;
    const newTgt = remap.get(edge.targetNodeId) ?? edge.targetNodeId;

    // Drop self-loops created by merge
    if (newSrc === newTgt) {
      continue;
    }

    // Create new object (immutability)
    result.push({
      ...edge,
      sourceNodeId: newSrc,
      targetNodeId: newTgt,
    });
  }

  return result;
}
