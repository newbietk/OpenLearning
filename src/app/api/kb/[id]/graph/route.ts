import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createKnowledgeBaseService } from "@/modules/knowledge-base/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const service = createKnowledgeBaseService(db);
  const graph = service.getGraph(id);
  return NextResponse.json({ success: true, data: graph });
}
