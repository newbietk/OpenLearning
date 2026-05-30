// src/core/pipeline/llm-extractor.ts
import crypto from "node:crypto";
import type { ParsedChunk } from "./types";
import type { ModelProvider } from "../ai/types";

export interface ExtractedNode {
  id: string;
  label: string;
  file_type: string;
  source_file: string;
  source_location?: string;
  source_url?: string;
  author?: string;
  contributor?: string;
}

export interface ExtractedEdge {
  source: string;
  target: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
  confidence_score: number;
  source_file: string;
}

export interface ExtractedHyperedge {
  id: string;
  label: string;
  nodes: string[];
  relation: "participate_in" | "implement" | "form";
  confidence: "EXTRACTED" | "INFERRED";
  confidence_score: number;
  source_file: string;
}

export interface ExtractionResult {
  nodes: ParsedChunk["nodes"];
  edges: ParsedChunk["edges"];
  hyperedges: ExtractedHyperedge[];
}

export interface LlmExtractor {
  extract(chunks: ParsedChunk[], sourceFile: string): Promise<ExtractionResult>;
}

function hashContent(filePath: string, content: string): string {
  return crypto
    .createHash("sha256")
    .update(filePath)
    .update(content)
    .digest("hex")
    .slice(0, 16);
}

function buildExtractionPrompt(chunks: ParsedChunk[], sourceFile: string): string {
  const contentText = chunks.map((c) => c.content).join("\n\n").slice(0, 12000);

  return `You are a knowledge graph extraction agent. Extract entities, relationships, and hyperedges from the following document.

File: ${sourceFile}

Content:
${contentText}

Rules:
- EXTRACTED: relationship explicit in source (citation, reference, "see §3.2", import, call)
- INFERRED: reasonable inference (shared data structure, implied dependency, shared concept)
- AMBIGUOUS: uncertain - flag for review, do not omit
- confidence_score is REQUIRED on every edge:
  - EXTRACTED edges: confidence_score = 1.0
  - INFERRED edges: pick ONE from {0.95, 0.85, 0.75, 0.65, 0.55}
  - AMBIGUOUS edges: 0.1-0.3
- Node ID format: lowercase, only [a-z0-9_], no dots or slashes. Format: {parentdir}_{filestem}_{entityname}
- file_type MUST be one of: code, document, paper, image, rationale, concept
- For design rationale: store as a "rationale" concept node
- Hyperedges: only if 3+ nodes form a coherent group not captured by pairwise edges. Maximum 3.

Output ONLY valid JSON matching this schema:
{"nodes":[{"id":"string","label":"Human Readable","file_type":"document|paper|rationale|concept","source_file":"string","source_location":null,"source_url":null}],"edges":[{"source":"node_id","target":"node_id","relation":"references|cites|conceptually_related_to|semantically_similar_to|rationale_for","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"string"}],"hyperedges":[{"id":"string","label":"Human Readable","nodes":["id1","id2","id3"],"relation":"participate_in|implement|form","confidence":"EXTRACTED|INFERRED","confidence_score":0.75,"source_file":"string"}]}`;
}

function parseLlmJson(text: string): {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
  hyperedges: ExtractedHyperedge[];
} {
  // Try to extract JSON from markdown code blocks first
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlock ? codeBlock[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(candidate);
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      hyperedges: Array.isArray(parsed.hyperedges) ? parsed.hyperedges : [],
    };
  } catch {
    // Try to find a JSON object anywhere in the text
    const objMatch = text.match(/\{[\s\S]*"nodes"[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        return {
          nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
          edges: Array.isArray(parsed.edges) ? parsed.edges : [],
          hyperedges: Array.isArray(parsed.hyperedges) ? parsed.hyperedges : [],
        };
      } catch {
        // fall through
      }
    }
  }

  return { nodes: [], edges: [], hyperedges: [] };
}

export function createLlmExtractor(provider: ModelProvider): LlmExtractor {
  const cache = new Map<string, ExtractionResult>();

  return {
    async extract(chunks: ParsedChunk[], sourceFile: string): Promise<ExtractionResult> {
      if (chunks.length === 0) {
        return { nodes: [], edges: [], hyperedges: [] };
      }

      const fullContent = chunks.map((c) => c.content).join("\n\n");
      const contentHash = hashContent(sourceFile, fullContent);

      const cached = cache.get(contentHash);
      if (cached) return cached;

      const prompt = buildExtractionPrompt(chunks, sourceFile);
      const responseChunks: string[] = [];

      try {
        for await (const chunk of provider.chat([
          { role: "user", content: prompt },
        ])) {
          if (chunk.type === "text" && chunk.content) {
            responseChunks.push(chunk.content);
          }
          if (chunk.type === "error") {
            return { nodes: [], edges: [], hyperedges: [] };
          }
        }
      } catch {
        return { nodes: [], edges: [], hyperedges: [] };
      }

      const responseText = responseChunks.join("");
      const extracted = parseLlmJson(responseText);

      // Convert ExtractedNode -> ParsedChunk node format, dedup by ID
      const seen = new Set<string>();
      const nodes: ParsedChunk["nodes"] = [];
      for (const en of extracted.nodes) {
        if (seen.has(en.id)) continue;
        seen.add(en.id);
        nodes.push({
          label: en.label,
          type: en.file_type || "concept",
          metadata: {
            file_type: en.file_type || "concept",
            source_file: en.source_file,
            source_location: en.source_location ?? null,
            source_url: en.source_url ?? null,
            author: en.author ?? null,
            contributor: en.contributor ?? null,
          },
        });
      }

      const edges: ParsedChunk["edges"] = extracted.edges.map((ee) => ({
        source: ee.source,
        target: ee.target,
        relation: ee.relation,
        confidence: ee.confidence as "EXTRACTED" | "INFERRED" | "AMBIGUOUS",
      }));

      const result: ExtractionResult = { nodes, edges, hyperedges: extracted.hyperedges };

      cache.set(contentHash, result);
      return result;
    },
  };
}
