import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createKnowledgeBaseService } from "@/modules/knowledge-base/service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();
  const service = createKnowledgeBaseService(db);

  const docId = req.nextUrl.searchParams.get("docId");
  if (docId) {
    const doc = db.document.findById(docId);
    if (!doc) return NextResponse.json({ success: false, error: "Document not found" }, { status: 404 });
    const chunks = db.documentChunk.findByDocId(docId);
    return NextResponse.json({ success: true, data: { doc, chunks } });
  }

  const docs = service.getDocuments(id);
  return NextResponse.json({ success: true, data: docs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const formData = await req.formData();
  const title = formData.get("title") as string;
  const sourceType = (formData.get("sourceType") as string) || "text";
  const sourceUrl = formData.get("sourceUrl") as string | null;
  const filePath = formData.get("filePath") as string | null;
  const dirPath = formData.get("dirPath") as string | null;
  const content = formData.get("content") as string | null;
  const file = formData.get("file") as File | null;

  let resolvedFilePath: string | undefined;
  let fileContent: string | undefined;

  if (file) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmpDir = path.join(os.tmpdir(), "knowledge-platform");
    await mkdir(tmpDir, { recursive: true });
    resolvedFilePath = path.join(tmpDir, `${Date.now()}-${file.name}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(resolvedFilePath, buffer);
  }

  if (filePath) resolvedFilePath = filePath;
  if (content) fileContent = content;

  const db = await getDb();
  const service = createKnowledgeBaseService(db);

  try {
    // Directory import
    if (sourceType === "directory" && dirPath) {
      const docs = await service.importFromDirectory(id, dirPath);
      return NextResponse.json({ success: true, data: docs }, { status: 201 });
    }

    const doc = await service.importDocument(id, {
      title: title || "Untitled",
      sourceType: sourceType as "file" | "link" | "text",
      filePath: resolvedFilePath,
      content: fileContent,
      sourceUrl: sourceUrl ?? undefined,
    });
    return NextResponse.json({ success: true, data: doc }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: kbId } = await params;
  const docId = req.nextUrl.searchParams.get("docId");
  if (!docId) return NextResponse.json({ success: false, error: "docId required" }, { status: 400 });

  const db = await getDb();
  const service = createKnowledgeBaseService(db);
  service.deleteDocument(docId);
  return NextResponse.json({ success: true });
}
