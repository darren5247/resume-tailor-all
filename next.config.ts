import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "archiver", "unpdf", "mammoth", "docx", "pdfkit"],
  // Runtime packets live in gitignored folders; do not pack them into the server trace.
  outputFileTracingExcludes: {
    "*": ["./output/**", "./data/**"],
  },
  // Runtime output/data dirs are intentionally unbounded; NFT still flags them.
  turbopack: {
    ignoreIssue: [
      {
        path: "**/next.config.ts",
        description: /unexpected file in NFT list/i,
      },
    ],
  },
};

export default nextConfig;
