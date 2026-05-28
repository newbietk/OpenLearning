// src/core/ai/providers/anthropic.ts
import type { ModelProvider, Message, ToolDef, StreamChunk } from "../types";

export function createAnthropicProvider(
  apiKey: string,
  model: string = "claude-sonnet-4-20250514",
): ModelProvider {
  return {
    name: "anthropic",
    async *chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk> {
      const chatMessages = messages.map((m) => {
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
      });

      const body: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        messages: chatMessages,
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
            let dataStr = "";

            for (const line of lines) {
              if (line.startsWith("data: ")) dataStr = line.slice(6);
            }

            if (!dataStr) continue;

            let ev: Record<string, unknown>;
            try { ev = JSON.parse(dataStr); } catch { continue; }

            if (ev.type === "content_block_start") {
              const block = ev.content_block as Record<string, unknown> | undefined;
              if (block?.type === "tool_use") {
                currentToolId = block.id as string;
                currentToolName = block.name as string;
                currentToolInput = "";
              }
            }

            if (ev.type === "content_block_delta") {
              const delta = ev.delta as Record<string, unknown> | undefined;
              if (delta?.type === "text_delta" && delta.text) {
                yield { type: "text", content: delta.text as string };
              }
              if (delta?.type === "input_json_delta" && delta.partial_json) {
                currentToolInput += delta.partial_json as string;
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

            if (ev.type === "message_delta") {
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
