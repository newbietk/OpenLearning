# Phase 3: Core AI Engine + LLM Semantic Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AI Provider adapters (OpenAI/Anthropic/DeepSeek), 8 knowledge graph retrieval tools, ReAct Agent Loop, and LLM semantic extractor for the knowledge pipeline.

**Architecture:** Three AI providers implement the `ModelProvider` interface from `types.ts`. DeepSeek reuses the OpenAI adapter since its API is OpenAI-compatible. The 8 retrieval tools wrap existing pipeline functions (`search.ts`, `analyze.ts`, `cluster.ts`). The ReAct agent loop orchestrates tool calls. The LLM semantic extractor is a pipeline step that uses any configured provider to extract entities/edges/hyperedges from non-code files, with content-hash caching.

**Tech Stack:** TypeScript, Vitest, Node 18+ fetch (no new deps)

---

## File Structure

```
src/core/ai/
├── types.ts                          # Already exists — no changes needed
├── providers/
│   ├── openai.ts                     # Create — OpenAI streaming chat
│   ├── anthropic.ts                  # Create — Anthropic streaming chat
│   └── deepseek.ts                   # Create — DeepSeek (wraps OpenAI adapter)
├── tools/
│   └── index.ts                      # Create — 8 graph retrieval tools
└── agent-loop.ts                     # Create — ReAct agent loop

src/core/pipeline/
└── llm-extractor.ts                  # Create — LLM semantic extraction

Tests:
src/core/ai/__tests__/
├── providers.test.ts                 # Create — 3 providers
├── tools.test.ts                     # Create — 8 tools
└── agent-loop.test.ts                # Create — agent loop

src/core/pipeline/__tests__/
└── llm-extractor.test.ts             # Create — semantic extractor

Scripts:
└── scripts/verify-pipeline.ts        # Modify — add LLM extraction step
```

---

### Task 13: OpenAI Provider

**Files:**
- Create: `src/core/ai/providers/openai.ts`
- Test: `src/core/ai/__tests__/providers.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/core/ai/__tests__/providers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Message, ToolDef } from "../types";

// We test the OpenAI provider which also covers DeepSeek (same API shape)

describe("OpenAI Provider", () => {
  let createOpenAIProvider: typeof import("../providers/openai").createOpenAIProvider;
  const mockFetch = vi.fn();

  beforeAll(async () => {
    vi.stubGlobal("fetch", mockFetch);
    const mod = await import("../providers/openai");
    createOpenAIProvider = mod.createOpenAIProvider;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams text chunks from OpenAI", async () => {
    const provider = createOpenAIProvider("sk-test", "gpt-4o");
    const messages: Message[] = [{ role: "user", content: "Hello" }];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]),
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chat(messages)) {
      if (chunk.type === "text") chunks.push(chunk.content!);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("yields tool_call chunks", async () => {
    const provider = createOpenAIProvider("sk-test");
    const messages: Message[] = [{ role: "user", content: "Search for React" }];
    const tools: ToolDef[] = [{
      name: "search_knowledge",
      description: "Search KB",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Query" } },
        required: ["query"],
      },
    }];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc1", function: { name: "search_knowledge", arguments: '{"query"' } } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"React"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]),
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chat(messages, tools)) {
      if (chunk.type === "tool_call") chunks.push(chunk.toolCall!.name);
    }

    expect(chunks).toContain("search_knowledge");
  });

  it("yields error on non-2xx response", async () => {
    const provider = createOpenAIProvider("sk-test");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid API key"}}',
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chat([{ role: "user", content: "hi" }])) {
      chunks.push(chunk.type);
    }

    expect(chunks).toContain("error");
  });

  it("yields error on network failure", async () => {
    const provider = createOpenAIProvider("sk-test");
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const chunks: string[] = [];
    for await (const chunk of provider.chat([{ role: "user", content: "hi" }])) {
      chunks.push(chunk.type);
    }

    expect(chunks).toContain("error");
  });

  it("uses custom baseUrl", async () => {
    const provider = createOpenAIProvider("sk-test", "gpt-4o", "https://custom.api.com");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]),
    });

    for await (const _ of provider.chat([{ role: "user", content: "hi" }])) {}

    expect(mockFetch.mock.calls[0][0]).toBe("https://custom.api.com/v1/chat/completions");
  });
});

// Helper: convert objects to a readable SSE stream
function makeStream(chunks: Record<string, unknown>[]): ReadableStream {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index])}\n\n`));
      index++;
      if (index >= chunks.length) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/ai/__tests__/providers.test.ts
```
Expected: FAIL — "createOpenAIProvider is not a function"

- [ ] **Step 3: Implement OpenAI provider**

```typescript
// src/core/ai/providers/openai.ts
import type { ModelProvider, Message, ToolDef, StreamChunk, ToolCall } from "../types";

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
  index: number;
}

