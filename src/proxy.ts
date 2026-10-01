import { NextResponse, type NextRequest } from "next/server";

// Per-request Content-Security-Policy, because `script-src` needs a nonce.
//
// Next's inline bootstrap scripts can't be allow-listed by URL, and
// `'unsafe-inline'` would make the policy decorative. A fresh nonce on every
// request is what lets the policy say "only scripts this response carries".
// Next reads the nonce back off the *request's* CSP header and stamps it on its
// own scripts, which is why the header is set on both sides below. That only
// works for dynamically rendered pages — every page here is `force-dynamic`.
//
// This is NOT an auth gate and must not become one: the session checks live in
// the pages and actions (see `app/actions.ts`). The matcher exists only to keep
// static assets and the service worker out of the nonce path.

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  const policy = [
    "default-src 'self'",
    // `strict-dynamic` lets nonce'd scripts load their own chunks without each
    // one being listed. Dev needs `eval` for React's debugging tooling.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline styles stay allowed: Next and the font loader emit them, and a
    // style nonce buys little against an app with no user-supplied markup.
    "style-src 'self' 'unsafe-inline'",
    // Posters and thumbnails go through /_next/image, so they are same-origin.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // The trailer embed. See the note on the Trailer component.
    "frame-src https://www.youtube-nocookie.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);

  return response;
}

export const config = {
  matcher: [
    {
      // Static output, icons and the worker carry no scripts of their own.
      source: "/((?!_next/static|_next/image|favicon.ico|sw.js|icon-.*\\.png|apple-touch-icon.png|manifest.json).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
