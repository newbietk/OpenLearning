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
