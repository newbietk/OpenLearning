# Phase 3: Core AI Engine + LLM Semantic Extraction — Design

> **Status:** draft | **Date:** 2026-05-28

## Overview

Implement Phase 3 (AI types, 3 Model Providers, 8 retrieval tools, ReAct Agent Loop) and close the graphify Step 3B gap by adding LLM semantic extraction to the knowledge pipeline.

## Architecture

```
src/core/ai/
├── types.ts                    # Already exists — Message, ToolDef, ModelProvider, AgentConfig, etc.
├── providers/
│   ├── openai.ts               # OpenAI Chat Completions streaming
│   ├── anthropic.ts            # Anthropic Messages streaming
│   └── deepseek.ts             # DeepSeek (OpenAI-compatible, different baseUrl only)
├── tools/
│   └── index.ts                # 8 graph retrieval tools + executor
├── agent-loop.ts               # ReAct loop with tool calling
└── llm-extractor.ts            # LLM semantic extraction for docs/papers/images

src/core/pipeline/
└── llm-extractor.ts            # (alt location) Pipeline integration point
```

### Key Design Decisions

1. **DeepSeek reuses OpenAI provider.** DeepSeek API is OpenAI-compatible (same `/v1/chat/completions` endpoint). Only `baseUrl` differs. One adapter, two providers.

2. **ModelProvider interface unchanged.** The existing `AsyncIterable<StreamChunk>` contract in `types.ts` covers all three providers.

3. **Tools are thin wrappers** over existing pipeline modules (`search.ts`, `analyze.ts`, `cluster.ts`, `graph-builder.ts`). No duplication.

4. **LLM extractor as a pipeline parser.** It implements the standard `Parser` interface so it slots into the existing verify-pipeline.ts flow. Input: parsed chunks from structural extraction. Output: enriched nodes + edges + hyperedges.

5. **Content-hash caching.** Cached by `sha256(filePath + content)`. Skip re-extraction on unchanged files.

---

## 1. AI Provider Layer

### Interface (already defined in `types.ts`)

```typescript
interface ModelProvider {
  readonly name: string;
  chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk>;
}
```

### OpenAI Provider (`providers/openai.ts`)

- POST `{baseUrl}/v1/chat/completions` with `stream: true`
- SSE parsing: `data: {...}` lines → yield `StreamChunk`
- Handles: text deltas, tool_call deltas, finish_reason, errors
- Constructor: `(apiKey: string, model?: string, baseUrl?: string)`
- Default model: `gpt-4o`, default baseUrl: `https://api.openai.com`

### DeepSeek Provider (`providers/deepseek.ts`)

- Re-exports OpenAI provider with preset `baseUrl: "https://api.deepseek.com"`
- Default model: `deepseek-chat`
- Constructor: `(apiKey: string, model?: string)`

### Anthropic Provider (`providers/anthropic.ts`)

- POST `https://api.anthropic.com/v1/messages` with `stream: true`
- SSE format differs from OpenAI: `event: content_block_delta` etc.
- Tool use blocks: `tool_use` content blocks
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`
- Constructor: `(apiKey: string, model?: string)`
- Default model: `claude-sonnet-4-6`

### Error handling (all providers)

- Non-2xx → yield `{ type: 'error', error: '...' }`
- Network errors → yield error chunk, stop iteration
- Timeout: 60s via AbortController

---

## 2. Knowledge Retrieval Tools (`tools/index.ts`)

All 8 tools backed by existing pipeline functions:

| Tool | Pipeline module | Description |
|---|---|---|
| `search_knowledge` | `search.ts:scoreNodes + bfsTraverse` | TF-IDF search + BFS subgraph |
| `get_node` | DB: `graphNode.findByLabel` | Lookup node by label |
| `get_neighbors` | DB: `graphNode.findNeighbors` | 1-hop subgraph |
| `get_community` | `cluster.ts:detectCommunities` | All nodes in a community |
| `god_nodes` | `search.ts:godNodes` | Top-N highest-degree nodes |
| `graph_stats` | Inline count query | Node/edge counts, communities |
| `shortest_path` | `analyze.ts` (BFS bidirectional) | Path between two concepts |
| `get_document` | DB: `document.findById` | Original document content |

### Tool Execution

```typescript
function createTools(db: Database, kbId: string): {
  definitions: ToolDef[];
  execute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
}
```

Each tool takes `toolCallId` for result correlation. Errors return structured JSON, never throw.

---

## 3. Agent Loop (`agent-loop.ts`)

### ReAct Pattern

```
User message → [think → tool_call → tool_result]* → final response
```

- System prompt: inline, short (~200 chars). Describes KB scope, tool use, honesty rules.
- Max iterations: configurable, default 10
- Output: `AsyncIterable<AgentEvent>` for SSE streaming
- Tool errors → logged, fed back to model as tool result with error text. Does NOT abort loop.
- No tool calls → agent is done, yield `{ type: 'done' }`

### Interface

```typescript
function runAgentLoop(
  config: AgentConfig,
  tools: { definitions: ToolDef[]; execute: (name: string, args: Record<string, unknown>) => Promise<ToolResult> },
  userMessage: string,
  history?: Message[],
): AsyncIterable<AgentEvent>
```

---

## 4. LLM Semantic Extractor (`llm-extractor.ts`)

### Purpose

Replace graphify Step 3B: use LLM to extract semantic entities, relationships, and hyperedges from non-code files (docs, papers, images). This is the key capability gap between our pipeline and graphify.

### Design

```
Input: ParsedChunk[] (from structural parsing of docs/papers) + ModelProvider
Process:
  1. Hash-based cache check → skip already-extracted files
  2. Group uncached files into chunks of ~15-20 files each
  3. For each chunk: construct extraction prompt → call provider.chat() → parse JSON
  4. Merge chunk results, deduplicate by node ID
  5. Cache results for future runs
