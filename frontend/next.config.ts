import type { NextConfig } from "next";

// FastAPI serves this static export on Render, alongside /api on the same origin.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
