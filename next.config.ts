import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js and the MongoDB driver are Node libraries; load them with native require on the server.
  serverExternalPackages: ["pdfjs-dist", "mongoose", "mongodb", "csv-parse"],
  poweredByHeader: false,
  experimental: {
    // DLD CSV uploads go through a server action; keep in step with MAX_UPLOAD_MB (default 200).
    serverActions: { bodySizeLimit: "200mb" },
  },
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
};

export default nextConfig;
