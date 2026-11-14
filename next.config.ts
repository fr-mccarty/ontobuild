import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Server-only packages that should be required at runtime rather than bundled.
  serverExternalPackages: ["jsonld", "rdfxml-streaming-parser", "n3"],
};

export default withNextIntl(nextConfig);
