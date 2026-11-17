// @vitest-environment node
// Pure analysis only. The API test is in routes.test.ts: importing the server
// here would open the real data directory before a temp one can be set.
import { describe, expect, it } from "vitest";
import { buildTreeFromSources, isSourceFile, type ComponentNode } from "@/server/tools/componentTree";

const src = (files: Record<string, string>) => Object.entries(files).map(([path, content]) => ({ path, content }));

function tree(files: Record<string, string>, configs: Record<string, string> = {}) {
  const t = buildTreeFromSources(src(files), src(configs));
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const childNames = (id: string) => (byId.get(id)?.children ?? []).map((c) => byId.get(c.id)!.name);
  return { ...t, byId, childNames };
}

describe("component tree analysis", () => {
  it("follows default and named imports from an entry module", () => {
    const t = tree({
      "code/src/main.tsx": `import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);`,
      "code/src/App.tsx": `import { Header } from "./Header";\nexport default function App() { return <div><Header /><Header /></div>; }`,
      "code/src/Header.tsx": `export const Header = () => <header>hi</header>;`,
    });
    expect(t.roots).toEqual(["code/src/main.tsx#(module)"]);
    expect(t.byId.get("code/src/main.tsx#(module)")!.kind).toBe("module");
    expect(t.childNames("code/src/main.tsx#(module)")).toEqual(["App"]);
    expect(t.childNames("code/src/App.tsx#App")).toEqual(["Header"]);
    expect(t.byId.get("code/src/App.tsx#App")!.children[0]).toMatchObject({ count: 2, line: 2 });
    expect(t.byId.get("code/src/Header.tsx#Header")).toMatchObject({ exported: true, line: 1 });
  });

  it("resolves barrels, namespace imports, aliases, memo/forwardRef and lazy", () => {
    const t = tree(
      {
        "code/app/page.tsx": [
          `import { lazy } from "react";`,
          `import * as UI from "@/components/ui";`,
          `import { Card } from "@/components/ui";`,
          `import dynamic from "next/dynamic";`,
          `const Chart = lazy(() => import("../components/Chart"));`,
          `const Map = dynamic(() => import("../components/Map").then((m) => m.WorldMap), { ssr: false });`,
          `export default function Page() { return <UI.Button><Card /><Chart /><Map /></UI.Button>; }`,
        ].join("\n"),
        "code/components/ui/index.ts": `export * from "./Button";\nexport { default as Card } from "./Card";`,
        "code/components/ui/Button.tsx": `import { forwardRef } from "react";\nexport const Button = forwardRef((p, ref) => <button ref={ref} />);`,
        "code/components/ui/Card.tsx": `import { memo } from "react";\nfunction Card() { return <div />; }\nexport default memo(Card);`,
        "code/components/Chart.jsx": `export default () => <svg />;`,
        "code/components/Map.tsx": `export function WorldMap() { return <canvas />; }`,
      },
      { "code/tsconfig.json": `{ // comments are fine\n "compilerOptions": { "paths": { "@/*": ["./*"] } } }` },
    );
    expect(t.roots).toEqual(["code/app/page.tsx#Page"]);
    expect(t.byId.get("code/app/page.tsx#Page")!.children.map((c) => c.id)).toEqual([
      "code/components/ui/Button.tsx#Button",
      "code/components/ui/Card.tsx#Card",
      "code/components/Chart.jsx#Chart",
      "code/components/Map.tsx#WorldMap",
    ]);
  });

  it("marks package components external and unresolvable tags unknown", () => {
    const t = tree({
      "code/App.tsx": `import { Link } from "react-router-dom";\nimport { Fragment } from "react";\nexport function App({ Icon }) { return <Fragment><Link /><Icon /></Fragment>; }`,
    });
    const kids = t.byId.get("code/App.tsx#App")!.children.map((c) => t.byId.get(c.id)!) as ComponentNode[];
    expect(kids.map((k) => [k.name, k.kind, k.source])).toEqual([
      ["Link", "external", "react-router-dom"],
      ["Icon", "unknown", null],
    ]);
  });

  it("ignores lowercase helpers and constants, and roots unreachable cycles", () => {
    const t = tree({
      "code/a.tsx": `import { B } from "./b";\nexport function A() { return <B />; }\nconst ROUTES = 1;\nfunction helper() { return 1; }`,
      "code/b.tsx": `import { A } from "./a";\nexport function B() { return <A />; }`,
    });
    expect(t.nodes.filter((n) => n.kind === "component").map((n) => n.name)).toEqual(["A", "B"]);
    expect(t.roots).toEqual(["code/a.tsx#A"]);
  });

  it("finds class components and resolves ESM .js specifiers", () => {
    const t = tree({
      "code/Old.tsx": `import { New } from "./New.js";\nexport default class Old extends React.Component { render() { return <New />; } }`,
      "code/New.tsx": `export function New() { return <p />; }`,
    });
    expect(t.childNames("code/Old.tsx#Old")).toEqual(["New"]);
  });

  it("skips tests, stories and declaration files", () => {
    expect(isSourceFile("code/src/App.tsx")).toBe(true);
    expect(isSourceFile("code/src/App.test.tsx")).toBe(false);
    expect(isSourceFile("code/src/App.stories.tsx")).toBe(false);
    expect(isSourceFile("code/src/types.d.ts")).toBe(false);
    expect(isSourceFile("code/__tests__/x.tsx")).toBe(false);
    expect(isSourceFile("code/app.py")).toBe(false);
  });
});
