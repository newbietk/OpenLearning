import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createKnowledgeBaseService } from "@/modules/knowledge-base/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const maxDepth = parseInt(url.searchParams.get("maxDepth") || "2", 10);
  const maxResults = parseInt(url.searchParams.get("maxResults") || "20", 10);

  if (!query) {
    return NextResponse.json({ success: false, error: "Query parameter 'q' is required" }, { status: 400 });
  }

  const db = await getDb();
  const service = createKnowledgeBaseService(db);
  const results = service.searchKnowledge(id, query, maxDepth, maxResults);
  return NextResponse.json({ success: true, data: results });
}
