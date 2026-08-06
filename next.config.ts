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
          // X-Frame-Options is the same rule for browsers that predate CSP.
          //
          // Still no `script-src`: that one genuinely needs a nonce for Next's
          // inline bootstrap and is a separate job. The other three below do
          // not, which is why they are here and it isn't —
          //
          //   base-uri     without a script-src, an injected <base> silently
          //                retargets every relative script URL on the page.
          //                Nothing else in this policy would stop it.
          //   object-src   kills <object>/<embed>, a script-execution vector
          //                this app has no use for.
          //   form-action  bounds where the login and onboarding forms can
          //                post, so an injected form can't exfiltrate a
          //                password to another origin.
          //
          // None of them can break a build and all survive the script-src work
          // unchanged. When that lands, note the trailer needs
          // `frame-src https://www.youtube-nocookie.com` the moment a
          // `default-src` appears.
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
          },
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
          // a key wins, so this has to restate the whole policy rather than
          // inherit any of it. Verified against a built server, because the
          // opposite assumption silently dropped the worker's own policy: the
          // response still carried a Content-Security-Policy, just the wrong
          // one. Hence also the position, below the catch-all rather than above
          // it. Anything added to the catch-all above has to be repeated here.
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
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
