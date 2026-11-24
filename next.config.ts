import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["jsonld", "rdfxml-streaming-parser", "n3", "node-pty", "rdf-validate-shacl"],
};

export default nextConfig;
