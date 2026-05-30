/**
 * Full pipeline: parse → build → dedup → cluster → analyze → export → viz
 * Run: npx tsx scripts/verify-pipeline.ts [path-or-url]
 *   path: local directory (default: D:/workspace/ai-coding/learn-coding)
 *   url:  GitHub repo URL (e.g. https://github.com/owner/repo)
 */
import fs from "node:fs";
import path from "node:path";

import { detectType } from "../src/core/pipeline/detector";
import { detectCorpus } from "../src/core/pipeline/corpus-detect";
import { createTextParser } from "../src/core/pipeline/parsers/text";
import { createMarkdownParser } from "../src/core/pipeline/parsers/markdown";
import { createCodeParser, detectLanguage } from "../src/core/pipeline/parsers/code";
import { buildGraph } from "../src/core/pipeline/graph-builder";
import { deduplicateEntities } from "../src/core/pipeline/dedup";
import { detectCommunities, scoreCommunities } from "../src/core/pipeline/cluster";
import { surprisingConnections, suggestQuestions, findBridgeNodes } from "../src/core/pipeline/analyze";
import { exportGraphJson, generateReport } from "../src/core/pipeline/export";
import { autoLabelAllCommunities } from "../src/core/pipeline/community-label";
import { godNodes, scoreNodes, processQuery, buildVocabulary, expandQuery } from "../src/core/pipeline/search";
import type { Parser, ParsedChunk, GraphNodeRecord, GraphEdgeRecord } from "../src/core/pipeline/types";
import type { ModelProvider } from "../src/core/ai/types";

// Parse target from CLI args
const argv = process.argv.slice(2);
const rawTarget = argv[0] || "D:/workspace/ai-coding/learn-coding";
const isUrl = /^https?:\/\//.test(rawTarget);

// Derive KB_ID and OUT_DIR from target
function slugFromTarget(target: string): string {
  if (/^https?:\/\//.test(target)) {
    const m = target.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (m) return `${m[1]}_${m[2]}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
    return "url_kb";
  }
  return path.basename(target).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
}

const KB_ID = slugFromTarget(rawTarget);
const OUT_DIR = path.resolve("verify-output", KB_ID);
const TARGET_URL = isUrl ? rawTarget : undefined;

const SOURCE_EXTS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs",
  ".md", ".markdown", ".txt", ".c", ".cpp", ".h", ".hpp",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".codegraph", "dist", "__pycache__", ".pytest_cache"]);

// ============================================================================
// URL-based knowledge extraction (GitHub repos via API, no clone needed)
// ============================================================================

interface RemoteFile {
  relativePath: string;
  downloadUrl: string;
}

async function listGitHubFiles(repoUrl: string): Promise<RemoteFile[]> {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!m) throw new Error(`Not a GitHub repo URL: ${repoUrl}`);
  const [, owner, repo] = m;
  const cleanRepo = repo.replace(/\.git$/, "");

  console.log(`    Fetching file tree from GitHub API: ${owner}/${cleanRepo}...`);

  // Try main branch first, then master
  let treeUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/main?recursive=1`;
  let resp = await fetch(treeUrl, { headers: { Accept: "application/vnd.github+json" } });

  if (!resp.ok) {
    treeUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/master?recursive=1`;
    resp = await fetch(treeUrl, { headers: { Accept: "application/vnd.github+json" } });
  }

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`GitHub API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json() as { tree: Array<{ path: string; type: string }> };
  const branch = treeUrl.includes("master") ? "master" : "main";

  const files: RemoteFile[] = [];
  for (const item of data.tree) {
    if (item.type !== "blob") continue;
    const ext = path.extname(item.path).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;

    // Skip dirs we'd skip locally
    const parts = item.path.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p) || p.startsWith("."))) continue;

    files.push({
      relativePath: item.path,
      downloadUrl: `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/${item.path}`,
    });
  }

  console.log(`    Found ${files.length} source files in ${owner}/${cleanRepo}`);
  return files;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) files.push(...walkFiles(fp)); }
    else if (SOURCE_EXTS.has(path.extname(e.name).toLowerCase())) files.push(fp);
  }
  return files;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