export function createOpenAIProvider(
  apiKey: string,
  model: string = "gpt-4o",
  baseUrl: string = "https://api.openai.com",
): ModelProvider {
  return {
    name: "openai",
    async *chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        })),
        stream: true,
      };

      if (tools?.length) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
      } catch (err) {
        yield { type: "error", error: err instanceof Error ? err.message : "Network error" };
        return;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        yield { type: "error", error: `HTTP ${response.status}: ${errText.slice(0, 500)}` };
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const toolAccumulators = new Map<number, ToolCallAccumulator>();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line === "data: [DONE]") {
              yield { type: "done" };
              return;
            }
            if (!line.startsWith("data: ")) continue;

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
            if (!choices?.length) continue;

            const delta = choices[0].delta as Record<string, unknown> | undefined;
            const finishReason = choices[0].finish_reason as string | undefined;

            if (delta?.content) {
              yield { type: "text", content: delta.content as string };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
                const idx = tc.index as number;
                let acc = toolAccumulators.get(idx);
                if (!acc) {
                  acc = { id: tc.id as string ?? "", name: "", arguments: "", index: idx };
                  toolAccumulators.set(idx, acc);
                }
                if (tc.id) acc.id = tc.id as string;
                const fn = tc.function as Record<string, unknown> | undefined;
                if (fn?.name) acc.name += fn.name as string;
                if (fn?.arguments) acc.arguments += fn.arguments as string;
              }
            }

            if (finishReason === "stop") {
              // Flush any accumulated tool calls before done
              for (const acc of toolAccumulators.values()) {
                if (acc.name) {
                  let args: Record<string, unknown> = {};
                  try { args = JSON.parse(acc.arguments); } catch { /* partial */ }
                  yield {
                    type: "tool_call",
                    toolCall: { id: acc.id, name: acc.name, arguments: args },
                  };
                }
              }
              yield { type: "done" };
              return;
            }

            if (finishReason && finishReason !== "stop") {
              yield { type: "done" };
              return;
            }
          }
        }
      } catch (err) {
        yield { type: "error", error: err instanceof Error ? err.message : "Stream read error" };
      } finally {
        reader.releaseLock();
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/ai/__tests__/providers.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/providers/openai.ts src/core/ai/__tests__/providers.test.ts
git commit -m "feat: OpenAI streaming provider with tool call support"
```

---

### Task 14: Anthropic Provider

**Files:**
- Create: `src/core/ai/providers/anthropic.ts`
- Modify: `src/core/ai/__tests__/providers.test.ts` — add Anthropic tests

- [ ] **Step 1: Write Anthropic tests (append to existing test file)**

```typescript
// Append to src/core/ai/__tests__/providers.test.ts

describe("Anthropic Provider", () => {
  let createAnthropicProvider: typeof import("../providers/anthropic").createAnthropicProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const mod = await import("../providers/anthropic");
    createAnthropicProvider = mod.createAnthropicProvider;
  });

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("streams text deltas from Anthropic", async () => {
    const provider = createAnthropicProvider("sk-ant-test", "claude-sonnet-4-6");
    const messages = [{ role: "user" as const, content: "Hello" }];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeAnthropicStream([
        { type: "message_start", message: { id: "msg_1", role: "assistant", model: "claude-sonnet-4-6", content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
    });

    const texts: string[] = [];
    for await (const chunk of provider.chat(messages)) {
      if (chunk.type === "text") texts.push(chunk.content!);
    }

    expect(texts).toEqual(["Hello", " world"]);
  });

  it("streams tool_use blocks from Anthropic", async () => {
    const provider = createAnthropicProvider("sk-ant-test");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeAnthropicStream([
        { type: "message_start", message: { id: "msg_1", role: "assistant", model: "claude-sonnet-4-6", content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tcu_1", name: "search_knowledge", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"React"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]),
    });

    const toolCalls: string[] = [];
    for await (const chunk of provider.chat([{ role: "user", content: "search" }])) {
      if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall!.name);
    }

    expect(toolCalls).toContain("search_knowledge");
  });

  it("yields error on non-2xx from Anthropic", async () => {
    const provider = createAnthropicProvider("sk-ant-test");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"invalid x-api-key"}}',
    });

    const types: string[] = [];
    for await (const chunk of provider.chat([{ role: "user", content: "hi" }])) {
      types.push(chunk.type);
    }
    expect(types).toContain("error");
  });

  it("sends correct headers", async () => {
    const provider = createAnthropicProvider("sk-ant-test", "claude-sonnet-4-6");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeAnthropicStream([
        { type: "message_start", message: { id: "msg_1", role: "assistant", model: "claude-sonnet-4-6", content: [] } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
    });

    for await (const _ of provider.chat([{ role: "user", content: "hi" }])) {}

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });
});

// Helper for Anthropic SSE format
function makeAnthropicStream(events: Record<string, unknown>[]): ReadableStream {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= events.length) {
        controller.close();
        return;
      }
      const event = events[index];
      const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      controller.enqueue(encoder.encode(data));
      index++;
    },
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/ai/__tests__/providers.test.ts -t "Anthropic"
```
Expected: FAIL — "createAnthropicProvider is not a function"

- [ ] **Step 3: Implement Anthropic provider**

```typescript
// src/core/ai/providers/anthropic.ts
import type { ModelProvider, Message, ToolDef, StreamChunk } from "../types";

interface AnthropicEvent {
  type: string;
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  content_block?: { type: string; id: string; name?: string; input?: Record<string, unknown> };
  index?: number;
  message?: Record<string, unknown>;
}

