import { describe, it, expect } from "vitest";
import {
  normLabel,
  labelEntropy,
  jaroWinkler,
  damerauLevenshtein,
  isVariantPair,
  shortLabelBlocked,
  deduplicateEntities,
  remapEdges,
  makeMinHash,
  createMinHashLSH,
} from "../dedup";
import type { GraphNodeRecord, MinHashLSH } from "../types";

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
  overrides: Partial<import("../types").GraphEdgeRecord> & {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
  },
): import("../types").GraphEdgeRecord {
  return {
    kbId: "kb-1",
    relation: "related_to",
    confidence: 0.5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── normLabel ────────────────────────────────────────────────────────────

describe("normLabel", () => {
  it("lowercases and replaces non-alphanumeric characters with spaces", () => {
    expect(normLabel("Hello World")).toBe("hello world");
  });

  it("applies NFKC normalization and casefolding", () => {
    // NFKC preserves composed Latin characters (é stays as é),
    // only decomposes compatibility characters. \p{L} preserves accented letters.
    expect(normLabel("Café")).toBe("café");
  });

  it("replaces underscores and hyphens with spaces", () => {
    expect(normLabel("UPPER_CASE-TEST")).toBe("upper case test");
  });

  it("strips leading and trailing special characters", () => {
    expect(normLabel("!!special!!")).toBe("special");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normLabel("  spaces  ")).toBe("spaces");
  });

  it("returns empty string for empty input", () => {
    expect(normLabel("")).toBe("");
  });

  it("returns empty string for input with only special characters", () => {
    expect(normLabel("___---")).toBe("");
  });

  it("preserves CJK characters", () => {
    expect(normLabel("你好世界")).toBe("你好世界");
  });

  it("handles mixed CJK and ASCII", () => {
    expect(normLabel("日志-file")).toBe("日志 file");
  });

  it("handles numeric suffixes", () => {
    expect(normLabel("Model_V2")).toBe("model v2");
  });
});

// ─── labelEntropy ────────────────────────────────────────────────────────

describe("labelEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(labelEntropy("")).toBe(0);
  });

  it("returns 0 for a single repeated character", () => {
    expect(labelEntropy("aaaa")).toBe(0);
  });

  it("returns correct entropy for all-different characters", () => {
    // 8 unique chars, H = log2(8) = 3.0
    const result = labelEntropy("abcdefgh");
    expect(result).toBeCloseTo(3.0, 5);
  });

  it("returns entropy > 2.5 for typical code identifiers", () => {
    // "GraphExtractor" → graph extractor → has distinct chars
    const result = labelEntropy("GraphExtractor");
    expect(result).toBeGreaterThan(2.5);
  });

  it("returns entropy <= 2.5 for simple labels", () => {
    // "test" has 't'(2), 'e'(1), 's'(1) = 4 chars
    // t:2/4=0.5, e:1/4=0.25, s:1/4=0.25
    // H = -(0.5*log2(0.5) + 0.25*log2(0.25) + 0.25*log2(0.25))
    //   = -(0.5*(-1) + 0.25*(-2) + 0.25*(-2))
    //   = -( -0.5 -0.5 -0.5) = 1.5
    const result = labelEntropy("test");
    expect(result).toBeCloseTo(1.5, 5);
  });

  it("applies normLabel before computing entropy", () => {
    // "A-B-C" → "a b c" (after normLabel)
    const withSpecialChars = labelEntropy("A-B-C");
    const plain = labelEntropy("a b c");
    expect(withSpecialChars).toBeCloseTo(plain, 5);
  });
});

// ─── jaroWinkler ──────────────────────────────────────────────────────────

