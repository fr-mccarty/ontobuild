import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup/storage.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts", "components/**/*.tsx"],
      exclude: [
        "lib/ontology/types.ts",
        "lib/graph/types.ts",
        "lib/git-graph/types.ts",
        "lib/editor/index.ts",
        "lib/git-graph/index.ts",
        "lib/context/index.ts",
        "components/editor/index.ts",
        "lib/editor/indexWorker.ts",
        "lib/editor/lsp-client.ts",
        "components/icons/github.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
