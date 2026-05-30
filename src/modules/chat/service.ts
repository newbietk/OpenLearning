import type { Database, ChatSessionRecord, ChatMessageRecord } from "../../lib/db/interface";
import type { ModelProvider, AgentEvent, Message } from "../../core/ai/types";
import { runAgentLoop } from "../../core/ai/agent-loop";
import { createTools } from "../../core/ai/tools";
import { getLogger } from "../../lib/logger";

export function createChatService(db: Database) {
  const log = getLogger();

  return {
    // ── Session CRUD ─────────────────────────────────────────────────────

    createSession(kbId: string, externalUserId: string, title: string): ChatSessionRecord {
      return db.chat.createSession({ kbId, externalUserId, title });
    },

    getSession(id: string): ChatSessionRecord | undefined {
      return db.chat.findSessionById(id);
    },

    listSessions(externalUserId: string): ChatSessionRecord[] {
      return db.chat.findSessionsByUser(externalUserId);
    },

    deleteSession(id: string): void {
      db.chat.deleteSession(id);
    },

    // ── Messages ─────────────────────────────────────────────────────────

    getMessages(sessionId: string): ChatMessageRecord[] {
      return db.chat.findMessagesBySession(sessionId);
    },

    // ── Agent Loop ───────────────────────────────────────────────────────

    async *sendMessage(
      sessionId: string,
      userMessage: string,
      provider: ModelProvider,
    ): AsyncIterable<AgentEvent> {
      const session = db.chat.findSessionById(sessionId);
      if (!session) throw new Error("Session not found");

      // Persist user message
      db.chat.addMessage({
        sessionId,
        role: "user",
        content: userMessage,
        toolCalls: null,
      });

      // Load history
      const historyMessages = db.chat.findMessagesBySession(sessionId);
      const history: Message[] = historyMessages
        .filter((m) => m.role !== "tool")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Remove the last user message from history (added separately below)
      // Actually, runAgentLoop handles history differently. Let's just pass all history.
      const tools = createTools(db as any, session.kbId);

      log.info("chat: starting agent loop", { sessionId, kbId: session.kbId });

      let lastAssistantContent = "";
      let lastToolCalls: any = null;

      for await (const event of runAgentLoop(
        { maxIterations: 10, kbId: session.kbId, provider },
        tools,
        userMessage,
        history.slice(0, -1), // exclude the user message we just added
      )) {
        if (event.type === "response" && event.content) {
          lastAssistantContent += event.content;
        }
        if (event.type === "tool_call") {
          lastToolCalls = JSON.stringify(event.toolCall);
        }
        if (event.type === "tool_result" && event.toolResult) {
          db.chat.addMessage({
            sessionId,
            role: "tool",
            content: event.toolResult.output,
            toolCalls: null,
          });
        }

        yield event;

        if (event.type === "done") {
          if (lastAssistantContent) {
            db.chat.addMessage({
              sessionId,
              role: "assistant",
              content: lastAssistantContent,
              toolCalls: lastToolCalls,
            });
          }
        }
      }
    },
  };
}
