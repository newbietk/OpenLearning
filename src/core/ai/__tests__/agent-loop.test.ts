import { describe, it, expect, vi, beforeAll } from "vitest";
import type { StreamChunk, Message, AgentConfig, ToolResult } from "../types";

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
    expect(tools.execute).toHaveBeenCalledWith("search_knowledge", { query: "React" }, "tc1");
  });

  it("stops after maxIterations", async () => {
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

    expect(toolCallCount).toBe(5);
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
    expect(events).not.toContain("error");
  });
});