async function main() {
  const isUrlTarget = TARGET_URL != null;

  console.log("=".repeat(70));
  console.log(`  Knowledge Pipeline — ${isUrlTarget ? "URL" : "Local"} Target`);
  console.log("  Target:", rawTarget);
  console.log("  KB ID:", KB_ID);
  console.log("=".repeat(70));

  // ── Step 1: Discover files (local or remote) ─────────────────────────────
  console.log("\n[1] Discover — gathering source files...");

  const allChunks: ParsedChunk[] = [];
  let totalFiles = 0;
  let totalWords = 0;
  let codeCount = 0;
  let docCount = 0;
  const byLanguage: Record<string, number> = {};
  let corpusSummary = { code: 0, document: 0, paper: 0, image: 0 };
  let subdirBreakdown: Array<{ dir: string; count: number }> = [];

  const textParser = createTextParser();
  const mdParser = createMarkdownParser();
  const codeParser = createCodeParser();

  if (isUrlTarget) {
    // ── URL mode: fetch files from remote source ──
    const remoteFiles = await listGitHubFiles(TARGET_URL);

    totalFiles = remoteFiles.length;

    for (const rf of remoteFiles) {
      const lang = detectLanguage(rf.relativePath);
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;

      const dt = detectType({ fileName: rf.relativePath });
      const parser = dt === "markdown" ? mdParser : dt === "code" ? codeParser : textParser;

      try {
        const resp = await fetch(rf.downloadUrl);
        if (!resp.ok) continue;
        const content = await resp.text();
        totalWords += content.split(/\s+/).filter(Boolean).length;

        if (dt === "code") codeCount++;
        else if (dt === "markdown") docCount++;

        const result = await parser.parse({ content, filePath: rf.relativePath });
        for (const c of result.chunks) allChunks.push(c);
      } catch {
        // skip failed files
      }
    }

    // Build subdir breakdown
    const dirCounts = new Map<string, number>();
    for (const rf of remoteFiles) {
      const parts = rf.relativePath.split("/");
      const topDir = parts.length > 1 ? parts[0] : "(root)";
      dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);
    }
    subdirBreakdown = Array.from(dirCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([dir, count]) => ({ dir, count }));

    corpusSummary = { code: codeCount, document: docCount, paper: 0, image: 0 };
  } else {
    // ── Local mode: walk filesystem ──
    const corpus = detectCorpus(rawTarget);
    totalFiles = corpus.totalFiles;
    totalWords = corpus.totalWords;
    corpusSummary = corpus.summary;
    subdirBreakdown = corpus.subdirBreakdown;

    const files = [...corpus.files.code, ...corpus.files.document, ...corpus.files.paper]
      .map(f => path.join(rawTarget, f));

    for (const f of files) {
      const lang = detectLanguage(f);
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    }

    for (const filePath of files) {
      const relPath = path.relative(rawTarget, filePath);
      const dt = detectType({ fileName: relPath });
      const parser = dt === "markdown" ? mdParser : dt === "code" ? codeParser : textParser;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const result = await parser.parse({ content, filePath: relPath });
        for (const c of result.chunks) allChunks.push(c);
      } catch {}
    }
  }

  console.log(`    ${totalFiles} files · ~${totalWords.toLocaleString()} words`);
  console.log(`    code: ${corpusSummary.code} · docs: ${corpusSummary.document} · papers: ${corpusSummary.paper} · images: ${corpusSummary.image}`);
  console.log("    top subdirs:", subdirBreakdown.slice(0, 5).map(s => `${s.dir}(${s.count})`).join(", "));
  console.log("    languages:", JSON.stringify(byLanguage));

  // ── Step 2: Parse ────────────────────────────────────────────────────────
  console.log(`\n[2] Parse — ${allChunks.length} chunks extracted`);

  // ── Step 2.5: LLM Semantic Extraction (optional) ───────────────────────
  const llmProvider = process.env.LLM_PROVIDER;
  const llmApiKey = process.env.LLM_API_KEY;

  if (llmProvider && llmApiKey) {
    console.log("\n[2.5] LLM Semantic Extraction...");

    let provider: ModelProvider;
    if (llmProvider === "deepseek") {
      const { createDeepSeekProvider } = await import("../src/core/ai/providers/deepseek");
      provider = createDeepSeekProvider(llmApiKey);
    } else if (llmProvider === "anthropic") {
      const { createAnthropicProvider } = await import("../src/core/ai/providers/anthropic");
      provider = createAnthropicProvider(llmApiKey);
    } else {
      const { createOpenAIProvider } = await import("../src/core/ai/providers/openai");
      provider = createOpenAIProvider(llmApiKey);
    }

    const { createLlmExtractor } = await import("../src/core/pipeline/llm-extractor");
    const extractor = createLlmExtractor(provider);

    // Filter to non-code chunks (docs, papers, markdown)
    const nonCodeChunks = allChunks.filter((c) => {
      const firstNode = c.nodes[0];
      return firstNode && !["function", "class", "method", "variable", "import", "type"].includes(firstNode.type);
    });

    if (nonCodeChunks.length > 0) {
      console.log(`    Extracting from ${nonCodeChunks.length} non-code chunks...`);
      try {
        const semanticResult = await extractor.extract(
          nonCodeChunks.slice(0, 20), // Limit to first 20 chunks for demo
          "semantic_extraction",
        );
        console.log(`    LLM extracted: ${semanticResult.nodes.length} nodes, ${semanticResult.edges.length} edges, ${semanticResult.hyperedges.length} hyperedges`);

        // Merge semantic nodes/edges into allChunks
        if (semanticResult.nodes.length > 0 || semanticResult.edges.length > 0) {
          allChunks.push({
            chunkIndex: allChunks.length,
            content: "[LLM semantic extraction]",
            nodes: semanticResult.nodes,
            edges: semanticResult.edges,
          });
        }
      } catch (err) {
        console.log(`    LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log("    No non-code chunks to extract from");
    }
  } else {
    console.log("\n[2.5] LLM Semantic Extraction — skipped (set LLM_PROVIDER + LLM_API_KEY to enable)");
  }

  // ── Step 3: Build ────────────────────────────────────────────────────────
  console.log("\n[3] Build — constructing graph...");
  const { nodes, unresolvedEdges } = buildGraph(KB_ID, allChunks);
  console.log(`    ${nodes.length} nodes, ${unresolvedEdges.length} edges`);

  // ── Step 4: Dedup ────────────────────────────────────────────────────────
  console.log("\n[4] Dedup — merging entities...");
  const nodeRecords: GraphNodeRecord[] = nodes.map((n) => ({
    id: n.label, kbId: (n as { kbId?: string }).kbId ?? "", label: n.label, nodeType: n.nodeType,
    sourceDocId: n.sourceDocId, metadata: n.metadata, createdAt: new Date().toISOString(),
  }));
  const { kept, remap } = deduplicateEntities(nodeRecords);
  console.log(`    ${nodes.length} → ${kept.length} (${remap.size} merged)`);

  // ── Step 5: Cluster ──────────────────────────────────────────────────────
  console.log("\n[5] Cluster — detecting communities...");
  const clusterEdges: { source: string; target: string; weight: number }[] = unresolvedEdges
    .filter((e) => e.sourceLabel !== e.targetLabel)
    .map((e) => ({ source: e.sourceLabel, target: e.targetLabel, weight: e.confidence }));
  const communities = detectCommunities(
    kept.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })),
    clusterEdges,
  );
  const cohesionScores = scoreCommunities(
    kept.map((n) => ({ id: n.id, label: n.label, nodeType: n.nodeType })),
    clusterEdges,
    communities,
  );
  console.log(`    ${communities.size} communities found`);

  // ── Step 6: Analyze ──────────────────────────────────────────────────────
  console.log("\n[6] Analyze — finding patterns...");
  const edgeRecords: GraphEdgeRecord[] = unresolvedEdges.map((e) => ({
    id: crypto.randomUUID(), kbId: KB_ID,
    sourceNodeId: e.sourceLabel, targetNodeId: e.targetLabel,
    relation: e.relation, confidence: e.confidence, createdAt: new Date().toISOString(),
  }));
  const surprises = surprisingConnections(kept, edgeRecords, communities);
  const questions = suggestQuestions(kept, edgeRecords, communities);
  const bridges = findBridgeNodes(kept, edgeRecords, communities);
  const gods = godNodes(kept, edgeRecords, 10).slice(0, 10);
  console.log(`    ${surprises.length} surprising connections`);
  console.log(`    ${questions.length} suggested questions`);
  console.log(`    ${bridges.length} bridge nodes`);

  // ── Step 7: Export ───────────────────────────────────────────────────────
  console.log("\n[7] Export — generating outputs...");
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // graph.json
  const graphJson = exportGraphJson(kept, edgeRecords, communities, cohesionScores);
  fs.writeFileSync(path.join(OUT_DIR, "graph.json"), JSON.stringify(graphJson, null, 2), "utf-8");
  console.log(`    graph.json written`);

  // Auto-label communities (graphify Step 5)
  const communityLabels = autoLabelAllCommunities(
    communities,
    kept.map(n => ({ id: n.id, label: n.label, nodeType: n.nodeType })),
    edgeRecords.map(e => ({ source: e.sourceNodeId, target: e.targetNodeId, relation: e.relation })),
  );

  // Compute degrees before report
  const degrees = new Map<string, number>();
  for (const e of edgeRecords) {
    degrees.set(e.sourceNodeId, (degrees.get(e.sourceNodeId) ?? 0) + 1);
    degrees.set(e.targetNodeId, (degrees.get(e.targetNodeId) ?? 0) + 1);
  }

  // GRAPH_REPORT.md
  const report = generateReport({
    graphName: KB_ID,
    nodeCount: kept.length,
    edgeCount: edgeRecords.length,
    communities,
    cohesionScores,
    communityLabels,
    godNodes: gods.map((n) => ({ label: n.label, nodeType: n.nodeType, degree: (degrees.get(n.id) ?? 0) })),
    surprisingConnections: surprises.slice(0, 10).map((s) => ({
      from: s.from, to: s.to, relation: s.relation, reason: s.reason,
    })),
    suggestedQuestions: questions,
    detection: {
      totalFiles,
      totalWords,
      byType: { code: corpusSummary.code, document: corpusSummary.document, paper: corpusSummary.paper, image: corpusSummary.image },
    },
    tokens: { input: 0, output: 0 },
  });
  fs.writeFileSync(path.join(OUT_DIR, "GRAPH_REPORT.md"), report, "utf-8");
  console.log(`    GRAPH_REPORT.md written`);

  // Save nodes + edges JSON for viz
  fs.writeFileSync(path.join(OUT_DIR, "nodes.json"), JSON.stringify(
    kept.map((n) => ({ ...n, _degree: degrees.get(n.id) ?? 0, _community: findCommunity(n.id, communities) })),
    null, 2,
  ), "utf-8");
  fs.writeFileSync(path.join(OUT_DIR, "edges.json"), JSON.stringify(
    edgeRecords.map((e) => ({ ...e, _confidence: e.confidence })),
    null, 2,
  ), "utf-8");

  // ── Step 8: Query Expansion Demo (graphify Query Step 0) ─────────────────
  console.log("\n[8] Query expansion — building vocabulary...");
  const vocab = buildVocabulary(kept.map(n => ({ label: n.label })));
  console.log(`    ${vocab.length} unique tokens in vocabulary`);
  const demoQueries = ["authentication flow", "exercise generator", "environment config"];
  for (const q of demoQueries) {
    const expanded = expandQuery(q, vocab);
    console.log(`    "${q}" → [${expanded.slice(0, 8).join(", ")}${expanded.length > 8 ? "..." : ""}] (${expanded.length} tokens)`);
  }

  // ── Step 9: Brief output ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("  Pipeline Complete");
  console.log(`  ${kept.length} nodes · ${edgeRecords.length} edges · ${communities.size} communities`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log("    graph.json        — standard graph data");
  console.log("    GRAPH_REPORT.md   — audit report");
  console.log("    graph.html        — interactive visualization");
  console.log("=".repeat(70));

  // Print key findings
  console.log("\n─── God Nodes ───");
  for (const n of gods.slice(0, 10)) {
    console.log(`  ${n.label.padEnd(40)} [${n.nodeType}]  deg:${degrees.get(n.id) ?? 0}`);
  }

  console.log("\n─── Surprising Connections ───");
  for (const s of surprises.slice(0, 8)) {
    console.log(`  ${s.from.padEnd(30)} ←[${s.relation}]→ ${s.to.padEnd(30)}  ${s.reason}`);
  }

  console.log("\n─── Suggested Questions ───");
  for (const q of questions.slice(0, 5)) {
    console.log(`  • ${q}`);
  }

  console.log("\n─── Bridge Nodes ───");
  for (const b of bridges.slice(0, 8)) {
    console.log(`  ${b.node.label.padEnd(40)} connects communities: [${b.connectingCommunities.join(", ")}]`);
  }
}

function findCommunity(nodeId: string, communities: Map<number, string[]>): number {
  for (const [cid, members] of communities) {
    if (members.includes(nodeId)) return cid;
  }
  return -1;
}

main().catch(console.error);
