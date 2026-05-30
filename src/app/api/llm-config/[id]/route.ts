import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createLlmConfigService } from "@/modules/llm-config/service";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const db = await getDb();
  const service = createLlmConfigService(db);
  service.updateProvider(id, body);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const service = createLlmConfigService(db);
  service.deleteProvider(id);
  return NextResponse.json({ success: true });
}
