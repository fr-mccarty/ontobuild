// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "../agent/helpers";

// The server is imported only after useTempDataDir() points it at a temp folder.
describe("tools API", () => {
  let dataDir: string;
  let app: AppLike;
  let projectId: string;

  beforeAll(async () => {
    dataDir = useTempDataDir();
    app = (await import("@/server/app")).default;
    projectId = await createPizzaProject(app);
  }, 30_000);

  afterAll(() => removeDir(dataDir));

  const put = (path: string, content: string) =>
    app.request(`/api/v1/projects/${projectId}/files/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });

  it("scans the project's code/ folder", async () => {
    expect((await put("code/src/App.tsx", `import { Nav } from "./Nav";\nexport default function App() { return <Nav />; }`)).status).toBe(200);
    expect((await put("code/src/Nav.tsx", `export function Nav() { return <nav />; }`)).status).toBe(200);
    expect((await put("code/src/App.test.tsx", `import App from "./App";\nit("x", () => <App />);`)).status).toBe(200);
    const res = await app.request(`/api/v1/projects/${projectId}/tools/component-tree`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roots: string[]; files_scanned: number; truncated: boolean };
    expect(body).toMatchObject({ roots: ["code/src/App.tsx#App"], files_scanned: 2, truncated: false });
  });

  it("finds orphans in the project's code/ folder", async () => {
    expect((await put("code/src/main.tsx", `import App from "./App";\nconsole.log(App);`)).status).toBe(200);
    expect((await put("code/src/Old.tsx", `export function Old() { return <p />; }`)).status).toBe(200);
    expect((await put("code/src/Nav.tsx", `export function Nav() { return <nav />; }\nexport const unused = 1;`)).status).toBe(200);
    const res = await app.request(`/api/v1/projects/${projectId}/tools/orphans`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { category: string; name: string }[]; entry_points: string[] };
    expect(body.entry_points).toEqual(["code/src/main.tsx"]);
    expect(body.items.map((i) => `${i.category} ${i.name}`)).toEqual(["file Old.tsx", "variable unused"]);
  });

  it("returns 404 for an unknown project", async () => {
    expect((await app.request(`/api/v1/projects/nope/tools/component-tree`)).status).toBe(404);
    expect((await app.request(`/api/v1/projects/nope/tools/orphans`)).status).toBe(404);
  });
});
