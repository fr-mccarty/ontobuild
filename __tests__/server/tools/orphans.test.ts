// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findOrphans } from "@/server/tools/orphans";
import { isCodeFile } from "@/server/tools/codebase";

/** Runs the analysis on an in-memory code/ folder; returns "category name: reason" lines. */
function orphans(files: Record<string, string>) {
  const all = Object.keys(files);
  const report = findOrphans({
    sources: all.filter(isCodeFile).map((path) => ({ path, content: files[path] })),
    configs: all.filter((p) => /(ts|js)config\.json$/.test(p)).map((path) => ({ path, content: files[path] })),
    allFiles: all,
    read: (p) => files[p] ?? null,
  });
  return { ...report, lines: report.items.map((i) => `${i.category} ${i.name}: ${i.reason}`) };
}

const VITE_APP = {
  "code/package.json": JSON.stringify({ scripts: { dev: "vite", seed: "node scripts/seed.js", gone: "tsx scripts/missing.ts" } }),
  "code/index.html": `<div id="root"></div><script type="module" src="/src/main.tsx"></script>`,
  "code/src/main.tsx": `import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\ncreateRoot(document.body).render(<App />);`,
  "code/src/index.css": `body { margin: 0 }`,
  "code/src/old.css": `.x {}`,
  "code/src/App.tsx": [
    `import { Button, formatDate } from "./ui";`,
    `import type { Props } from "./types";`,
    `const LIMIT = 3;`,
    `const unusedConst = 4;`,
    `function helper() { return LIMIT; }`,
    `function Unused() { return <p />; }`,
    `class Store {}`,
    `export default function App(p: Props) { return <Button onClick={helper}>{formatDate()}</Button>; }`,
  ].join("\n"),
  "code/src/ui/index.ts": `export * from "./Button";\nexport { formatDate, formatTime } from "./format";`,
  "code/src/ui/Button.tsx": `export function Button(props) { return <button {...props} />; }\nexport function IconButton() { return <button />; }`,
  "code/src/ui/format.ts": `export const formatDate = () => "";\nexport const formatTime = () => "";\nexport function onlyTested() {}`,
  "code/src/types.ts": `export interface Props { a: number }\nexport type Unused = string;\nexport enum Color { Red }`,
  "code/src/legacy/Widget.tsx": `import { helper2 } from "./helper2";\nexport function Widget() { return <div>{helper2()}</div>; }`,
  "code/src/legacy/helper2.ts": `export const helper2 = () => 1;`,
  "code/src/testOnly.ts": `export const fixture = 1;`,
  "code/src/format.test.ts": `import { onlyTested } from "./ui/format";\nimport { fixture } from "./testOnly";\nit("x", () => onlyTested(fixture));`,
  "code/src/broken.test.ts": `import { removed } from "./ui/format";\nimport { x } from "./nope";\nit("x", () => removed(x));`,
  "code/src/empty.test.ts": `it("adds", () => expect(1 + 1).toBe(2));`,
  "code/__tests__/helpers/render.ts": `export const render = () => null;`,
  "code/__tests__/helpers/unusedMock.ts": `export const mock = () => null;`,
  "code/__tests__/setup.ts": `globalThis.x = 1;`,
  "code/__tests__/App.test.tsx": `import { render } from "./helpers/render";\nimport App from "../src/App";\nit("renders", () => render(<App />));`,
  "code/vitest.config.ts": `export default { test: { setupFiles: ["./__tests__/setup.ts"] } };`,
  "code/e2e/home.spec.ts": `import { test } from "@playwright/test";\ntest("home", async () => {});`,
  "code/scripts/seed.js": `console.log("seed")`,
  "code/scripts/cleanup.sh": `rm -rf tmp`,
  "code/scripts/documented.sh": `echo hi`,
  "code/README.md": "Run `scripts/documented.sh` to say hi.",
  "code/vite.config.ts": `export default {};`,
};

