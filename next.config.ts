import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "archiver", "unpdf", "mammoth", "docx", "pdfkit"],
};

export default nextConfig;
