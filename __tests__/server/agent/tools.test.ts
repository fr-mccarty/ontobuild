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
    expect(detail.data.detail.comments).toEqual([{ value: 'Tomato, "mozzarella" and basil' }]);

    const second = await run("create_entity", { entity_type: "class", label: "Margherita Pizza" });
    expect(second.data.iri).toBe(`${NS}MargheritaPizza2`);

    const ind = await run("create_entity", { entity_type: "individual", label: "Basil", parent_iri: `${NS}Topping` });
    expect(ind.data.iri).toBe(`${NS}Basil`);
    const basil = await run("get_entity", { iri: `${NS}Basil` });
    expect(basil.data.entity_type).toBe("individual");

    const written = (await run("get_source")).data.content as string;
    expect(written).toContain(":MargheritaPizza a owl:Class ;");
    expect(written).toContain("rdfs:subClassOf :Pizza ;");
    expect(written).toContain(":Basil a owl:NamedIndividual ;");
    expect(written).toContain("a :Topping .");
    expect(written.slice(written.indexOf(":MargheritaPizza a"))).not.toContain(`<${NS}`);

    const dup = await run("create_entity", { entity_type: "class", label: "Again", iri: `${NS}Pizza` });
    expect(dup.is_error).toBe(true);
    expect(dup.mutated).toBe(false);
  });

  it("accepts prefixed names wherever an IRI is expected", async () => {
    const created = await run("create_entity", { entity_type: "class", label: "Short Named", parent_iri: ":Pizza" });
    expect(created.is_error, created.summary).toBe(false);
    expect(created.data.iri).toBe(`${NS}ShortNamed`);

    const read = await run("get_entity", { iri: ":ShortNamed" });
    expect(read.is_error, read.summary).toBe(false);
    expect(read.data.iri).toBe(`${NS}ShortNamed`);
    expect(read.data.detail.parent_iris).toEqual([`${NS}Pizza`]);

    const updated = await run("update_class", { iri: ":ShortNamed", parent_iris: [":Pizza", "owl:Thing"] });
    expect(updated.is_error, updated.summary).toBe(false);
    expect((await run("get_entity", { iri: `${NS}ShortNamed` })).data.detail.parent_iris).toEqual(
      expect.arrayContaining([`${NS}Pizza`, "http://www.w3.org/2002/07/owl#Thing"]),
    );

    const typo = await run("get_entity", { iri: "piza:Pizza" });
    expect(typo.is_error).toBe(true);
    expect(typo.summary).toContain('unknown prefix "piza:"');
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
    expect(after.data.detail.labels).toEqual([{ value: "Pizza pie" }]);
    expect(after.data.detail.comments).toEqual([{ value: "A baked dish" }]);
    expect(after.data.detail.parent_iris).toEqual([`${NS}Food`]);

    const revs = await run("list_revisions", { limit: 1 });
    expect(revs.data.commits[0].message).toBe("Rename Pizza");

    const deprecate = await run("update_class", { iri: `${NS}Pizza`, deprecated: true });
    expect(deprecate.is_error).toBe(false);
    const again = await run("get_entity", { iri: `${NS}Pizza` });
    expect(again.data.detail.deprecated).toBe(true);
    expect(again.data.detail.labels).toEqual([{ value: "Pizza pie" }]);
  });

  it("update_property and update_individual keep omitted fields", async () => {
    const prop = await run("update_property", { iri: `${NS}hasTopping`, domain_iris: [`${NS}Pizza`] });
    expect(prop.is_error).toBe(false);
    const p = await run("get_entity", { iri: `${NS}hasTopping` });
    expect(p.data.detail.domain_iris).toEqual([`${NS}Pizza`]);
    expect(p.data.detail.range_iris).toEqual([`${NS}Topping`]);
    expect(p.data.detail.labels).toEqual([{ value: "has topping" }]);

    const ind = await run("update_individual", {
      iri: `${NS}Mozzarella`,
      comments: [{ value: "Soft cheese" }],
    });
    expect(ind.is_error).toBe(false);
    const i = await run("get_entity", { iri: `${NS}Mozzarella` });
    expect(i.data.detail.comments).toEqual([{ value: "Soft cheese" }]);
    expect(i.data.detail.type_iris).toEqual([`${NS}Topping`]);
    expect(i.data.detail.labels).toEqual([{ value: "Mozzarella" }]);
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
      old_text: '"Food"',
      new_text: '"Food", "Nourriture"',
      commit_message: "Add second label to Food",
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

    const report = await run("get_health_report");
    expect(report.is_error).toBe(false);
    expect(report.mutated).toBe(false);
    expect(report.data.lint.total_issues).toBe(lint.data.total_issues);
    expect(report.data.lint.issues.length).toBe(Math.min(lint.data.total_issues, 200));
    expect(report.data.consistency.checked_at).not.toBeNull();
    expect(report.data.consistency.issue_count).toBe(consistency.data.issues.length);
    expect(report.data.duplicates.checked_at).not.toBeNull();
    expect(report.data.duplicates.cluster_count).toBe(dups.data.clusters.length);

    if (lint.data.total_issues > 0) {
      const first = lint.data.issues[0];
      const byRule = await run("get_lint_issues", { rule_id: first.rule_id });
      expect(byRule.data.issues.every((i: { rule_id: string }) => i.rule_id === first.rule_id)).toBe(true);
      const paged = await run("get_lint_issues", { skip: lint.data.total_issues, limit: 5 });
      expect(paged.data.issues).toEqual([]);
      expect(paged.data.has_more).toBe(false);
    }

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

let propertyIri = "";
let individualIri = "";

describe("select_entity", () => {
  it("validates the IRI on the branch and returns a select_entity UI action", async () => {
    const created = await run("create_entity", { entity_type: "class", label: "Selectable", parent_iri: `${NS}Pizza` });
    const classIri = created.data.iri as string;
    const cls = await run("select_entity", { iri: classIri });
    expect(cls.is_error).toBe(false);
    expect(cls.mutated).toBe(false);
    expect(cls.ontology_changes).toEqual([]);
    expect(cls.ui_action).toEqual({ action: "select_entity", iri: classIri, entity_type: "class", label: "Selectable", branch: "main" });
    expect(cls.data).toEqual({ iri: classIri, entity_type: "class", label: "Selectable", selected: true });
    expect(cls.summary).toBe("Selected class Selectable");

    propertyIri = (await run("create_entity", { entity_type: "object_property", label: "has base" })).data.iri;
    individualIri = (await run("create_entity", { entity_type: "individual", label: "Thin Crust", parent_iri: `${NS}Pizza` })).data.iri;
    const prop = await run("select_entity", { iri: propertyIri });
    expect(prop.ui_action).toMatchObject({ entity_type: "property", label: "has base" });
    const ind = await run("select_entity", { iri: individualIri });
    expect(ind.ui_action).toMatchObject({ entity_type: "individual", label: "Thin Crust" });
  });

  it("returns an error and no UI action for an unknown IRI or the ontology header", async () => {
    const missing = await run("select_entity", { iri: `${NS}Nope` });
    expect(missing.is_error).toBe(true);
    expect(missing.summary).toBe(`Entity not found on branch main: ${NS}Nope`);
    expect(missing.ui_action).toBeNull();

    const header = await run("select_entity", { iri: "http://example.org/pizza" });
    expect(header.is_error).toBe(true);
    expect(header.ui_action).toBeNull();

    const empty = await run("select_entity", {});
    expect(empty.is_error).toBe(true);
  });

  it("refuses to select when the agent works on a branch the editor does not show", async () => {
    await run("create_branch", { name: "select-elsewhere" });
    const out = await executeTool("select_entity", { iri: `${NS}Pizza` }, { ...ctx, branch: "select-elsewhere", editorBranch: "main" });
    expect(out.is_error).toBe(true);
    expect(out.summary).toContain('The editor shows branch "main"');
    expect(out.ui_action).toBeNull();
  });
});

describe("ontology change reporting", () => {
  const head = async (branch = "main") => {
    const res = await app.request(`/api/v1/projects/${ctx.projectId}/source?branch=${branch}`);
    return ((await res.json()) as { commit_hash: string }).commit_hash;
  };

  it("reports a commit for every tool call that changes the ontology", async () => {
    const expectChange = async (name: string, input: Record<string, unknown>) => {
      const out = await run(name, input);
      expect(out.is_error, `${name}: ${out.summary}`).toBe(false);
      expect(out.mutated, name).toBe(true);
      expect(out.ontology_changes, name).toEqual([{ branch: "main", commit_hash: await head(), deleted_iris: [] }]);
      return out;
    };
    await expectChange("update_individual", { iri: individualIri, comments: [{ value: "crispy" }] });
    await expectChange("update_property", { iri: propertyIri, comments: [{ value: "the base" }] });
    const created = await expectChange("create_entity", { entity_type: "class", label: "Report Probe", parent_iri: `${NS}Pizza` });
    const probeIri = created.data.iri as string;
    await expectChange("update_class", { iri: probeIri, comments: [{ value: "probe" }] });
    await expectChange("edit_source", { old_text: "crispy", new_text: "crunchy", commit_message: "Tweak" });

    const deleted = await run("delete_entity", { iri: probeIri });
    expect(deleted.ontology_changes).toEqual([{ branch: "main", commit_hash: await head(), deleted_iris: [probeIri] }]);

    const source = await run("get_source");
    const replaced = await run("replace_source", { content: `${source.data.content}\n`, commit_message: "Rewrite" });
    expect(replaced.ontology_changes.map((c) => c.branch)).toEqual(["main"]);
  }, 30_000);

  it("update_individual keeps the entity written after the individual", async () => {
    // Regression: an individual block ends `; a <type> .` and the update used to swallow the next block.
    // create_entity now writes `:X ... a :Pizza .`; the full-IRI form that triggered the original bug
    // (`#` read as a comment) is covered in turtleIndividualUpdater.test.ts.
    const ind = await run("create_entity", { entity_type: "individual", label: "Deep Dish", parent_iri: `${NS}Pizza` });
    const next = await run("create_entity", { entity_type: "class", label: "After Deep Dish" });
    const before = (await run("get_source")).data.content as string;
    const nextBlock = before.slice(before.indexOf(`:${next.data.iri.slice(NS.length)} a owl:Class`));
    expect(nextBlock).toContain('"After Deep Dish"');

    const out = await run("update_individual", { iri: ind.data.iri, comments: [{ value: "tall" }] });
    expect(out.is_error, out.summary).toBe(false);

    const after = (await run("get_source")).data.content as string;
    expect(after.endsWith(nextBlock)).toBe(true);
    const cls = await run("get_entity", { iri: next.data.iri });
    expect(cls.is_error).toBe(false);
    const updated = await run("get_entity", { iri: ind.data.iri });
    expect(JSON.stringify(updated.data)).toContain("tall");
    expect(JSON.stringify(updated.data)).toContain(`${NS}Pizza`);
  });

  it("reports nothing for read-only tools and for calls that change no ontology", async () => {
    const before = await head();
    const reads: [string, Record<string, unknown>][] = [
      ["get_project", {}],
      ["search_entities", { query: "*" }],
      ["get_class_tree", {}],
      ["get_entity", { iri: `${NS}Pizza` }],
      ["get_entity_references", { iri: `${NS}Pizza` }],
      ["get_source", {}],
      ["list_revisions", {}],
      ["list_branches", {}],
      ["list_ontology_files", {}],
      ["get_lint_config", {}],
      ["list_lint_rules", {}],
      ["get_normalization_status", {}],
      ["normalize", { dry_run: true }],
      ["list_pull_requests", {}],
      ["select_entity", { iri: `${NS}Pizza` }],
    ];
    for (const [name, input] of reads) {
      const out = await run(name, input);
      expect(out.is_error, `${name}: ${out.summary}`).toBe(false);
      expect(out.mutated, name).toBe(false);
      expect(out.ontology_changes, name).toEqual([]);
    }

    // Project-level changes that do not commit to the ontology are mutations without an ontology change.
    const branch = await run("create_branch", { name: "report-probe-branch" });
    expect(branch.mutated).toBe(true);
    expect(branch.ontology_changes).toEqual([]);

    const failed = await run("update_class", { iri: `${NS}DoesNotExist`, comments: [] });
    expect(failed.is_error).toBe(true);
    expect(failed.ontology_changes).toEqual([]);
    expect(await head()).toBe(before);
  });

  it("reports the target branch when a merge commits there", async () => {
    await run("create_branch", { name: "merge-probe" });
    const featureCtx = { ...ctx, branch: "merge-probe" };
    const created = await executeTool("create_entity", { entity_type: "class", label: "Merge Probe" }, featureCtx);
    expect(created.ontology_changes.map((c) => c.branch)).toEqual(["merge-probe"]);
    const pr = await run("create_pull_request", { title: "Merge probe", source_branch: "merge-probe" });
    const merged = await run("merge_pull_request", { number: pr.data.number });
    expect(merged.is_error).toBe(false);
    expect(merged.ontology_changes.map((c) => c.branch)).toContain("main");
    expect(merged.ontology_changes.find((c) => c.branch === "main")?.commit_hash).toBe(await head());
  }, 30_000);

  it("lists, creates and switches the ontology file, as ontology changes", async () => {
    const projectId = await createPizzaProject(app);
    const own: ToolContext = { ...ctx, projectId, branch: "main" };
    const call = async (name: string, input: Record<string, unknown> = {}, c = own) => {
      const out = await executeTool(name, input, c);
      return { ...out, data: JSON.parse(out.content) };
    };

    const listed = await call("list_ontology_files");
    expect(listed.is_error, listed.summary).toBe(false);
    expect(listed.data).toMatchObject({ active_path: "ontology.ttl", suggested_file_name: "ontology-2.ttl" });
    expect((await call("get_project")).data.ontology_file).toBe("ontology.ttl");

    const created = await call("create_ontology_file", {
      file_name: "drinks.ttl",
      ontology_iri: "http://example.org/drinks",
      title: "Drinks",
    });
    expect(created.is_error, created.summary).toBe(false);
    expect(created.mutated).toBe(true);
    expect(created.ontology_changes.map((c) => c.branch)).toEqual(["main"]);
    expect(created.data).toMatchObject({ path: "drinks.ttl", previous_path: "ontology.ttl" });
    expect(created.data.project).toBeUndefined();

    const switched = await call("set_ontology_file", { path: "ontology.ttl" });
    expect(switched.is_error, switched.summary).toBe(false);
    expect(switched.mutated).toBe(true);
    expect(switched.ontology_changes).toEqual([]);
    expect(switched.summary).toBe("Switched the ontology file to ontology.ttl");

    // They change the project, so Edit Ontology must be on.
    const readOnly = { ...own, permissions: { edit_code: false, edit_ontology: false, edit_imports: false } };
    expect((await call("set_ontology_file", { path: "drinks.ttl" }, readOnly)).is_error).toBe(true);
    expect((await call("list_ontology_files", {}, readOnly)).is_error).toBe(false);
  }, 30_000);
});
