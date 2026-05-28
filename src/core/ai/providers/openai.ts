// src/core/ai/providers/openai.ts
import type { ModelProvider, Message, ToolDef, StreamChunk } from "../types";

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
              yield* emitAccumulatedToolCalls(toolAccumulators);
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

            if (finishReason === "stop" || finishReason === "tool_calls") {
              yield* emitAccumulatedToolCalls(toolAccumulators);
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

function* emitAccumulatedToolCalls(
  accumulators: Map<number, ToolCallAccumulator>,
): Generator<StreamChunk> {
  for (const acc of accumulators.values()) {
    if (!acc.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(acc.arguments);
    } catch {
      // partial JSON - use whatever we have
    }
    yield {
      type: "tool_call",
      toolCall: { id: acc.id, name: acc.name, arguments: args },
    };
  }
}
