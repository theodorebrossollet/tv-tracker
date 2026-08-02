import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Baseline for every route. Entries below this one may override
        // individual keys — see /sw.js.
        source: "/(.*)",
        headers: [
          // Nothing here is meant to be embedded anywhere, and framing is the
          // one hole SameSite=Lax doesn't cover: a framed page carries the
          // cookie, and a click inside it is same-origin. The concrete target
          // is the Danger Zone, where two clicks wipe an account.
          //
          // Only `frame-ancestors` — a real `script-src` policy needs a nonce
          // for Next's inline bootstrap and is a separate job. X-Frame-Options
          // is the same rule for browsers that predate CSP.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Two years, subdomains included. No `preload`: that ships to a list
          // baked into browsers and is painful to undo.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // Nothing here asks for any of these, so refuse them outright.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Never let the worker itself be cached. A stale service worker is how
        // people get permanently stuck on an old build: it is the thing that
        // decides what everything else serves, so it must always be re-fetched.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          // Matching entries do NOT stack per header key — the last one to set
          // a key wins, so this has to restate `frame-ancestors` rather than
          // inherit it. Verified against a built server, because the opposite
          // assumption silently dropped the worker's own policy: the response
          // still carried a Content-Security-Policy, just the wrong one.
          // Hence also the position, below the catch-all rather than above it.
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
  images: {
    // Posters are served straight from TMDB's CDN.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
      {
        // Trailer thumbnails. Fetched server-side by next/image, so the
        // visitor's browser never contacts YouTube for them — see the note on
        // the Trailer component before changing how these are rendered.
        protocol: "https",
        hostname: "i.ytimg.com",
        pathname: "/vi/**",
      },
    ],
  },
};

export default nextConfig;
