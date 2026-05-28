// src/core/pipeline/__tests__/llm-extractor.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import type { ParsedChunk } from "../types";

describe("llm-extractor", () => {
  let createLlmExtractor: typeof import("../llm-extractor").createLlmExtractor;
  let mockProvider: import("../../ai/types").ModelProvider;

  beforeAll(async () => {
    const mod = await import("../llm-extractor");
    createLlmExtractor = mod.createLlmExtractor;
  });

  function makeMockProvider(jsonOutput: Record<string, unknown>) {
    const provider = {
      name: "mock",
      async *chat() {
        yield { type: "text" as const, content: JSON.stringify(jsonOutput) };
        yield { type: "done" as const };
      },
    };
    return provider as unknown as import("../../ai/types").ModelProvider;
  }

  it("extracts nodes and edges from markdown chunks", async () => {
    const provider = makeMockProvider({
      nodes: [
        { id: "docs_readme_intro", label: "Introduction", file_type: "document", source_file: "docs/readme.md" },
        { id: "docs_readme_setup", label: "Setup Guide", file_type: "document", source_file: "docs/readme.md" },
      ],
      edges: [
        { source: "docs_readme_intro", target: "docs_readme_setup", relation: "references", confidence: "EXTRACTED", confidence_score: 1.0, source_file: "docs/readme.md" },
      ],
      hyperedges: [
        { id: "onboarding_flow", label: "Onboarding Flow", nodes: ["docs_readme_intro", "docs_readme_setup"], relation: "form", confidence: "INFERRED", confidence_score: 0.75, source_file: "docs/readme.md" },
      ],
    });

    const extractor = createLlmExtractor(provider);
    const chunks: ParsedChunk[] = [{
      chunkIndex: 0,
      content: "# Introduction\n\nWelcome to the project.\n\n## Setup Guide\n\nRun npm install.",
      nodes: [],
      edges: [],
    }];

    const result = await extractor.extract(chunks, "docs/readme.md");

    expect(result.nodes.length).toBe(2);
    expect(result.nodes[0].label).toBe("Introduction");
    expect(result.nodes[0].type).toBe("document");
    expect(result.edges.length).toBe(1);
    expect(result.edges[0].relation).toBe("references");
    expect(result.hyperedges.length).toBe(1);
  });

  it("returns empty results for empty chunks", async () => {
    const provider = makeMockProvider({ nodes: [], edges: [], hyperedges: [] });
    const extractor = createLlmExtractor(provider);
    const result = await extractor.extract([], "test.md");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.hyperedges).toEqual([]);
  });

  it("handles malformed LLM JSON response", async () => {
    const provider = {
      name: "mock",
      async *chat() {
        yield { type: "text" as const, content: "not valid json at all, no nodes here just random text" };
        yield { type: "done" as const };
      },
    } as unknown as import("../../ai/types").ModelProvider;

    const extractor = createLlmExtractor(provider);
    const chunks: ParsedChunk[] = [{
      chunkIndex: 0,
      content: "Some text to extract from.",
      nodes: [],
      edges: [],
    }];

    const result = await extractor.extract(chunks, "test.md");
    // Should return empty, not throw
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("handles JSON wrapped in markdown code blocks", async () => {
    const provider = {
      name: "mock",
      async *chat() {
        yield { type: "text" as const, content: '```json\n{"nodes":[{"id":"n1","label":"Node","file_type":"concept","source_file":"f.md"}],"edges":[],"hyperedges":[]}\n```' };
        yield { type: "done" as const };
      },
    } as unknown as import("../../ai/types").ModelProvider;

    const extractor = createLlmExtractor(provider);
    const chunks: ParsedChunk[] = [{
      chunkIndex: 0,
      content: "Test content",
      nodes: [],
      edges: [],
    }];

    const result = await extractor.extract(chunks, "test.md");
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].label).toBe("Node");
  });

  it("deduplicates nodes by ID", async () => {
    const provider = makeMockProvider({
      nodes: [
        { id: "concept_a", label: "Concept A", file_type: "concept", source_file: "a.md" },
        { id: "concept_a", label: "Concept A (dup)", file_type: "concept", source_file: "b.md" },
      ],
      edges: [],
      hyperedges: [],
    });

    const extractor = createLlmExtractor(provider);
    const chunks: ParsedChunk[] = [
      { chunkIndex: 0, content: "A", nodes: [], edges: [] },
      { chunkIndex: 1, content: "B", nodes: [], edges: [] },
    ];

    const result = await extractor.extract(chunks, "test.md");
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].label).toBe("Concept A");
  });

  it("caches results by content hash", async () => {
    let callCount = 0;
    const provider = {
      name: "mock",
      async *chat() {
        callCount++;
        yield { type: "text" as const, content: '{"nodes":[{"id":"n1","label":"Node","file_type":"document","source_file":"f.md"}],"edges":[],"hyperedges":[]}' };
        yield { type: "done" as const };
      },
    } as unknown as import("../../ai/types").ModelProvider;

    const extractor = createLlmExtractor(provider);
    const chunks: ParsedChunk[] = [{
      chunkIndex: 0,
      content: "Same content twice.",
      nodes: [],
      edges: [],
    }];

    // First call — should hit provider
    await extractor.extract(chunks, "f.md");
    expect(callCount).toBe(1);

    // Second call with same content — should use cache
    await extractor.extract(chunks, "f.md");
    expect(callCount).toBe(1);

    // Different content — should hit provider again
    await extractor.extract([{ chunkIndex: 0, content: "Different.", nodes: [], edges: [] }], "g.md");
    expect(callCount).toBe(2);
  });
});
