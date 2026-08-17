import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  // Ships a native (.node) binary per platform, resolved via Node's own
  // require at runtime — bundling it (Next.js's default for server
  // dependencies) breaks that resolution entirely.
  serverExternalPackages: ["@resvg/resvg-js"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

export default nextConfig;
