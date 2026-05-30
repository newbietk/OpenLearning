import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createChatService } from "@/modules/chat/service";
import { getExternalId } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const externalId = getExternalId(req);
  const db = await getDb();
  const service = createChatService(db);
  const sessions = service.listSessions(externalId);
  return NextResponse.json({ success: true, data: sessions });
}

export async function POST(req: NextRequest) {
  const externalId = getExternalId(req);
  const body = await req.json();
  const db = await getDb();
  const service = createChatService(db);
  const session = service.createSession(body.kbId, externalId, body.title || "New Chat");
  return NextResponse.json({ success: true, data: session }, { status: 201 });
}