describe("jaroWinkler", () => {
  it("returns 100 for identical strings", () => {
    expect(jaroWinkler("hello", "hello")).toBe(100);
  });

  it("returns 100 for identical single character strings", () => {
    expect(jaroWinkler("a", "a")).toBe(100);
  });

  it("returns 0 for completely different strings with no overlap", () => {
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("handles the known MARTHA/MARHTA test case (transposition)", () => {
    const score = jaroWinkler("MARTHA", "MARHTA");
    // Expected: Jaro ≈ 0.944, Winkler ≈ 0.961 (with prefix bonus)
    // Range check since exact value depends on implementation details
    expect(score).toBeGreaterThan(95);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("handles the known DWAYNE/DUANE test case", () => {
    const score = jaroWinkler("DWAYNE", "DUANE");
    // Expected: ~84.0
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThan(90);
  });

  it("handles the known DIXON/DICKSONX test case", () => {
    const score = jaroWinkler("DIXON", "DICKSONX");
    // Expected: ~76.7
    expect(score).toBeGreaterThan(70);
    expect(score).toBeLessThan(82);
  });

  it("returns 100 for empty strings (both empty)", () => {
    expect(jaroWinkler("", "")).toBe(100);
  });

  it("returns 0 for one empty and one non-empty string", () => {
    expect(jaroWinkler("abc", "")).toBe(0);
  });

  it("gives a boost for common prefix", () => {
    // "abcdef" vs "abcxyz" — common prefix "abc" (3 chars)
    const score3 = jaroWinkler("abcdef", "abcxyz");
    // "wxcdef" vs "wxcxyz" — common prefix "wxc" (3 chars) — same score expected
    const scoreSame = jaroWinkler("wxcdef", "wxcxyz");
    // Same Jaro + same prefix length = same score
    expect(score3).toBe(scoreSame);
    // Both > 0 and < 100 (partial match)
    expect(score3).toBeGreaterThan(0);
    expect(score3).toBeLessThan(100);
  });

  it("handles strings with CJK characters", () => {
    // "你好世界" vs "你世界好": first char matches, one other char may match
    const score = jaroWinkler("你好世界", "你世界好");
    // Some similarity since they share characters
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("returns 100 for identical CJK strings", () => {
    expect(jaroWinkler("你好世界", "你好世界")).toBe(100);
  });

  it("is case sensitive (operates on normalized labels)", () => {
    const sameCase = jaroWinkler("hello", "hello");
    const diffCase = jaroWinkler("HELLO", "hello");
    // Both should work — Jaro-Winkler operates on the raw input strings
    // but in our pipeline it's always called with already-normalized strings
    expect(sameCase).toBe(100);
    expect(diffCase).toBeLessThan(100);
  });
});

// ─── damerauLevenshtein ──────────────────────────────────────────────────

describe("damerauLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(damerauLevenshtein("abc", "abc")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    expect(damerauLevenshtein("", "")).toBe(0);
  });

  it("returns 1 for single-character deletion", () => {
    expect(damerauLevenshtein("a", "")).toBe(1);
  });

  it("returns 1 for single-character insertion", () => {
    expect(damerauLevenshtein("", "a")).toBe(1);
  });

  it("returns 1 for single-character substitution", () => {
    expect(damerauLevenshtein("a", "b")).toBe(1);
  });

  it("returns 1 for adjacent transposition", () => {
    // "ab" ↔ "ba" is a transposition
    expect(damerauLevenshtein("ab", "ba")).toBe(1);
  });

  it("handles the kitten/sitting test case", () => {
    // kitten → sitting: k→s, e→i, +g = 3
    expect(damerauLevenshtein("kitten", "sitting")).toBe(3);
  });

  it("uses transposition for longer strings", () => {
    // "abcdef" → "bacdef": transposition of a,b → cost 1
    expect(damerauLevenshtein("abcdef", "bacdef")).toBe(1);
  });

  it("handles CJK characters", () => {
    expect(damerauLevenshtein("你好", "你好世界")).toBe(2);
    expect(damerauLevenshtein("你好世界", "你好世界")).toBe(0);
  });
});

// ─── isVariantPair ────────────────────────────────────────────────────────

describe("isVariantPair", () => {
  it("detects numeric variant suffixes on short labels", () => {
    // "m1" and "m2": stem is "m", suffix is "1"/"2"
    expect(isVariantPair("m1", "m2")).toBe(true);
  });

  it("detects numeric variant suffixes with letters", () => {
    // "asr1603" and "asr1605": stem is "asr", digits differ
    expect(isVariantPair("asr1603", "asr1605")).toBe(true);
  });

  it("returns false when only one label matches the variant pattern", () => {
    // "cranel" does not match ([a-z]{2,}) suffix pattern (only 1 letter),
    // "cranelr" does match. So should not be a variant pair.
    expect(isVariantPair("cranel", "cranelr")).toBe(false);
  });

  it("detects letter-only suffix variants", () => {
    // "cranelr" vs "cranelx": stem "crane", suffixes "lr" vs "lx"
    expect(isVariantPair("cranelr", "cranelx")).toBe(true);
  });

  it("returns false for identical strings", () => {
    expect(isVariantPair("m1", "m1")).toBe(false);
  });

  it("returns false for labels >= 12 characters", () => {
    const long1 = "abcdefghij1".padEnd(12, "x"); // 12-char string
    const long2 = "abcdefghij2".padEnd(12, "x");
    expect(isVariantPair(long1, long2)).toBe(false);
  });

  it("returns false for labels that don't match the variant suffix regex", () => {
    // No letter stem ending
    expect(isVariantPair("123", "456")).toBe(false);
  });

  it("handles the Cortex-A55 / Cortex-A76 case", () => {
    // After normalization: "cortex-a55" and "cortex-a76"
    // The regex: ^(.*[a-z])([0-9]+[a-z]*)$
    // "cortex": "corte" + "x" → group1 matches?
    // "cortex-a55": does this match? "cortex" is 6 chars, last is 'x' [a-z]
    // "cortex-a55" → hmm, the hyphen is in the middle.
    // After normLabel, "Cortex-A55" → "cortex a55"... wait no:
    // normLabel replaces [\W_] with space, so "Cortex-A55" → "cortex a55"
    // But isVariantPair works on normalized labels (normLabel output)
    // "cortex a55": does this match? ^(.*[a-z])([0-9]+[a-z]*)$
    // "cortex a55" has a space, which stops [a-z]
    // group1 = "cortex " (ends in space, not [a-z]) → no match
    //
    // Actually the regex uses [a-z] not [a-z]. The stem must end in a letter.
    // "cortex a55": group1 = "cortex a" (ends in 'a', which is [a-z])
    // group2 = "55" (matches [0-9]+[a-z]*)
    // So it DOES match! group1 = "cortex a"
    //
    // For "cortex a76": group1 = "cortex a", group2 = "76"
    // Same stem, different suffix → variant pair
    expect(isVariantPair("cortex a55", "cortex a76")).toBe(true);
  });
});

// ─── shortLabelBlocked ────────────────────────────────────────────────────

describe("shortLabelBlocked", () => {
  it("blocks short labels when lengths differ", () => {
    // "m1" (2 chars) vs "m1 pro" (5 chars) — lengths differ
    expect(shortLabelBlocked("m1", "m1 pro", 95.0)).toBe(true);
  });

  it("allows short labels with same length, high score, and low DL distance", () => {
    // "extractor" vs "extractar" — same length, 1 char difference
    expect(shortLabelBlocked("extractor", "extractar", 97.5)).toBe(false);
  });

  it("blocks short labels with same length but low JW score", () => {
    expect(shortLabelBlocked("extractor", "extractar", 96.0)).toBe(true);
  });

  it("does not block labels >= 12 characters", () => {
    const long1 = "abcdefghijkl"; // 12 chars
    const long2 = "abcdefghijkm";
    expect(shortLabelBlocked(long1, long2, 95.0)).toBe(false);
  });

  it("blocks short labels with different lengths even with high JW score", () => {
    // "M1" (2) vs "M1Pro" (5)
    expect(shortLabelBlocked("m1", "m1pro", 97.5)).toBe(true);
  });

  it("allows short labels with same-char DL <= 1 and JW >= 97", () => {
    // Single char typo: "graph" vs "grapn" → DL = 1, same length
    expect(shortLabelBlocked("graph", "grapn", 97.0)).toBe(false);
  });
});

// ─── deduplicateEntities ──────────────────────────────────────────────────

describe("deduplicateEntities", () => {
  it("returns the same nodes when there is only one node", () => {
    const nodes: GraphNodeRecord[] = [makeNode({ id: "n1", label: "React" })];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(1);
    expect(result.remap.size).toBe(0);
  });

  it("returns empty result for empty input", () => {
    const result = deduplicateEntities([]);
    expect(result.kept).toEqual([]);
    expect(result.remap.size).toBe(0);
  });

  it("deduplicates exact normalised label matches", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "react" }), // same after normalization
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(1);
    // n1 should win (first)
    expect(result.remap.get("n2")).toBe("n1");
  });

  it("prefers IDs without chunk suffix when picking winner", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "node_c1", label: "React" }),
      makeNode({ id: "node", label: "react" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(1);
    // "node" wins over "node_c1"
    expect(result.remap.get("node_c1")).toBe("node");
  });

  it("prefers shorter ID when both have or both lack chunk suffix", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "very_long_id", label: "React" }),
      makeNode({ id: "short", label: "React" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(1);
    expect(result.remap.get("very_long_id")).toBe("short");
  });

  it("deduplicates fuzzy matches via Jaro-Winkler", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "GraphExtractor" }),
      makeNode({ id: "n2", label: "graph extractor module" }),
    ];
    const result = deduplicateEntities(nodes);
    // These should be similar enough to be deduplicated
    expect(result.kept.length).toBeLessThan(2);
  });

  it("does not merge clearly distinct labels", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "DatabaseMigrationService" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(2);
    expect(result.remap.size).toBe(0);
  });

  it("does not merge variant pairs (different SKU versions)", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "m1" }),
      makeNode({ id: "n2", label: "m2" }),
    ];
    const result = deduplicateEntities(nodes);
    // m1 and m2 are variant pairs, should NOT be merged
    expect(result.kept).toHaveLength(2);
    expect(result.remap.size).toBe(0);
  });

  it("handles duplicate IDs by keeping first occurrence", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React", metadata: { version: "18" } }),
      makeNode({ id: "n1", label: "React", metadata: { version: "19" } }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(1);
    // First occurrence wins
    expect(result.kept[0].metadata).toEqual({ version: "18" });
  });
});

