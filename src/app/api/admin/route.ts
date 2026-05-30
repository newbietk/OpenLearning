import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createAdminService } from "@/modules/admin/service";
import { getExternalId, checkIsAdmin } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  const db = await getDb();
  const service = createAdminService(db);

  if (!isAdmin) {
    return NextResponse.json({ success: true, data: { isAdmin: false } });
  }

  const stats = service.getStats();
  const admins = service.listAdmins();
  return NextResponse.json({ success: true, data: { isAdmin: true, admins, stats } });
}

export async function POST(req: NextRequest) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const db = await getDb();
  const service = createAdminService(db);
  const admin = service.addAdmin(body.externalId);
  return NextResponse.json({ success: true, data: admin }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const externalId = getExternalId(req);
  const isAdmin = await checkIsAdmin(externalId);
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const targetId = url.searchParams.get("externalId");
  if (!targetId) {
    return NextResponse.json({ success: false, error: "externalId is required" }, { status: 400 });
  }

  const db = await getDb();
  const service = createAdminService(db);

  try {
    service.removeAdmin(targetId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
