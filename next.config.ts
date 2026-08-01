import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Never let the worker itself be cached. A stale service worker is how
        // people get permanently stuck on an old build: it is the thing that
        // decides what everything else serves, so it must always be re-fetched.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
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
