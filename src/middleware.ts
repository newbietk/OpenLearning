import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const externalUser = request.headers.get("x-external-user") || "anonymous";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-external-user", externalUser);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