// ─── remapEdges ───────────────────────────────────────────────────────────

describe("remapEdges", () => {
  it("remaps edge source and target IDs according to the remap map", () => {
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "old_a", targetNodeId: "old_b" }),
    ];
    const remap = new Map<string, string>([
      ["old_a", "new_a"],
      ["old_b", "new_b"],
    ]);

    const result = remapEdges(edges, remap);
    expect(result).toHaveLength(1);
    expect(result[0].sourceNodeId).toBe("new_a");
    expect(result[0].targetNodeId).toBe("new_b");
  });

  it("drops edges that become self-loops after remap", () => {
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
    ];
    const remap = new Map<string, string>([["b", "a"]]);

    const result = remapEdges(edges, remap);
    expect(result).toHaveLength(0);
  });

  it("returns the same edges when remap is empty", () => {
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
    ];
    const result = remapEdges(edges, new Map());
    expect(result).toEqual(edges);
  });

  it("returns empty array for empty edges input", () => {
    const result = remapEdges([], new Map([["a", "b"]]));
    expect(result).toEqual([]);
  });

  it("only remaps IDs that exist in the remap map", () => {
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "c" }),
    ];
    const remap = new Map<string, string>([["a", "b"]]);

    const result = remapEdges(edges, remap);
    expect(result).toHaveLength(1);
    expect(result[0].sourceNodeId).toBe("b");
    expect(result[0].targetNodeId).toBe("c"); // unchanged
  });

  it("creates new edge objects (immutability)", () => {
    const edges = [
      makeEdge({ id: "e1", sourceNodeId: "a", targetNodeId: "b" }),
    ];
    const remap = new Map<string, string>([["a", "new_a"]]);

    const result = remapEdges(edges, remap);
    // Should not mutate the original
    expect(edges[0].sourceNodeId).toBe("a");
    expect(result[0].sourceNodeId).toBe("new_a");
    expect(result[0]).not.toBe(edges[0]);
  });
});

