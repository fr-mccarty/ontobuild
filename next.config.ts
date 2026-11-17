import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["jsonld", "rdfxml-streaming-parser", "n3", "node-pty"],
};

export default nextConfig;
