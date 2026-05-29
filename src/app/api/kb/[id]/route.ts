import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createKnowledgeBaseService } from "@/modules/knowledge-base/service";
import { getExternalId, checkIsAdmin } from "@/lib/api-utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const service = createKnowledgeBaseService(db);
  const kb = service.getKb(id);
  if (!kb) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: kb });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  const db = await getDb();
  const service = createKnowledgeBaseService(db);

  try {
    service.deleteKb(id, externalId, isAdmin);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 403 });
  }
}
