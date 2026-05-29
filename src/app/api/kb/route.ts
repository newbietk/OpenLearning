import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createKnowledgeBaseService } from "@/modules/knowledge-base/service";
import { getExternalId, checkIsAdmin } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  const db = await getDb();
  const service = createKnowledgeBaseService(db);
  const result = service.listKbs(externalId, isAdmin);
  return NextResponse.json({ success: true, data: result });
}

export async function POST(req: NextRequest) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  const body = await req.json();

  if (body.kbType === "public" && !isAdmin) {
    return NextResponse.json(
      { success: false, error: "Only admins can create public KBs" },
      { status: 403 },
    );
  }

  const db = await getDb();
  const service = createKnowledgeBaseService(db);
  const kb = service.createKb({
    ownerId: externalId,
    name: body.name,
    description: body.description || "",
    kbType: body.kbType || "private",
  });
  return NextResponse.json({ success: true, data: kb }, { status: 201 });
}
