import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createAdminService } from "@/modules/admin/service";
import { getExternalId, checkIsAdmin } from "@/lib/api-utils";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const db = await getDb();
  const service = createAdminService(db);
  const kb = service.updatePublicKb(id, body);
  return NextResponse.json({ success: true, data: kb });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const db = await getDb();
  const service = createAdminService(db);
  service.deletePublicKb(id);
  return NextResponse.json({ success: true });
}
