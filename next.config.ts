import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // CSS masks need same-origin (or CORS-enabled) images; the demo CDN sends no CORS headers.
  async rewrites() {
    return [{ source: "/rail-assets/:path*", destination: "https://cdn.21st.dev/assets/:path*" }];
  },
};

export default nextConfig;
