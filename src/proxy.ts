import { NextResponse, type NextRequest } from "next/server";

// A password gate for the whole app.
//
// v1 has no accounts, and server actions are reachable by direct POST — including
// clearAllData. On a public URL that means anyone who finds it can read the data
// or wipe it. This isn't authentication (that's Phase 2); it's a single shared
// password that turns "anyone" into "anyone with the password", and it covers
// server action POSTs as well as pages because it runs before routing.
//
// In Next.js 16 this file is `proxy.ts` — Middleware was renamed to Proxy.
//
// This file is meant to be DELETED once Phase 2 ships real accounts — it would
// then guard nothing while still demanding a password in front of the login
// page. See "Last step of Phase 2" in docs/scope.md for the removal checklist,
// and for the one thing that must survive it: the auth check has to move to the
// top of each server action, because those are POST-able without ever loading a
// page.

const REALM = 'Basic realm="TV Tracker", charset="UTF-8"';

/**
 * Length-independent comparison, so a wrong password can't be narrowed down by
 * how long the check takes. Cheap enough to be worth doing properly.
 */
function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  // No password set: fine locally, but a deployed app without one would be
  // wide open. Fail closed and say why, rather than silently serving it —
  // and don't send WWW-Authenticate, since no password could ever work.
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(
        "APP_PASSWORD is not set on this deployment, so the app is refusing " +
          "to serve. Set it in the project's environment variables.",
        { status: 503 },
      );
    }

    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  // Only the password matters; the username can be anything, so browsers that
  // insist on both fields still work.
  const supplied = decoded.slice(decoded.indexOf(":") + 1);

  return matches(supplied, password) ? NextResponse.next() : unauthorized();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api/cron/*  — Vercel Cron sends its own `Authorization: Bearer
     *    $CRON_SECRET` header, which this gate would reject, stopping the
     *    twice-daily refresh from ever running. That route authenticates
     *    itself.
     *  - /_next/static and /favicon.ico — no data in them, and keeping them
     *    open avoids a redundant challenge on every asset.
     */
    "/((?!api/cron|_next/static|favicon.ico).*)",
  ],
};
