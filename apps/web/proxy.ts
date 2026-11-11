import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/jwt";

const PROTECTED_PREFIXES = ["/dashboard", "/workspace"];
const AUTH_PREFIXES = ["/login", "/register"];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token ?? "");

  if (matchesPrefix(pathname, PROTECTED_PREFIXES) && !session) {
    const target = new URL("/login", request.url);
    target.searchParams.set("from", pathname);
    return NextResponse.redirect(target);
  }

  if (matchesPrefix(pathname, AUTH_PREFIXES) && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.glb$).*)"],
};
