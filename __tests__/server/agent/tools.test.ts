import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./helpers";
import type { ToolContext, ToolExecution } from "@/server/agent/tools";

const NS = "http://example.org/pizza#";

let dataDir: string;
let app: AppLike;
let executeTool: (name: string, input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecution>;
let ctx: ToolContext;

async function run(name: string, input: Record<string, unknown> = {}) {
  const out = await executeTool(name, input, ctx);
  return { ...out, data: JSON.parse(out.content) };
}

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  executeTool = (await import("@/server/agent/tools")).executeTool;
  const projectId = await createPizzaProject(app);
  ctx = {
    projectId,
    branch: "main",
    request: (path, init) => Promise.resolve(app.request(path, init)),
    pollIntervalMs: 20,
    pollTimeoutMs: 20_000,
  };
}, 30_000);

afterAll(() => removeDir(dataDir));

describe("agent tools against a real project", () => {
  it("rejects invalid input before running the tool", async () => {
    const out = await run("get_entity", {});
    expect(out.is_error).toBe(true);
    expect(out.summary).toContain("iri is required");
    const bad = await run("create_entity", { entity_type: "widget", label: "X" });
    expect(bad.is_error).toBe(true);
    expect(bad.summary).toMatch(/entity_type must be one of/);
    const unknown = await run("no_such_tool", {});
    expect(unknown.is_error).toBe(true);
  });

  it("reads the project, tree, search and entities", async () => {
    const project = await run("get_project");
    expect(project.is_error).toBe(false);
    expect(project.data.name).toBe("Pizza");

    const tree = await run("get_class_tree");
    expect(tree.data.nodes.map((n: { label: string }) => n.label)).toEqual(["Food", "Topping"]);
    const children = await run("get_class_tree", { parent_iri: `${NS}Food` });
    expect(children.data.nodes.map((n: { iri: string }) => n.iri)).toEqual([`${NS}Pizza`]);

    const search = await run("search_entities", { query: "*", entity_types: ["property"] });
    expect(search.summary).toBe("Found 1 entity");
    expect(search.data.results[0].iri).toBe(`${NS}hasTopping`);

    const cls = await run("get_entity", { iri: `${NS}Pizza` });
    expect(cls.data.entity_type).toBe("class");
    expect(cls.data.detail.parent_iris).toEqual([`${NS}Food`]);
    expect(cls.data.turtle).toContain(":Pizza a owl:Class");

    const prop = await run("get_entity", { iri: `${NS}hasTopping` });
    expect(prop.data.entity_type).toBe("property");
    expect(prop.data.property_kind).toBe("object");
    expect(prop.data.detail.range_iris).toEqual([`${NS}Topping`]);

    const ind = await run("get_entity", { iri: `${NS}Mozzarella` });
    expect(ind.data.entity_type).toBe("individual");
    expect(ind.data.detail.type_iris).toEqual([`${NS}Topping`]);

    const missing = await run("get_entity", { iri: `${NS}Nope` });
    expect(missing.is_error).toBe(true);
    expect(missing.summary).toContain("Entity not found");

    const source = await run("get_source");
    expect(source.data.content).toContain(":Mozzarella");
  });

  it("create_entity generates unique IRIs in the default namespace", async () => {
    const first = await run("create_entity", {
      entity_type: "class",
      label: "Margherita Pizza",
      parent_iri: `${NS}Pizza`,
      comment: 'Tomato, "mozzarella" and basil',
    });
    expect(first.is_error).toBe(false);
    expect(first.mutated).toBe(true);
    expect(first.summary).toBe("Created class Margherita Pizza");
    expect(first.data.iri).toBe(`${NS}MargheritaPizza`);

    const detail = await run("get_entity", { iri: `${NS}MargheritaPizza` });
    expect(detail.data.detail.parent_iris).toEqual([`${NS}Pizza`]);
    expect(detail.data.detail.comments).toEqual([{ value: 'Tomato, "mozzarella" and basil', lang: "en" }]);

    const second = await run("create_entity", { entity_type: "class", label: "Margherita Pizza" });
    expect(second.data.iri).toBe(`${NS}MargheritaPizza2`);

    const ind = await run("create_entity", { entity_type: "individual", label: "Basil", parent_iri: `${NS}Topping` });
    expect(ind.data.iri).toBe(`${NS}Basil`);
    const basil = await run("get_entity", { iri: `${NS}Basil` });
    expect(basil.data.entity_type).toBe("individual");

    const dup = await run("create_entity", { entity_type: "class", label: "Again", iri: `${NS}Pizza` });
    expect(dup.is_error).toBe(true);
    expect(dup.mutated).toBe(false);
  });

  it("update_class merges only the provided fields", async () => {
    const out = await run("update_class", {
      iri: `${NS}Pizza`,
      labels: [{ value: "Pizza pie", lang: "en" }],
      commit_message: "Rename Pizza",
    });
    expect(out.is_error).toBe(false);
    expect(out.mutated).toBe(true);
    expect(out.data.updated_fields).toEqual(["labels"]);

    const after = await run("get_entity", { iri: `${NS}Pizza` });
    expect(after.data.detail.labels).toEqual([{ value: "Pizza pie", lang: "en" }]);
    expect(after.data.detail.comments).toEqual([{ value: "A baked dish", lang: "en" }]);
    expect(after.data.detail.parent_iris).toEqual([`${NS}Food`]);

    const revs = await run("list_revisions", { limit: 1 });
    expect(revs.data.commits[0].message).toBe("Rename Pizza");

    const deprecate = await run("update_class", { iri: `${NS}Pizza`, deprecated: true });
    expect(deprecate.is_error).toBe(false);
    const again = await run("get_entity", { iri: `${NS}Pizza` });
    expect(again.data.detail.deprecated).toBe(true);
    expect(again.data.detail.labels).toEqual([{ value: "Pizza pie", lang: "en" }]);
  });

  it("update_property and update_individual keep omitted fields", async () => {
    const prop = await run("update_property", { iri: `${NS}hasTopping`, domain_iris: [`${NS}Pizza`] });
    expect(prop.is_error).toBe(false);
    const p = await run("get_entity", { iri: `${NS}hasTopping` });
    expect(p.data.detail.domain_iris).toEqual([`${NS}Pizza`]);
    expect(p.data.detail.range_iris).toEqual([`${NS}Topping`]);
    expect(p.data.detail.labels).toEqual([{ value: "has topping", lang: "en" }]);

    const ind = await run("update_individual", {
      iri: `${NS}Mozzarella`,
      comments: [{ value: "Soft cheese" }],
    });
    expect(ind.is_error).toBe(false);
    const i = await run("get_entity", { iri: `${NS}Mozzarella` });
    expect(i.data.detail.comments).toEqual([{ value: "Soft cheese", lang: "en" }]);
    expect(i.data.detail.type_iris).toEqual([`${NS}Topping`]);
    expect(i.data.detail.labels).toEqual([{ value: "Mozzarella", lang: "en" }]);
  });

  it("delete_entity removes properties and individuals via the generic route", async () => {
    const classRoute = await app.request(
      `/api/v1/projects/${ctx.projectId}/ontology/classes/${encodeURIComponent(`${NS}Basil`)}?branch=main`,
      { method: "DELETE" },
    );
    expect(classRoute.status).toBe(404);

    const out = await run("delete_entity", { iri: `${NS}Basil` });
    expect(out.is_error).toBe(false);
    expect(out.mutated).toBe(true);
    const gone = await run("get_entity", { iri: `${NS}Basil` });
    expect(gone.is_error).toBe(true);

    const prop = await run("delete_entity", { iri: `${NS}hasTopping`, commit_message: "Drop hasTopping" });
    expect(prop.is_error).toBe(false);
    const source = await run("get_source");
    expect(source.data.content).not.toContain("hasTopping");
    const revs = await run("list_revisions", { limit: 1 });
    expect(revs.data.commits[0].message).toBe("Drop hasTopping");

    const missing = await run("delete_entity", { iri: `${NS}DoesNotExist` });
    expect(missing.is_error).toBe(true);
    expect(missing.summary).toContain("Entity not found");
    expect(missing.summary).toContain("HTTP 404");
  });

  it("class delete route still works through the shared helper", async () => {
    const res = await app.request(
      `/api/v1/projects/${ctx.projectId}/ontology/classes/${encodeURIComponent(`${NS}MargheritaPizza2`)}?branch=main`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);
    const gone = await run("get_entity", { iri: `${NS}MargheritaPizza2` });
    expect(gone.is_error).toBe(true);
  });

  it("edit_source requires a unique match and replace_source validates Turtle", async () => {
    const ambiguous = await run("edit_source", { old_text: "owl:Class", new_text: "rdfs:Class", commit_message: "x" });
    expect(ambiguous.is_error).toBe(true);
    expect(ambiguous.summary).toMatch(/occurs \d+ times/);

    const missing = await run("edit_source", { old_text: "zzz-not-there", new_text: "", commit_message: "x" });
    expect(missing.is_error).toBe(true);

    const ok = await run("edit_source", {
      old_text: '"Food"@en',
      new_text: '"Food"@en, "Nourriture"@fr',
      commit_message: "Add French label to Food",
    });
    expect(ok.is_error).toBe(false);
    expect(ok.mutated).toBe(true);

    const bad = await run("replace_source", { content: "this is not turtle", commit_message: "Break" });
    expect(bad.is_error).toBe(true);
    expect(bad.summary).toContain("Invalid Turtle");
  });

  it("runs async health jobs to completion", async () => {
    const lint = await run("run_lint");
    expect(lint.is_error).toBe(false);
    expect(typeof lint.data.total_issues).toBe("number");
    expect(Array.isArray(lint.data.issues)).toBe(true);

    const issues = await run("get_lint_issues", { limit: 5 });
    expect(issues.is_error).toBe(false);

    const rules = await run("list_lint_rules");
    expect(rules.data.rules.length).toBeGreaterThan(0);

    const cfg = await run("update_lint_config", { lint_level: 2 });
    expect(cfg.is_error).toBe(false);
    expect(cfg.mutated).toBe(true);
    expect((await run("get_lint_config")).data.lint_level).toBe(2);

    const consistency = await run("run_consistency_check");
    expect(consistency.is_error).toBe(false);
    expect(Array.isArray(consistency.data.issues)).toBe(true);

    const dups = await run("find_duplicates", { threshold: 0.9 });
    expect(dups.is_error).toBe(false);
    expect(Array.isArray(dups.data.clusters)).toBe(true);

    const status = await run("get_normalization_status");
    expect(status.is_error).toBe(false);
    const preview = await run("normalize", { dry_run: true });
    expect(preview.is_error).toBe(false);
    expect(preview.mutated).toBe(false);
    expect(preview.data.original_content).toBeUndefined();
  }, 60_000);

  it("manages branches and pull requests", async () => {
    const branch = await run("create_branch", { name: "feature/agent" });
    expect(branch.is_error).toBe(false);
    expect(branch.mutated).toBe(true);

    const list = await run("list_branches");
    expect(list.data.branches.map((b: { name: string }) => b.name)).toContain("feature/agent");

    const featureCtx = { ...ctx, branch: "feature/agent" };
    const created = await executeTool("create_entity", { entity_type: "class", label: "Calzone" }, featureCtx);
    expect(created.is_error).toBe(false);

    const pr = await run("create_pull_request", { title: "Add Calzone", source_branch: "feature/agent" });
    expect(pr.is_error).toBe(false);
    expect(pr.data.number).toBe(1);
    expect(pr.data.target_branch).toBe("main");

    const comment = await run("comment_on_pull_request", { number: 1, body: "Looks good" });
    expect(comment.is_error).toBe(false);

    const got = await run("get_pull_request", { number: 1 });
    expect(got.data.title).toBe("Add Calzone");
    expect(JSON.stringify(got.data.comments)).toContain("Looks good");

    const prs = await run("list_pull_requests", { status: "open" });
    expect(prs.data.pull_requests).toHaveLength(1);

    const merged = await run("merge_pull_request", { number: 1 });
    expect(merged.is_error).toBe(false);
    const calzone = await run("search_entities", { query: "Calzone" });
    expect(calzone.data.total).toBe(1);

    const closeMerged = await run("close_pull_request", { number: 1 });
    expect(closeMerged.is_error).toBe(true);

    const renamed = await run("update_project", { name: "Pizza Deluxe" });
    expect(renamed.is_error).toBe(false);
    expect(renamed.mutated).toBe(true);
  }, 30_000);
});
