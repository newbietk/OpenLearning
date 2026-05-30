import { getDb } from "@/lib/db/singleton";

export async function checkIsAdmin(externalId: string): Promise<boolean> {
  const admins = (process.env.PLATFORM_ADMINS || "").split(",").filter(Boolean);
  if (admins.includes(externalId)) return true;
  const db = await getDb();
  return !!db.platformAdmin.findByExternalId(externalId);
}

export function getExternalId(request: Request): string {
  return request.headers.get("x-external-user") || "anonymous";
}
