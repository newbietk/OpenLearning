import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createAdminService } from "@/modules/admin/service";
import { getExternalId, checkIsAdmin } from "@/lib/api-utils";

export async function POST(req: NextRequest) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const db = await getDb();
  const service = createAdminService(db);
  const kb = service.createPublicKb({
    ownerId: externalId,
    name: body.name,
    description: body.description || "",
  });
  return NextResponse.json({ success: true, data: kb }, { status: 201 });
}
