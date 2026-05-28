// src/core/ai/__tests__/providers.test.ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
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
        delta({ content: "Hello" }),
        delta({ content: " world" }),
        delta({}, "stop"),
      ]),
    });

    const chunks: string[] = [];
    for await (const chunk of provider.chat(messages)) {
      if (chunk.type === "text") chunks.push(chunk.content!);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers!["Authorization"]).toBe("Bearer sk-test");
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
        toolCallDelta(0, "tc1", "search_knowledge", '{"query"'),
        toolCallDelta(0, undefined, undefined, ':"React"}'),
        delta({}, "tool_calls"),
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

  it("serializes tool_calls in message history correctly", async () => {
    const provider = createOpenAIProvider("sk-test");
    const messages: Message[] = [
      { role: "user", content: "Search for React" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "search_knowledge", arguments: { query: "React" } }],
      },
      {
        role: "tool",
        content: '{"nodes":[]}',
        toolCallId: "tc1",
        name: "search_knowledge",
      },
      { role: "user", content: "What did you find?" },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]),
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of provider.chat(messages)) {}

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const assistantMsg = body.messages[1];
    expect(assistantMsg.tool_calls[0].type).toBe("function");
    expect(assistantMsg.tool_calls[0].function.name).toBe("search_knowledge");
    expect(assistantMsg.tool_calls[0].function.arguments).toBe('{"query":"React"}');
    // Verify tool message has name and tool_call_id
    const toolMsg = body.messages[2];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.name).toBe("search_knowledge");
    expect(toolMsg.tool_call_id).toBe("tc1");
  });

  it("uses custom baseUrl", async () => {
    const provider = createOpenAIProvider("sk-test", "gpt-4o", "https://custom.api.com");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: makeStream([delta({}, "stop")]),
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of provider.chat([{ role: "user", content: "hi" }])) {}

    expect(mockFetch.mock.calls[0][0]).toBe("https://custom.api.com/v1/chat/completions");
  });
});

// --- Test helpers ---

/** Create an OpenAI-style choice object: { choices: [{ delta, finish_reason? }] } */
function delta(deltaFields: Record<string, unknown>, finishReason?: string): Record<string, unknown> {
  const choice: Record<string, unknown> = { delta: deltaFields };
  if (finishReason) choice.finish_reason = finishReason;
  return { choices: [choice] };
}

/** Create a tool_call delta choice */
function toolCallDelta(
  index: number,
  id?: string,
  name?: string,
  args?: string,
): Record<string, unknown> {
  const tcEntry: Record<string, unknown> = { index };
  if (id !== undefined) tcEntry.id = id;
  const fnEntry: Record<string, unknown> = {};
  if (name !== undefined) fnEntry.name = name;
  if (args !== undefined) fnEntry.arguments = args;
  if (Object.keys(fnEntry).length > 0) tcEntry.function = fnEntry;
  return delta({ tool_calls: [tcEntry] });
}

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