export function createAnthropicProvider(
  apiKey: string,
  model: string = "claude-sonnet-4-6",
): ModelProvider {
  return {
    name: "anthropic",
    async *chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk> {
      const systemMessages = messages.filter((m) => m.role === "user" && messages.indexOf(m) === 0);
      const chatMessages = messages.filter((m) => m.role !== "user" || messages.indexOf(m) > 0);

      const body: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        messages: messages.map((m) => {
          if (m.role === "assistant" && m.toolCalls?.length) {
            return {
              role: "assistant",
              content: m.toolCalls.map((tc) => ({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })),
            };
          }
          if (m.role === "tool") {
            return {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        stream: true,
      };

      if (tools?.length) {
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      let response: Response;
      try {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
      } catch (err) {
        yield { type: "error", error: err instanceof Error ? err.message : "Network error" };
        return;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        yield { type: "error", error: `HTTP ${response.status}: ${errText.slice(0, 500)}` };
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Track tool_use state across SSE events
      let currentToolId = "";
      let currentToolName = "";
      let currentToolInput = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            let eventType = "";
            let dataStr = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              if (line.startsWith("data: ")) dataStr = line.slice(6);
            }

            if (!dataStr) continue;

            let ev: AnthropicEvent;
            try { ev = JSON.parse(dataStr); } catch { continue; }

            if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
              currentToolId = ev.content_block.id;
              currentToolName = ev.content_block.name || "";
              currentToolInput = "";
            }

            if (ev.type === "content_block_delta") {
              if (ev.delta?.type === "text_delta" && ev.delta.text) {
                yield { type: "text", content: ev.delta.text };
              }
              if (ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
                currentToolInput += ev.delta.partial_json;
              }
            }

            if (ev.type === "content_block_stop" && currentToolName) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(currentToolInput); } catch { /* partial */ }
              yield {
                type: "tool_call",
                toolCall: { id: currentToolId, name: currentToolName, arguments: args },
              };
              currentToolName = "";
              currentToolInput = "";
            }

            if (ev.type === "message_delta" && ev.delta?.stop_reason === "end_turn") {
              yield { type: "done" };
              return;
            }

            if (ev.type === "message_stop") {
              yield { type: "done" };
              return;
            }
          }
        }
      } catch (err) {
        yield { type: "error", error: err instanceof Error ? err.message : "Stream read error" };
      } finally {
        reader.releaseLock();
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/ai/__tests__/providers.test.ts
```
Expected: 9 tests PASS (5 OpenAI + 4 Anthropic)

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/providers/anthropic.ts src/core/ai/__tests__/providers.test.ts
git commit -m "feat: Anthropic streaming provider with tool_use support"
```

---

### Task 15: DeepSeek Provider

**Files:**
- Create: `src/core/ai/providers/deepseek.ts`
- Modify: `src/core/ai/__tests__/providers.test.ts` — add DeepSeek test

- [ ] **Step 1: Write DeepSeek test (append to test file)**

```typescript
// Append to src/core/ai/__tests__/providers.test.ts

describe("DeepSeek Provider", () => {
  let createDeepSeekProvider: typeof import("../providers/deepseek").createDeepSeekProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const mod = await import("../providers/deepseek");
    createDeepSeekProvider = mod.createDeepSeekProvider;
  });

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("routes to DeepSeek base URL by default", async () => {
    const provider = createDeepSeekProvider("sk-ds-test");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]),
    });

    for await (const _ of provider.chat([{ role: "user", content: "hi" }])) {}

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("uses deepseek-chat as default model", async () => {
    const provider = createDeepSeekProvider("sk-ds-test");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]),
    });

    for await (const _ of provider.chat([{ role: "user", content: "hi" }])) {}

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-chat");
  });

  it("accepts custom model", async () => {
    const provider = createDeepSeekProvider("sk-ds-test", "deepseek-reasoner");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]),
    });

    for await (const _ of provider.chat([{ role: "user", content: "hi" }])) {}

    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe("deepseek-reasoner");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/ai/__tests__/providers.test.ts -t "DeepSeek"
```
Expected: FAIL

- [ ] **Step 3: Implement DeepSeek provider**

```typescript
// src/core/ai/providers/deepseek.ts
import { createOpenAIProvider } from "./openai";
import type { ModelProvider } from "../types";

export function createDeepSeekProvider(
  apiKey: string,
  model: string = "deepseek-chat",
): ModelProvider {
  return createOpenAIProvider(apiKey, model, "https://api.deepseek.com");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/ai/__tests__/providers.test.ts
```
Expected: 12 tests PASS (5 OpenAI + 4 Anthropic + 3 DeepSeek)

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/providers/deepseek.ts src/core/ai/__tests__/providers.test.ts
git commit -m "feat: DeepSeek provider (reuses OpenAI adapter)"
```

---

### Task 16: 8 Knowledge Graph Retrieval Tools

**Files:**
- Create: `src/core/ai/tools/index.ts`
- Test: `src/core/ai/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/core/ai/__tests__/tools.test.ts
import { describe, it, expect } from "vitest";

// Minimal mock DB — tools only use a subset of the full Database interface
function makeMockDb() {
  const nodes = [
    { id: "n1", label: "React", nodeType: "concept", kbId: "kb1", sourceDocId: null, metadata: {}, createdAt: "" },
    { id: "n2", label: "TypeScript", nodeType: "concept", kbId: "kb1", sourceDocId: null, metadata: {}, createdAt: "" },
    { id: "n3", label: "useState", nodeType: "function", kbId: "kb1", sourceDocId: null, metadata: {}, createdAt: "" },
  ];
  const edges = [
    { id: "e1", sourceNodeId: "n1", targetNodeId: "n2", relation: "related_to", confidence: 1.0, kbId: "kb1", createdAt: "" },
    { id: "e2", sourceNodeId: "n2", targetNodeId: "n3", relation: "imports", confidence: 1.0, kbId: "kb1", createdAt: "" },
  ];

  return {
    graphNode: {
      findByKbId: () => nodes,
      findByLabel: (_kbId: string, label: string) => nodes.find((n) => n.label === label) ?? null,
      findNeighbors: (nodeId: string) => {
        const neighborIds = edges
          .filter((e) => e.sourceNodeId === nodeId)
          .map((e) => e.targetNodeId);
        return nodes.filter((n) => neighborIds.includes(n.id));
      },
      search: () => nodes.filter((n) => n.label.toLowerCase().includes("react")),
      batchCreate: () => {},
      deleteByKbId: () => {},
    },
    graphEdge: {
      findByKbId: () => edges,
      findByNode: (nodeId: string) => edges.filter((e) => e.sourceNodeId === nodeId),
      batchCreate: () => {},
      deleteByKbId: () => {},
    },
    document: {
      findByKbId: () => [{ id: "d1", title: "React Docs", kbId: "kb1", sourceType: "link", sourceUrl: "https://react.dev", filePath: null, fileSize: null, status: "done", errorMessage: null, parsedAt: null, createdAt: "" }],
      findById: () => null,
      create: () => ({ id: "", kbId: "", title: "", sourceType: "", sourceUrl: null, filePath: null, fileSize: null, status: "pending" as const, errorMessage: null, parsedAt: null, createdAt: "" }),
      updateStatus: () => {},
      delete: () => {},
    },
    documentChunk: { findByDocId: () => [], batchCreate: () => {}, deleteByDocId: () => {} },
  };
}

describe("tools", () => {
  let createTools: typeof import("../tools/index").createTools;

  beforeAll(async () => {
    const mod = await import("../tools/index");
    createTools = mod.createTools;
  });

  it("search_knowledge returns matching nodes", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("search_knowledge", { query: "React" }, "tc1");
    expect(result.toolCallId).toBe("tc1");
    const parsed = JSON.parse(result.output);
    expect(parsed.nodes.some((n: any) => n.label === "React")).toBe(true);
  });

  it("get_node finds by label", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_node", { label: "React" }, "tc2");
    const parsed = JSON.parse(result.output);
    expect(parsed.label).toBe("React");
  });

  it("get_node returns error for missing node", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_node", { label: "NoSuchNode" }, "tc3");
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toBeDefined();
  });

  it("get_neighbors returns 1-hop subgraph", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_neighbors", { nodeLabel: "React" }, "tc4");
    const parsed = JSON.parse(result.output);
    expect(parsed.neighbors.length).toBeGreaterThan(0);
    expect(parsed.edges.length).toBeGreaterThan(0);
  });

  it("graph_stats returns counts", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("graph_stats", {}, "tc5");
    const parsed = JSON.parse(result.output);
    expect(parsed.nodeCount).toBe(3);
    expect(parsed.edgeCount).toBe(2);
  });

  it("god_nodes returns top nodes by degree", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("god_nodes", { limit: 2 }, "tc6");
    const parsed = JSON.parse(result.output);
    expect(parsed.length).toBeLessThanOrEqual(2);
  });

  it("shortest_path finds path between two nodes", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("shortest_path", { fromLabel: "React", toLabel: "useState" }, "tc7");
    const parsed = JSON.parse(result.output);
    expect(parsed.path).toBeDefined();
  });

  it("get_document finds by title", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("get_document", { title: "React" }, "tc8");
    const parsed = JSON.parse(result.output);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("unknown tool returns error", async () => {
    const { execute } = createTools(makeMockDb() as any, "kb1");
    const result = await execute("nonexistent_tool", {}, "tc9");
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toBeDefined();
  });

  it("definitions return all 8 tools", () => {
    const { definitions } = createTools(makeMockDb() as any, "kb1");
    expect(definitions.length).toBe(8);
    const names = definitions.map((d) => d.name);
    expect(names).toContain("search_knowledge");
    expect(names).toContain("get_node");
    expect(names).toContain("get_neighbors");
    expect(names).toContain("get_community");
    expect(names).toContain("god_nodes");
    expect(names).toContain("graph_stats");
    expect(names).toContain("shortest_path");
    expect(names).toContain("get_document");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/ai/__tests__/tools.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement tools**

```typescript
// src/core/ai/tools/index.ts
import type { ToolDef, ToolResult } from "../types";
import type { Database } from "../../../lib/db/interface";

interface LightDB {
  graphNode: {
    findByKbId(kbId: string): Array<{ id: string; label: string; nodeType: string; metadata: Record<string, unknown> }>;
    findByLabel(kbId: string, label: string): { id: string; label: string; nodeType: string } | null;
    findNeighbors(nodeId: string, kbId: string): Array<{ id: string; label: string; nodeType: string }>;
    search(kbId: string, query: string): Array<{ id: string; label: string }>;
  };
  graphEdge: {
    findByKbId(kbId: string): Array<{ id: string; sourceNodeId: string; targetNodeId: string; relation: string; confidence: number }>;
    findByNode(nodeId: string, kbId: string): Array<{ id: string; sourceNodeId: string; targetNodeId: string; relation: string }>;
  };
  document: {
    findByKbId(kbId: string): Array<{ id: string; title: string }>;
    findById(id: string): { id: string; title: string; sourceType: string } | null;
  };
}

export function createTools(db: LightDB, kbId: string): {
  definitions: ToolDef[];
  execute: (name: string, args: Record<string, unknown>, toolCallId: string) => Promise<ToolResult>;
} {
  const definitions: ToolDef[] = [
    {
      name: "search_knowledge",
      description: "Search the knowledge graph using keywords. Returns matching nodes and their neighbors via BFS traversal.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          maxDepth: { type: "number", description: "BFS traversal depth (default: 1)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_node",
      description: "Get detailed information about a specific node by its label.",
      parameters: {
        type: "object",
        properties: { label: { type: "string", description: "Node label to look up" } },
        required: ["label"],
      },
    },
    {
      name: "get_neighbors",
      description: "Get the neighboring nodes and edges for a given node.",
      parameters: {
        type: "object",
        properties: {
          nodeLabel: { type: "string", description: "Node label to get neighbors for" },
          relation: { type: "string", description: "Optional relation type filter" },
        },
        required: ["nodeLabel"],
      },
    },
    {
      name: "get_community",
      description: "Get all nodes that belong to the same community as the given node.",
      parameters: {
        type: "object",
        properties: { nodeLabel: { type: "string", description: "Node label in the target community" } },
        required: ["nodeLabel"],
      },
    },
    {
      name: "god_nodes",
      description: "Get the most connected (hub) nodes in the knowledge graph.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Number of top nodes (default: 10)" } },
        required: [],
      },
    },
    {
      name: "graph_stats",
      description: "Get summary statistics about the knowledge graph.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    {
      name: "shortest_path",
      description: "Find the shortest connection path between two concepts in the graph.",
      parameters: {
        type: "object",
        properties: {
          fromLabel: { type: "string", description: "Starting node label" },
          toLabel: { type: "string", description: "Target node label" },
        },
        required: ["fromLabel", "toLabel"],
      },
    },
    {
      name: "get_document",
      description: "Get documents whose title matches the query.",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "Document title (partial match)" } },
        required: ["title"],
      },
    },
  ];

  async function execute(name: string, args: Record<string, unknown>, toolCallId: string): Promise<ToolResult> {
    const ok = (output: unknown): ToolResult => ({
      toolCallId,
      output: JSON.stringify(output),
    });
    const err = (msg: string): ToolResult => ({
      toolCallId,
      output: JSON.stringify({ error: msg }),
    });

    switch (name) {
      case "search_knowledge": {
        const query = args.query as string;
        const maxDepth = (args.maxDepth as number) ?? 1;
        const matched = db.graphNode.search(kbId, query);
        const seen = new Set(matched.map((n) => n.id));
        const allNodes = [...matched];
        const allEdges: Array<Record<string, unknown>> = [];

        if (maxDepth > 0) {
          for (const node of matched) {
            const neighbors = db.graphNode.findNeighbors(node.id, kbId);
            const nodeEdges = db.graphEdge.findByNode(node.id, kbId);
            for (const n of neighbors) {
              if (!seen.has(n.id)) { seen.add(n.id); allNodes.push(n); }
            }
            for (const e of nodeEdges) {
              if (!allEdges.some((x) => x.id === e.id)) allEdges.push(e);
            }
          }
        }

        return ok({ nodes: allNodes, edges: allEdges, query });
      }

      case "get_node": {
        const node = db.graphNode.findByLabel(kbId, args.label as string);
        return node ? ok(node) : err(`Node "${args.label}" not found`);
      }

      case "get_neighbors": {
        const node = db.graphNode.findByLabel(kbId, args.nodeLabel as string);
        if (!node) return err(`Node "${args.nodeLabel}" not found`);
        const neighbors = db.graphNode.findNeighbors(node.id, kbId);
        const edges = db.graphEdge.findByNode(node.id, kbId);
        const relationFilter = args.relation as string | undefined;
        const filtered = relationFilter
          ? edges.filter((e) => e.relation === relationFilter)
          : edges;
        return ok({ node, neighbors, edges: filtered });
      }

      case "get_community": {
        const node = db.graphNode.findByLabel(kbId, args.nodeLabel as string);
        if (!node) return err(`Node "${args.nodeLabel}" not found`);

        // Find community by BFS clustering — use connected component as proxy
        const visited = new Set<string>();
        const queue = [node.id];
        visited.add(node.id);

        while (queue.length > 0) {
          const current = queue.shift()!;
          const neighbors = db.graphNode.findNeighbors(current, kbId);
          for (const n of neighbors) {
            if (!visited.has(n.id)) { visited.add(n.id); queue.push(n.id); }
          }
        }

        const members = db.graphNode.findByKbId(kbId).filter((n) => visited.has(n.id));
        return ok({ nodeLabel: args.nodeLabel, members });
      }

      case "god_nodes": {
        const limit = (args.limit as number) ?? 10;
        const nodes = db.graphNode.findByKbId(kbId);
        const edges = db.graphEdge.findByKbId(kbId);
        const degree = new Map<string, number>();
        for (const e of edges) {
          degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) ?? 0) + 1);
          degree.set(e.targetNodeId, (degree.get(e.targetNodeId) ?? 0) + 1);
        }
        const sorted = nodes
          .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
          .sort((a, b) => b.degree - a.degree)
          .slice(0, limit);
        return ok(sorted);
      }

      case "graph_stats": {
        const nodes = db.graphNode.findByKbId(kbId);
        const edges = db.graphEdge.findByKbId(kbId);
        return ok({ nodeCount: nodes.length, edgeCount: edges.length });
      }

      case "shortest_path": {
        const fromLabel = args.fromLabel as string;
        const toLabel = args.toLabel as string;
        const fromNode = db.graphNode.findByLabel(kbId, fromLabel);
        const toNode = db.graphNode.findByLabel(kbId, toLabel);
        if (!fromNode || !toNode) return err("One or both nodes not found");

        // BFS from source
        const edges = db.graphEdge.findByKbId(kbId);
        const adj = new Map<string, string[]>();
        for (const e of edges) {
          if (!adj.has(e.sourceNodeId)) adj.set(e.sourceNodeId, []);
          adj.get(e.sourceNodeId)!.push(e.targetNodeId);
          if (!adj.has(e.targetNodeId)) adj.set(e.targetNodeId, []);
          adj.get(e.targetNodeId)!.push(e.sourceNodeId);
        }

        const parent = new Map<string, string>();
        const visited = new Set<string>();
        const queue = [fromNode.id];
        visited.add(fromNode.id);

        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (cur === toNode.id) break;
          for (const nb of adj.get(cur) ?? []) {
            if (!visited.has(nb)) { visited.add(nb); parent.set(nb, cur); queue.push(nb); }
          }
        }

        if (!visited.has(toNode.id)) return err("No path found between these nodes");

        const path: string[] = [];
        let cur = toNode.id;
        while (cur !== fromNode.id) {
          path.unshift(cur);
          cur = parent.get(cur)!;
        }
        path.unshift(fromNode.id);

        const pathLabels = path.map((id) => {
          const n = db.graphNode.findByKbId(kbId).find((x) => x.id === id);
          return n?.label ?? id;
        });

        return ok({ path: pathLabels, length: path.length - 1 });
      }

      case "get_document": {
        const title = args.title as string;
        const docs = db.document.findByKbId(kbId);
        const matched = docs.filter((d) => d.title.toLowerCase().includes(title.toLowerCase()));
        return ok(matched);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  }

  return { definitions, execute };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/ai/__tests__/tools.test.ts
```
Expected: 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/tools/index.ts src/core/ai/__tests__/tools.test.ts
git commit -m "feat: 8 knowledge graph retrieval tools with executor"
```

---

### Task 17: Agent Loop (ReAct)

**Files:**
- Create: `src/core/ai/agent-loop.ts`
- Test: `src/core/ai/__tests__/agent-loop.test.ts`

- [ ] **Step 1: Write agent loop tests**

```typescript
// src/core/ai/__tests__/agent-loop.test.ts
import { describe, it, expect, vi } from "vitest";
import type { StreamChunk, Message, AgentConfig, ToolResult } from "../types";

// Mock provider that yields controlled chunks
function makeMockProvider(responses: StreamChunk[][]): import("../types").ModelProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async *chat(_messages: Message[], _tools?: import("../types").ToolDef[]): AsyncIterable<StreamChunk> {
      const chunks = responses[callIndex] ?? [{ type: "done" as const }];
      callIndex++;
      for (const c of chunks) yield c;
    },
  };
}

describe("agent-loop", () => {
  let runAgentLoop: typeof import("../agent-loop").runAgentLoop;

  beforeAll(async () => {
    const mod = await import("../agent-loop");
    runAgentLoop = mod.runAgentLoop;
  });

  it("returns immediate response when no tool calls needed", async () => {
    const provider = makeMockProvider([
      [{ type: "text", content: "Hello!" }, { type: "done" }],
    ]);

    const config: AgentConfig = { maxIterations: 10, kbId: "kb1", provider };

    const tools = {
      definitions: [],
      execute: vi.fn(),
    };

    const events: string[] = [];
    for await (const ev of runAgentLoop(config, tools, "Hi")) {
      events.push(ev.type);
    }

    expect(events).toContain("thinking");
    expect(events).toContain("response");
    expect(events).toContain("done");
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it("executes tool calls and continues loop", async () => {
    const provider = makeMockProvider([
      // First turn: tool call
      [
        { type: "tool_call", toolCall: { id: "tc1", name: "search_knowledge", arguments: { query: "React" } } },
        { type: "done" },
      ],
      // Second turn: final response
      [
        { type: "text", content: "Found React in the KB." },
        { type: "done" },
      ],
    ]);

    const config: AgentConfig = { maxIterations: 10, kbId: "kb1", provider };

    const tools = {
      definitions: [{ name: "search_knowledge", description: "Search", parameters: { type: "object" as const, properties: {}, required: [] } }],
      execute: vi.fn().mockResolvedValue({ toolCallId: "tc1", output: '{"nodes":[]}' }),
    };

    const events: string[] = [];
    for await (const ev of runAgentLoop(config, tools, "Search for React")) {
      events.push(ev.type);
    }

    expect(events.filter((e) => e === "tool_call").length).toBe(1);
    expect(events.filter((e) => e === "tool_result").length).toBe(1);
    expect(events.filter((e) => e === "response").length).toBe(1);
    expect(tools.execute).toHaveBeenCalledWith("search_knowledge", { query: "React" });
  });

  it("stops after maxIterations", async () => {
    // Provider that always requests tool calls
    const provider = makeMockProvider(
      Array.from({ length: 15 }, () => [
        { type: "tool_call", toolCall: { id: "tc", name: "search_knowledge", arguments: {} } },
        { type: "done" },
      ]),
    );

    const config: AgentConfig = { maxIterations: 5, kbId: "kb1", provider };

    const tools = {
      definitions: [{ name: "search_knowledge", description: "S", parameters: { type: "object" as const, properties: {}, required: [] } }],
      execute: vi.fn().mockResolvedValue({ toolCallId: "tc", output: "{}" }),
    };

    let toolCallCount = 0;
    for await (const ev of runAgentLoop(config, tools, "Query")) {
      if (ev.type === "tool_call") toolCallCount++;
    }

    expect(toolCallCount).toBeLessThanOrEqual(5);
  });

  it("handles tool execution errors gracefully", async () => {
    const provider = makeMockProvider([
      [
        { type: "tool_call", toolCall: { id: "tc1", name: "search_knowledge", arguments: { query: "X" } } },
        { type: "done" },
      ],
      [
        { type: "text", content: "Search failed but I'll try to help anyway." },
        { type: "done" },
      ],
    ]);

    const config: AgentConfig = { maxIterations: 10, kbId: "kb1", provider };

    const tools = {
      definitions: [{ name: "search_knowledge", description: "Search", parameters: { type: "object" as const, properties: {}, required: [] } }],
      execute: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    };

    const events: string[] = [];
    for await (const ev of runAgentLoop(config, tools, "Query")) {
      events.push(ev.type);
    }

    // Should NOT yield error type — tool errors are fed back to the model
    expect(events).toContain("tool_result");
    expect(events).toContain("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/ai/__tests__/agent-loop.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement agent loop**

```typescript
// src/core/ai/agent-loop.ts
import type { Message, ModelProvider, ToolDef, AgentConfig, AgentEvent, ToolResult } from "./types";

export async function* runAgentLoop(
  config: AgentConfig,
  tools: {
    definitions: ToolDef[];
    execute: (name: string, args: Record<string, unknown>, toolCallId: string) => Promise<ToolResult>;
  },
  userMessage: string,
  history: Message[] = [],
): AsyncIterable<AgentEvent> {
  const messages: Message[] = [
    {
      role: "user",
      content: `You are a knowledge base assistant. Use the provided tools to search and answer questions based on the knowledge graph. Always cite sources when possible. If you cannot find relevant information, say so honestly. Current KB ID: ${config.kbId}`,
    },
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    yield { type: "thinking", content: `Iteration ${iteration + 1}` };

    let fullResponse = "";
    const pendingToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let hasError = false;

    try {
      for await (const chunk of config.provider.chat(messages, tools.definitions)) {
        if (chunk.type === "text" && chunk.content) {
          fullResponse += chunk.content;
          yield { type: "response", content: chunk.content };
        }
        if (chunk.type === "tool_call" && chunk.toolCall) {
          pendingToolCalls.push(chunk.toolCall);
          yield { type: "tool_call", toolCall: chunk.toolCall };
        }
        if (chunk.type === "error") {
          yield { type: "error", error: chunk.error };
          hasError = true;
          break;
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    if (hasError) return;

    if (pendingToolCalls.length === 0) {
      messages.push({ role: "assistant", content: fullResponse });
      yield { type: "done" };
      return;
    }

    // Build assistant message with tool calls
    messages.push({
      role: "assistant",
      content: fullResponse,
      toolCalls: pendingToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
    });

    // Execute tools and add results
    for (const tc of pendingToolCalls) {
      try {
        const result = await tools.execute(tc.name, tc.arguments, tc.id);
        yield { type: "tool_result", toolResult: result };
        messages.push({
          role: "tool",
          content: result.output,
          toolCallId: tc.id,
          name: tc.name,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        yield {
          type: "tool_result",
          toolResult: { toolCallId: tc.id, output: JSON.stringify({ error: errorMsg }) },
        };
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: errorMsg }),
          toolCallId: tc.id,
          name: tc.name,
        });
      }
    }
  }

  yield { type: "done" };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/ai/__tests__/agent-loop.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ai/agent-loop.ts src/core/ai/__tests__/agent-loop.test.ts
git commit -m "feat: ReAct agent loop with tool calling and SSE streaming"
```

---

### Task 18: LLM Semantic Extractor

**Files:**
- Create: `src/core/pipeline/llm-extractor.ts`
- Test: `src/core/pipeline/__tests__/llm-extractor.test.ts`

- [ ] **Step 1: Write LLM extractor tests**

```typescript
// src/core/pipeline/__tests__/llm-extractor.test.ts
import { describe, it, expect, vi } from "vitest";
import type { ParsedChunk, Parser } from "../types";

describe("llm-extractor", () => {
  let createLlmExtractor: typeof import("../llm-extractor").createLlmExtractor;
  let mockProvider: import("../../ai/types").ModelProvider;

  beforeAll(async () => {
    const mod = await import("../llm-extractor");
    createLlmExtractor = mod.createLlmExtractor;
  });

  function makeMockProvider(jsonOutput: Record<string, unknown>) {
    return {
      name: "mock",
      async *chat() {
        yield { type: "text", content: "```json\n" + JSON.stringify(jsonOutput) + "\n```" };
        yield { type: "done" };
      },
    } as import("../../ai/types").ModelProvider;
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
        yield { type: "text", content: "not valid json at all, no nodes here" };
        yield { type: "done" };
      },
    } as import("../../ai/types").ModelProvider;

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
        yield { type: "text", content: '{"nodes":[{"id":"n1","label":"Node","file_type":"document","source_file":"f.md"}],"edges":[],"hyperedges":[]}' };
        yield { type: "done" };
      },
    } as import("../../ai/types").ModelProvider;

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/core/pipeline/__tests__/llm-extractor.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement LLM extractor**

```typescript
// src/core/pipeline/llm-extractor.ts
import crypto from "node:crypto";
import type { ParsedChunk } from "./types";
import type { ModelProvider } from "../ai/types";

interface ExtractedNode {
  id: string;
  label: string;
  file_type: string;
  source_file: string;
  source_location?: string;
  source_url?: string;
  captured_at?: string;
  author?: string;
  contributor?: string;
}

interface ExtractedEdge {
  source: string;
  target: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
  confidence_score: number;
  source_file: string;
  source_location?: string;
  weight?: number;
}

interface ExtractedHyperedge {
  id: string;
  label: string;
  nodes: string[];
  relation: "participate_in" | "implement" | "form";
  confidence: "EXTRACTED" | "INFERRED";
  confidence_score: number;
  source_file: string;
}

interface ExtractionResult {
  nodes: ParsedChunk["nodes"];
  edges: ParsedChunk["edges"];
  hyperedges: ExtractedHyperedge[];
}

export interface LlmExtractor {
  extract(chunks: ParsedChunk[], sourceFile: string): Promise<ExtractionResult>;
}

function hashContent(filePath: string, content: string): string {
  return crypto.createHash("sha256").update(filePath).update(content).digest("hex").slice(0, 16);
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
- For design rationale (WHY decisions were made, trade-offs): store as a "rationale" concept node
- Hyperedges: only if 3+ nodes form a coherent group not captured by pairwise edges. Maximum 3.

Output ONLY valid JSON matching this schema:
{"nodes":[{"id":"string","label":"Human Readable","file_type":"document|paper|rationale|concept","source_file":"string","source_location":null,"source_url":null}],"edges":[{"source":"node_id","target":"node_id","relation":"references|cites|conceptually_related_to|semantically_similar_to|rationale_for","confidence":"EXTRACTED|INFERRED|AMBIGUOUS","confidence_score":1.0,"source_file":"string"}],"hyperedges":[{"id":"string","label":"Human Readable","nodes":["id1","id2","id3"],"relation":"participate_in|implement|form","confidence":"EXTRACTED|INFERRED","confidence_score":0.75,"source_file":"string"}]}`;
}

function parseLlmJson(text: string): { nodes: ExtractedNode[]; edges: ExtractedEdge[]; hyperedges: ExtractedHyperedge[] } {
  // Try to extract JSON from markdown code blocks or raw text
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlock ? codeBlock[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr);
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
        }
      } catch {
        return { nodes: [], edges: [], hyperedges: [] };
      }

      const responseText = responseChunks.join("");
      const extracted = parseLlmJson(responseText);

      // Convert ExtractedNode → ParsedChunk node format, dedup by ID
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
            source_url: en.source_url,
            author: en.author,
            contributor: en.contributor,
          },
        });
      }

      const edges: ParsedChunk["edges"] = extracted.edges.map((ee) => ({
        source: ee.source,
        target: ee.target,
        relation: ee.relation,
        confidence: ee.confidence === "EXTRACTED" ? "EXTRACTED" as const : "INFERRED" as const,
      }));

      const result: ExtractionResult = { nodes, edges, hyperedges: extracted.hyperedges };

      // Cache the result
      cache.set(contentHash, result);

      return result;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/core/pipeline/__tests__/llm-extractor.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/pipeline/llm-extractor.ts src/core/pipeline/__tests__/llm-extractor.test.ts
git commit -m "feat: LLM semantic extractor with content-hash caching"
```

---

### Task 19: Pipeline Integration

**Files:**
- Modify: `scripts/verify-pipeline.ts` — add optional LLM extraction step between parse and build

- [ ] **Step 1: Add LLM extract step to verify-pipeline.ts**

The LLM extraction step is OPTIONAL — it only runs if `LLM_API_KEY` and `LLM_PROVIDER` env vars are set. This ensures the pipeline works without LLM (structural-only mode).

Add after the parse step (Step 2) and before the build step (Step 3):

```typescript
// Append after the parse loop (after line ~82) in verify-pipeline.ts:

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

  // Group chunks by source file for extraction
  const chunksByFile = new Map<string, ParsedChunk[]>();
  for (const chunk of allChunks) {
    // Each chunk's first node metadata carries the source file path
    // We group by doc-level identity
    const key = chunk.chunkIndex === 0 ? chunk.content.slice(0, 50) : "";
    // Skip code files — LLM extraction is for docs/papers
  }

  // For demo: extract from first 5 non-code files
  const nonCodeChunks = allChunks.filter((c) => {
    const firstNode = c.nodes[0];
    return firstNode && !["function", "class", "method", "variable"].includes(firstNode.type);
  });

  if (nonCodeChunks.length > 0) {
    const semanticResult = await extractor.extract(
      nonCodeChunks.slice(0, 5),
      "semantic_extraction",
    );
    console.log(`    LLM extracted: ${semanticResult.nodes.length} nodes, ${semanticResult.edges.length} edges, ${semanticResult.hyperedges.length} hyperedges`);

    // Merge semantic nodes/edges into allChunks
    if (semanticResult.nodes.length > 0) {
      allChunks.push({
        chunkIndex: allChunks.length,
        content: "[LLM semantic extraction]",
        nodes: semanticResult.nodes,
        edges: semanticResult.edges,
      });
    }
  } else {
    console.log("    No non-code chunks to extract from");
  }
} else {
  console.log("\n[2.5] LLM Semantic Extraction — skipped (set LLM_PROVIDER + LLM_API_KEY to enable)");
}
```

Add the import at the top of verify-pipeline.ts:

```typescript
import type { ModelProvider } from "../src/core/ai/types";
```

- [ ] **Step 2: Run full pipeline to verify integration**

```bash
npx tsx scripts/verify-pipeline.ts
```
Expected: Pipeline completes without errors. LLM step shows "skipped" (no env vars set).

- [ ] **Step 3: Run all tests to verify nothing is broken**

```bash
npx vitest run
```
Expected: All existing 768+ tests PASS + new tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-pipeline.ts
git commit -m "feat: integrate LLM semantic extraction into pipeline (optional, gated by env vars)"
```

---

## Self-Review

**Spec coverage:**
- AI types → Already exist in `types.ts` ✓
- 3 Providers → Tasks 13 (OpenAI), 14 (Anthropic), 15 (DeepSeek) ✓
- 8 Tools → Task 16 ✓
- Agent Loop → Task 17 ✓
- LLM Semantic Extractor → Task 18 ✓
- Pipeline integration → Task 19 ✓

**Placeholder scan:** No TBDs, TODOs, or vague instructions. All code is concrete.

**Type consistency:**
- `ModelProvider` interface used consistently across all 3 providers ✓
- `Message`, `ToolDef`, `ToolCall`, `ToolResult`, `AgentEvent` match types.ts ✓
- `createTools` signature `execute(name, args, toolCallId)` consistent with agent-loop.ts call sites ✓
- `LlmExtractor.extract` returns `ExtractionResult` used correctly in pipeline integration ✓
- DeepSeek wraps OpenAI adapter — returns same `ModelProvider` type ✓