describe("orphan analysis", () => {
  it("finds entry points from index.html, package.json scripts and config files", () => {
    expect(orphans(VITE_APP).entry_points).toEqual([
      "code/__tests__/setup.ts",
      "code/scripts/seed.js",
      "code/src/main.tsx",
      "code/vite.config.ts",
      "code/vitest.config.ts",
    ]);
  });

  it("reports unreachable files, test-only files and unused stylesheets", () => {
    const { lines } = orphans(VITE_APP);
    expect(lines.filter((l) => l.startsWith("file "))).toEqual([
      "file helper2.ts: Only imported by files that are unused themselves (Widget.tsx)",
      "file Widget.tsx: Nothing imports it",
      "file old.css: Nothing imports or links it",
      "file testOnly.ts: Only used by tests or stories",
    ]);
  });

  it("reports unused declarations by kind, through barrels and type imports", () => {
    const { lines } = orphans(VITE_APP);
    expect(lines.filter((l) => /^(component|class|function|variable|type) /.test(l))).toEqual([
      "component Unused: Declared, but never used",
      "component IconButton: Exported, but nothing imports it",
      "class Store: Declared, but never used",
      "function formatTime: Exported, but nothing imports it",
      "function onlyTested: Only used by tests or stories",
      "variable unusedConst: Declared, but never used",
      "type Unused: Exported, but nothing imports it",
      "type Color: Exported, but nothing imports it",
    ]);
  });

  it("reports tests that import missing code or none at all, but not e2e tests", () => {
    const { lines } = orphans(VITE_APP);
    expect(lines.filter((l) => l.startsWith("test "))).toEqual([
      "test unusedMock.ts: Test helper that no test imports",
      "test broken.test.ts: Imports removed from ./ui/format, which no longer exports it (and 1 more problem)",
      "test empty.test.ts: Doesn't import any code from the project",
    ]);
  });

  it("reports npm scripts that run missing files and scripts nothing mentions", () => {
    const { lines } = orphans(VITE_APP);
    expect(lines.filter((l) => l.startsWith("script "))).toEqual([
      "script npm run gone: Runs scripts/missing.ts, which doesn't exist",
      "script cleanup.sh: Nothing runs it: not mentioned in package.json, a Makefile, CI, docs or other scripts",
    ]);
  });

  it("treats Next.js app files as entry points and their exports as used", () => {
    const { lines, entry_points } = orphans({
      "code/package.json": "{}",
      "code/tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }`,
      "code/app/layout.tsx": `export const metadata = {};\nexport default function RootLayout({ children }) { return <html>{children}</html>; }`,
      "code/app/blog/[slug]/page.tsx": `import * as Lib from "@/lib/posts";\nexport async function generateStaticParams() { return Lib.allSlugs(); }\nexport default function Page() { return <p />; }`,
      "code/lib/posts.ts": `export const allSlugs = () => [];\nexport const draftSlugs = () => [];`,
      "code/middleware.ts": `export function middleware() {}`,
    });
    expect(entry_points).toEqual(["code/app/blog/[slug]/page.tsx", "code/app/layout.tsx", "code/middleware.ts"]);
    expect(lines).toEqual(["function draftSlugs: Exported, but nothing imports it"]);
  });

  it("counts dynamic imports, require and workers as use", () => {
    const { lines } = orphans({
      "code/src/index.ts": `const m = await import("./lazy");\nconst c = require("./common");\nnew Worker(new URL("./worker.ts", import.meta.url));\nconsole.log(m, c);`,
      "code/src/lazy.ts": `export const a = 1;`,
      "code/src/common.js": `module.exports = {};`,
      "code/src/worker.ts": `self.onmessage = () => {};`,
    });
    expect(lines).toEqual([]);
  });

  it("falls back to 'nothing imports it' without entry points", () => {
    const { lines, entry_points } = orphans({
      "code/lib/a.ts": `import { b } from "./b";\nexport const a = b;`,
      "code/lib/b.ts": `export const b = 1;`,
    });
    expect(entry_points).toEqual([]);
    expect(lines).toEqual(["file a.ts: Nothing imports it"]);
  });
});
