// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeDir, useTempDataDir, type AppLike } from "./agent/helpers";
import { parseTurtle } from "@/server/rdf";
import type { Rule, RuleFields } from "@/server/rules";

let dataDir: string;
let app: AppLike;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => removeDir(dataDir));

const EX = "http://example.org/shop#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const PREFIXES = `@prefix : <${EX}> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <${XSD}> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
`;

const SCHEMA = `
:Product a owl:Class ; rdfs:label "Product" .
:Book a owl:Class ; rdfs:label "Book" ; rdfs:subClassOf :Product .
:Brand a owl:Class ; rdfs:label "Brand" .
:Acme a owl:NamedIndividual, :Brand .
:Nobody a owl:NamedIndividual .
`;

const NONE: RuleFields = {
  applies_to_iri: EX + "Product",
  property_iri: EX + "p",
  min_count: null,
  max_count: null,
  value_class_iri: null,
  value_datatype_iri: null,
  allowed_values: null,
  pattern: null,
  min_length: null,
  max_length: null,
  closed: false,
  severity: "error",
  label: null,
  message: null,
};

const rule = (fields: Partial<RuleFields>): Rule => ({
  iri: EX + "rule",
  ...NONE,
  ...fields,
  read_only: false,
  imported_from: null,
});

async function violationsOf(r: Rule, instances: string) {
  const { store } = parseTurtle(PREFIXES + SCHEMA + instances);
  return (await import("@/server/rules")).validateRules([r], store);
}

describe("rules as SHACL", () => {
  it.each([
    ["min_count", { min_count: 1 }, ":ok a :Product ; :p 1 .", ":bad a :Product ."],
    ["max_count", { max_count: 1 }, ":ok a :Product ; :p 1 .", ":bad a :Product ; :p 1, 2 ."],
    ["value_class", { value_class_iri: EX + "Brand" }, ":ok a :Product ; :p :Acme .", ":bad a :Product ; :p :Nobody ."],
    ["value_datatype", { value_datatype_iri: XSD + "integer" }, ":ok a :Product ; :p 3 .", ':bad a :Product ; :p "three" .'],
    [
      "allowed_values",
      { allowed_values: [{ value: "red", type: "literal" as const }, { value: EX + "Acme", type: "iri" as const }] },
      ':ok a :Product ; :p "red", :Acme .',
      ':bad a :Product ; :p "blue" .',
    ],
    ["pattern", { pattern: "^[A-Z]{3}-\\d+$" }, ':ok a :Product ; :p "ABC-12" .', ':bad a :Product ; :p "abc" .'],
    ["min_length", { min_length: 3 }, ':ok a :Product ; :p "abc" .', ':bad a :Product ; :p "ab" .'],
    ["max_length", { max_length: 3 }, ':ok a :Product ; :p "abc" .', ':bad a :Product ; :p "abcd" .'],
  ])("%s flags the breaking instance only", async (constraint, fields, ok, bad) => {
    const found = await violationsOf(rule(fields), `${ok}\n${bad}`);
    expect(found.map((v) => [v.focus_node, v.constraint, v.rule_iri, v.property_iri])).toEqual([
      [EX + "bad", constraint, EX + "rule", EX + "p"],
    ]);
  });

  it("checks instances of subclasses, and uses the rule's severity and comment", async () => {
    const found = await violationsOf(rule({ min_count: 1, severity: "warning", message: "Every product needs p" }), ":b a :Book .");
    expect(found).toEqual([
      expect.objectContaining({ focus_node: EX + "b", severity: "warning", message: "Every product needs p", value: null }),
    ]);
  });

  it("closes a class to the properties its rules name, besides type and annotations", async () => {
    const closed = rule({ property_iri: EX + "name", min_count: 1, closed: true });
    const found = await violationsOf(
      closed,
      `:a a :Product ; :name "A" ; rdfs:label "A" ; rdfs:comment "c" ; skos:definition "d" .
       :b a :Book ; :name "B" ; :colour "red" .`,
    );
    expect(found.map((v) => [v.focus_node, v.constraint, v.property_iri, v.value])).toEqual([
      [EX + "b", "closed", EX + "colour", "red"],
    ]);
  });
});

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const enc = encodeURIComponent;

async function createProject(name: string, ontologyIri: string, body: string): Promise<string> {
  const res = await app.request("/api/v1/projects", json("POST", { name }));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const content = `${PREFIXES}\n<${ontologyIri}> a owl:Ontology .\n${body}`;
  const put = await app.request(`/api/v1/projects/${id}/source?branch=main`, json("PUT", { content, commit_message: "Seed" }));
  expect(put.status).toBe(200);
  return id;
}

const SHOP = "http://example.org/shop";
const SHOP_BODY = `
:Product a owl:Class ; rdfs:label "Product" .
:sku a owl:DatatypeProperty ; rdfs:label "sku" .
:widget a owl:NamedIndividual, :Product ; :sku "W-1" .
`;

const NEEDS_SKU = { applies_to_iri: EX + "Product", property_iri: EX + "sku", min_count: 1, label: "Products need a SKU" };

async function source(projectId: string, branch = "main"): Promise<string> {
  return (await (await app.request(`/api/v1/projects/${projectId}/source?branch=${branch}`)).json()).content;
}

async function head(projectId: string, branch = "main"): Promise<string> {
  return (await (await app.request(`/api/v1/projects/${projectId}/source?branch=${branch}`)).json()).commit_hash;
}

async function violationsAt(projectId: string, branch = "main") {
  const target = await head(projectId, branch);
  for (let i = 0; i < 100; i++) {
    const res = await app.request(`/api/v1/projects/${projectId}/rules/violations?branch=${branch}`);
    const body = (await res.json()) as { commit_hash: string | null; violations: { focus_node: string; rule_iri: string }[] };
    if (body.commit_hash === target) return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("validation after the commit never finished");
}

async function addInstance(projectId: string, turtle: string, branch = "main") {
  const content = `${await source(projectId, branch)}\n${turtle}\n`;
  const put = await app.request(`/api/v1/projects/${projectId}/source?branch=${branch}`, json("PUT", { content, commit_message: "Add" }));
  expect(put.status).toBe(200);
}

describe("rules in a project", () => {
  it("commits a rule with the rules import, validates after each commit, and keeps rules out of the individual list", async () => {
    const id = await createProject("Shop", SHOP, SHOP_BODY);
    const created = await app.request(`/api/v1/projects/${id}/rules`, json("POST", NEEDS_SKU));
    expect(created.status).toBe(201);
    const { rule } = (await created.json()) as { rule: { iri: string; read_only: boolean } };
    expect(rule.read_only).toBe(false);

    const { store, prefixes } = parseTurtle(await source(id));
    expect(store.countQuads(SHOP, "http://www.w3.org/2002/07/owl#imports", "https://ontobuild.dev/rules", null)).toBe(1);
    expect(prefixes.rule).toBe("https://ontobuild.dev/rules#");

    await addInstance(id, ":gizmo a owl:NamedIndividual, :Product .");
    const after = await violationsAt(id);
    expect(after.violations.map((v) => [v.focus_node, v.rule_iri])).toEqual([[EX + "gizmo", rule.iri]]);

    const individuals = await (await app.request(`/api/v1/projects/${id}/ontology/search?q=*&entity_types=individual`)).json();
    expect((individuals.results as { iri: string }[]).map((r) => r.iri)).not.toContain(rule.iri);
    const tree = await (await app.request(`/api/v1/projects/${id}/ontology/tree`)).json();
    expect((tree.nodes as { iri: string }[]).map((n) => n.iri)).toEqual([EX + "Product"]);

    const shacl = await app.request(`/api/v1/projects/${id}/rules/shacl`);
    expect(shacl.headers.get("content-type")).toContain("text/turtle");
    const shapes = parseTurtle(await shacl.text()).store;
    expect(shapes.countQuads(null, "http://www.w3.org/ns/shacl#minCount", null, null)).toBe(1);

    const put = await app.request(
      `/api/v1/projects/${id}/rules/${enc(rule.iri)}`,
      json("PUT", { ...NEEDS_SKU, min_count: null, pattern: "^W-" }),
    );
    expect(put.status).toBe(200);
    expect((await put.json()).rule).toMatchObject({ min_count: null, pattern: "^W-" });
    expect((await violationsAt(id)).violations).toEqual([]);

    expect((await app.request(`/api/v1/projects/${id}/rules/${enc(rule.iri)}`, { method: "DELETE" })).status).toBe(204);
    expect((await (await app.request(`/api/v1/projects/${id}/rules`)).json()).rules).toEqual([]);
  });

  it("applies rules from an imported project, read-only", async () => {
    const catalog = "http://example.org/catalog";
    const base = await createProject("Catalog", catalog, SHOP_BODY);
    expect((await app.request(`/api/v1/projects/${base}/rules`, json("POST", NEEDS_SKU))).status).toBe(201);
    const store = "http://example.org/store";
    const id = await createProject("Store", store, `<${EX}gadget> a <${EX}Product> .`);
    expect((await app.request(`/api/v1/projects/${id}/imports?branch=main`, json("POST", { iri: catalog }))).status).toBe(200);

    const { rules } = (await (await app.request(`/api/v1/projects/${id}/rules?class=${enc(EX + "Product")}`)).json()) as {
      rules: { iri: string; read_only: boolean; imported_from: string }[];
    };
    expect(rules).toEqual([expect.objectContaining({ read_only: true, imported_from: catalog })]);
    expect((await violationsAt(id)).violations.map((v) => v.focus_node)).toEqual([EX + "gadget"]);

    const put = await app.request(`/api/v1/projects/${id}/rules/${enc(rules[0].iri)}`, json("PUT", NEEDS_SKU));
    expect(put.status).toBe(403);
  });

  it("refuses unknown projects and rules, invalid rules, and writes over changes made outside the editor", async () => {
    const id = await createProject("Refusals", SHOP, SHOP_BODY);
    expect((await app.request(`/api/v1/projects/nope/rules`)).status).toBe(404);
    expect((await app.request(`/api/v1/projects/${id}/rules/${enc(EX + "missing")}`, { method: "DELETE" })).status).toBe(404);
    expect((await app.request(`/api/v1/projects/${id}/rules`, json("POST", { applies_to_iri: EX + "Product" }))).status).toBe(422);
    expect((await app.request(`/api/v1/projects/${id}/rules`, json("POST", { ...NEEDS_SKU, applies_to_iri: EX + "sku" }))).status).toBe(422);

    const project = (await (await app.request(`/api/v1/projects/${id}`)).json()) as { folder: string; git_ontology_path: string };
    fs.appendFileSync(path.join(dataDir, "projects", project.folder, project.git_ontology_path), `\n<${EX}Other> a owl:Class .\n`);
    const before = await head(id);
    expect((await app.request(`/api/v1/projects/${id}/rules`, json("POST", NEEDS_SKU))).status).toBe(409);
    expect(await head(id)).toBe(before);
  });

  it("refuses to merge a pull request that adds a violation the base does not have", async () => {
    const id = await createProject("Gate", SHOP, SHOP_BODY);
    expect((await app.request(`/api/v1/projects/${id}/rules`, json("POST", NEEDS_SKU))).status).toBe(201);
    await addInstance(id, ":old a :Product .");
    expect((await app.request(`/api/v1/projects/${id}/branches`, json("POST", { name: "feature", from_branch: "main" }))).status).toBe(201);
    await addInstance(id, ":new a :Product .", "feature");

    const created = await app.request(
      `/api/v1/projects/${id}/pull-requests`,
      json("POST", { title: "Add new", source_branch: "feature", target_branch: "main" }),
    );
    const pr = (await created.json()) as {
      pr_number: number;
      can_merge: boolean;
      merge_blocked_reason: string | null;
      rule_violations_added: { focus_node: string }[];
    };
    expect(pr.can_merge).toBe(false);
    expect(pr.merge_blocked_reason).toBeTruthy();
    expect(pr.rule_violations_added.map((v) => v.focus_node)).toEqual([EX + "new"]);

    const merge = await app.request(`/api/v1/projects/${id}/pull-requests/${pr.pr_number}/merge`, json("POST", {}));
    expect(merge.status).toBe(409);
    expect((await merge.json()).code).toBe("rule_violations");
  });
});

describe("agent rule tools", () => {
  it("creates a rule from prefixed names and changes only the fields an update passes", async () => {
    const id = await createProject("Agent", SHOP, SHOP_BODY);
    const { executeTool } = await import("@/server/agent/tools");
    const ctx = { projectId: id, branch: "main", request: (p: string, init?: RequestInit) => Promise.resolve(app.request(p, init)), pollIntervalMs: 20 };
    const created = await executeTool("create_rule", { applies_to_iri: ":Product", property_iri: ":sku", min_count: 1, message: "Needs a SKU" }, ctx);
    expect(created.is_error).toBe(false);
    const iri = JSON.parse(created.content).rule.iri as string;

    const updated = await executeTool("update_rule", { iri, max_length: 8 }, ctx);
    expect(updated.is_error).toBe(false);
    expect(JSON.parse(updated.content).rule).toMatchObject({
      applies_to_iri: EX + "Product",
      property_iri: EX + "sku",
      min_count: 1,
      max_length: 8,
      message: "Needs a SKU",
    });
  });
});
