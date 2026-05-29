import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/singleton";
import { createLlmConfigService } from "@/modules/llm-config/service";
import { getExternalId } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const externalId = getExternalId(req);
  const db = await getDb();
  const service = createLlmConfigService(db);
  const providers = service.listProviders(externalId);
  // Return without apiKeyEncrypted for safety
  const safe = providers.map((p) => ({
    ...p,
    apiKeyEncrypted: undefined,
    hasKey: !!p.apiKeyEncrypted,
  }));
  return NextResponse.json({ success: true, data: safe });
}

export async function POST(req: NextRequest) {
  const externalId = getExternalId(req);
  const body = await req.json();
  const db = await getDb();
  const service = createLlmConfigService(db);
  const provider = service.addProvider({
    externalUserId: externalId,
    provider: body.provider,
    apiKey: body.apiKey,
    baseUrl: body.baseUrl ?? null,
  });
  return NextResponse.json(
    { success: true, data: { ...provider, apiKeyEncrypted: undefined, hasKey: true } },
    { status: 201 },
  );
}
