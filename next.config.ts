import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
