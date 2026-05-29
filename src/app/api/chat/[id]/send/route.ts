import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createChatService } from "@/modules/chat/service";
import { createLlmConfigService } from "@/modules/llm-config/service";
import { getExternalId } from "@/lib/api-utils";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const externalId = getExternalId(req);
  const body = await req.json();
  const content = body.content || "";

  if (!content) {
    return new Response(
      JSON.stringify({ success: false, error: "content is required" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const db = await getDb();
  const chatService = createChatService(db);
  const llmService = createLlmConfigService(db);

  let provider;
  try {
    provider = llmService.buildProviderInstance(externalId, body.provider || "openai");
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "No enabled LLM provider found" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of chatService.sendMessage(id, content, provider)) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