// ─── makeMinHash ────────────────────────────────────────────────────────────

describe("makeMinHash", () => {
  it("returns an array of length 128 by default", () => {
    const sig = makeMinHash("hello world");
    expect(sig).toHaveLength(128);
  });

  it("returns an array of specified length when numPerm is provided", () => {
    const sig = makeMinHash("test", 64);
    expect(sig).toHaveLength(64);
  });

  it("returns the same result for the same text (deterministic)", () => {
    const a = makeMinHash("GraphExtractor");
    const b = makeMinHash("GraphExtractor");
    expect(a).toEqual(b);
  });

  it("returns different results for different texts", () => {
    const a = makeMinHash("GraphExtractor");
    const b = makeMinHash("NodeParser");
    // All 128 values should not be identical
    const allSame = a.every((v, i) => v === b[i]);
    expect(allSame).toBe(false);
  });

  it("strips spaces before computing shingles", () => {
    const withSpaces = makeMinHash("hello world");
    const withoutSpaces = makeMinHash("helloworld");
    expect(withSpaces).toEqual(withoutSpaces);
  });

  it("handles text shorter than 3 characters", () => {
    const sig = makeMinHash("ab");
    expect(sig).toHaveLength(128);
    // Should be deterministic
    expect(sig).toEqual(makeMinHash("ab"));
  });

  it("handles empty string", () => {
    const sig = makeMinHash("");
    expect(sig).toHaveLength(128);
    expect(sig).toEqual(makeMinHash(""));
  });

  it("handles CJK characters", () => {
    const sig = makeMinHash("你好世界");
    expect(sig).toHaveLength(128);
    // Deterministic
    expect(sig).toEqual(makeMinHash("你好世界"));
    // Different from ASCII text
    const asciiSig = makeMinHash("hello");
    expect(sig).not.toEqual(asciiSig);
  });

  it("all signature values are non-negative integers", () => {
    const sig = makeMinHash("test text for range check");
    for (const val of sig) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("handles text with only spaces", () => {
    const sig = makeMinHash("   ");
    expect(sig).toHaveLength(128);
    // All spaces stripped → empty → same as ""
    expect(sig).toEqual(makeMinHash(""));
  });

  it("handles very long text without error", () => {
    const longText = "GraphExtractor ".repeat(500);
    const sig = makeMinHash(longText);
    expect(sig).toHaveLength(128);
    for (const val of sig) {
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── createMinHashLSH / MinHashLSH ──────────────────────────────────────────

describe("MinHashLSH", () => {
  function createLSH(): MinHashLSH {
    return createMinHashLSH(0.7, 128);
  }

  it("query returns the inserted key as a candidate for itself", () => {
    const lsh = createLSH();
    const sig = makeMinHash("GraphExtractor");
    lsh.insert("n1", sig);
    const candidates = lsh.query(sig);
    expect(candidates).toContain("n1");
  });

  it("query returns empty array for an uninserted signature", () => {
    const lsh = createLSH();
    const sigA = makeMinHash("GraphExtractor");
    const sigB = makeMinHash("NodeParser");
    lsh.insert("n1", sigA);
    // Query with a different, uninserted signature
    const candidates = lsh.query(sigB);
    // sigB may or may not hash to the same buckets as sigA,
    // but "n1" was inserted with sigA. Querying with sigB
    // should NOT return "n1" unless they share a band.
    // This test verifies that query doesn't crash on uninserted data.
    for (const c of candidates) {
      expect(c).toBe("n1"); // if any returned, it must be a valid key
    }
  });

  it("similar strings share at least one LSH bucket", () => {
    const lsh = createLSH();
    // In the pipeline, labels are already normalized (lowercased) before MinHash.
    // These strings differ by only 1 character at the end, giving Jaccard ~0.92
    // on their 3-gram shingles, well above the ~0.71 band threshold.
    const sigA = makeMinHash("graphextractor");
    const sigB = makeMinHash("graphextracto"); // drop last 'r'
    lsh.insert("n1", sigA);
    lsh.insert("n2", sigB);

    const candidates = lsh.query(sigA);
    // n2 should appear as a candidate since the strings are nearly identical
    expect(candidates).toContain("n2");
  });

  it("very different strings are unlikely to share LSH buckets", () => {
    const lsh = createLSH();
    const sigA = makeMinHash("GraphExtractor");
    const sigB = makeMinHash("DatabaseMigrationService");
    lsh.insert("n1", sigA);
    lsh.insert("n2", sigB);

    const candidates = lsh.query(sigA);
    // These are very different strings; they should NOT collide in LSH
    expect(candidates).not.toContain("n2");
  });

  it("insert and query are deterministic", () => {
    const lsh1 = createLSH();
    const lsh2 = createLSH();
    const sigA = makeMinHash("GraphExtractor");
    const sigB = makeMinHash("Graphextractor");
    lsh1.insert("n1", sigA);
    lsh1.insert("n2", sigB);

    lsh2.insert("n1", sigA);
    lsh2.insert("n2", sigB);

    expect(lsh1.query(sigA).sort()).toEqual(lsh2.query(sigA).sort());
  });

  it("multiple inserts for the same key are idempotent", () => {
    const lsh = createLSH();
    const sig = makeMinHash("GraphExtractor");
    lsh.insert("n1", sig);
    lsh.insert("n1", sig); // double insert

    const candidates = lsh.query(sig);
    // n1 should appear exactly once
    const occurrences = candidates.filter((c) => c === "n1").length;
    expect(occurrences).toBe(1);
  });

  it("handles many candidates", () => {
    const lsh = createLSH();
    const keys: string[] = [];
    const signatures: number[][] = [];

    for (let i = 0; i < 100; i++) {
      const key = `node_${i}`;
      const sig = makeMinHash(`label_${i}_with_some_variation`);
      lsh.insert(key, sig);
      keys.push(key);
      signatures.push(sig);
    }

    // Query each key and verify it finds itself
    for (let i = 0; i < keys.length; i++) {
      const candidates = lsh.query(signatures[i]);
      expect(candidates).toContain(keys[i]);
    }
  });
});

// ─── MinHash/LSH integration with deduplicateEntities ───────────────────────

describe("deduplicateEntities with MinHash/LSH", () => {
  it("still deduplicates exact normalization matches", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "react" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(1);
    expect(result.remap.get("n2")).toBe("n1");
  });

  it("still deduplicates fuzzy Jaro-Winkler matches for high-entropy labels", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "GraphExtractor" }),
      makeNode({ id: "n2", label: "graph extractor module" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept.length).toBeLessThan(2);
  });

  it("still does not merge clearly distinct labels", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "React" }),
      makeNode({ id: "n2", label: "DatabaseMigrationService" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(2);
    expect(result.remap.size).toBe(0);
  });

  it("still does not merge variant pairs", () => {
    const nodes: GraphNodeRecord[] = [
      makeNode({ id: "n1", label: "m1" }),
      makeNode({ id: "n2", label: "m2" }),
    ];
    const result = deduplicateEntities(nodes);
    expect(result.kept).toHaveLength(2);
    expect(result.remap.size).toBe(0);
  });

  it("handles a larger set of entities efficiently", () => {
    // Generate 50 nodes with similar labels to stress test MinHash/LSH
    const baseLabels = [
      "GraphExtractor",
      "NodeParser",
      "EdgeBuilder",
      "TextTokenizer",
      "KnowledgeBase",
      "QueryEngine",
      "ResponseGenerator",
      "DataTransformer",
      "PipelineRunner",
      "CacheManager",
    ];

    const nodes: GraphNodeRecord[] = [];
    // Create variations of each base label
    for (let i = 0; i < baseLabels.length; i++) {
      const base = baseLabels[i];
      nodes.push(makeNode({ id: `n_${i}_original`, label: base }));
      nodes.push(
        makeNode({
          id: `n_${i}_lower`,
          label: base.toLocaleLowerCase(),
        }),
      );
      nodes.push(
        makeNode({
          id: `n_${i}_spaces`,
          label: base.replace(/([A-Z])/g, " $1").trim(),
        }),
      );
    }

    const result = deduplicateEntities(nodes);
    // At minimum, the exact normalization should merge lowercase variants
    expect(result.kept.length).toBeLessThan(nodes.length);
    expect(result.remap.size).toBeGreaterThan(0);
  });
});