Output: { nodes: ParsedChunk['nodes'], edges: ParsedChunk['edges'], hyperedges: Hyperedge[] }
```

### Extraction Prompt (key design element)

The prompt instructs the LLM to:
- Extract named entities/concepts as nodes (with `file_type`: code/document/paper/image/rationale/concept)
- Extract edges: EXTRACTED (explicit citation), INFERRED (reasonable inference), AMBIGUOUS (uncertain)
- Confidence scores: EXTRACTED=1.0, INFERRED from {0.95, 0.85, 0.75, 0.65, 0.55}, AMBIGUOUS=0.1-0.3
- Add `semantically_similar_to` edges for cross-cutting conceptual links
- Add hyperedges for 3+ nodes forming a coherent group
- Node ID format: `{parentdir}_{filestem}_{entityname}` (matches graphify format, ensures deterministic IDs across chunks)
- JSON schema output only, no markdown wrapping

### Hyperedges

```typescript
interface Hyperedge {
  id: string;
  label: string;
  nodes: string[];       // 3+ node IDs
  relation: 'participate_in' | 'implement' | 'form';
  confidence: 'EXTRACTED' | 'INFERRED';
  confidence_score: number;
  source_file: string;
}
```

### Caching

- Hash key: `sha256(filePath + content)`
- Store: `graphify-out/.semantic_cache.json` (map of hash → {nodes, edges, hyperedges})
- On re-run: skip files with matching hash, reuse cached extraction

### Integration into Pipeline

The LLM extractor is called AFTER structural parsing (Step 2) and BEFORE graph building (Step 3):

```
detect → parse (structural) → [LLM extract] → build graph → dedup → cluster → analyze → export
                                  ↑ NEW
```

In `verify-pipeline.ts`, the flow becomes:
1. Parse all files structurally (existing)
2. For non-code files, run LLM semantic extraction (new, optional — requires configured provider)
3. Merge structural + semantic results
4. Build graph from merged extraction

---

## 5. File Summary

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/core/ai/providers/openai.ts` | OpenAI streaming chat | ~80 |
| `src/core/ai/providers/anthropic.ts` | Anthropic streaming chat | ~100 |
| `src/core/ai/providers/deepseek.ts` | DeepSeek (delegates to OpenAI adapter) | ~20 |
| `src/core/ai/tools/index.ts` | 8 retrieval tools | ~200 |
| `src/core/ai/agent-loop.ts` | ReAct agent loop | ~120 |
| `src/core/pipeline/llm-extractor.ts` | LLM semantic extraction | ~250 |
| `src/core/ai/__tests__/providers.test.ts` | Provider unit tests | ~150 |
| `src/core/ai/__tests__/tools.test.ts` | Tool unit tests | ~120 |
| `src/core/ai/__tests__/agent-loop.test.ts` | Agent loop tests | ~100 |
| `src/core/pipeline/__tests__/llm-extractor.test.ts` | LLM extractor tests | ~100 |

No new dependencies needed — `fetch` is built into Node 18+.

---

## 6. Testing Strategy

- **Providers**: Mock `fetch`. Test: success path with streaming chunks, error response, network failure, tool call delta parsing.
- **Tools**: Use mock DB (similar to existing search.test.ts). Test: each tool returns valid JSON, missing nodes handled, edge cases.
- **Agent Loop**: Mock provider that yields controlled chunks. Test: single-turn (no tool calls), multi-turn (tool calls), max iteration limit, tool execution error handling.
- **LLM Extractor**: Mock provider returning known JSON. Test: correct merge, dedup by ID, cache hit/miss, empty file set, malformed LLM response handling.

TDD: write failing test → implement → refactor. Target 80%+ coverage per module.

---

## 7. Self-Review

- No placeholders or TODOs
- No new external dependencies
- DeepSeek/OAI code sharing is intentional (not DRY violation — different products, same API spec)
- LLM extractor is optional — pipeline runs without it if no provider configured
- All types already defined in `types.ts`; no type changes needed
- Caching ensures re-runs are cheap for unchanged files
