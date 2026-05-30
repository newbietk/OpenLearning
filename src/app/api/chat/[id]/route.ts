import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createChatService } from "@/modules/chat/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const service = createChatService(db);
  const session = service.getSession(id);
  if (!session) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  const messages = service.getMessages(id);
  return NextResponse.json({ success: true, data: { session, messages } });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const service = createChatService(db);
  service.deleteSession(id);
  return NextResponse.json({ success: true });
}
