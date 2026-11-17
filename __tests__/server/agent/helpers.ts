import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PIZZA_TTL = `@prefix : <http://example.org/pizza#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

<http://example.org/pizza> a owl:Ontology ;
    rdfs:label "Pizza ontology" .

:Food a owl:Class ;
    rdfs:label "Food" .

:Pizza a owl:Class ;
    rdfs:label "Pizza" ;
    rdfs:comment "A baked dish" ;
    rdfs:subClassOf :Food .

:Topping a owl:Class ;
    rdfs:label "Topping" .

:hasTopping a owl:ObjectProperty ;
    rdfs:label "has topping" ;
    rdfs:range :Topping .

:Mozzarella a owl:NamedIndividual, :Topping ;
    rdfs:label "Mozzarella" .
`;

type G = typeof globalThis & Record<string, unknown>;

export function useTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ontobuilder-agent-test-"));
  process.env.ONTOBUILDER_DATA_DIR = dir;
  const g = globalThis as G;
  for (const k of ["__ontobuilderDb", "__ontobuilderOntologyCache", "__ontobuilderJobsInit", "__ontobuilderLintInit", "__ontobuilderIndexMemo"]) {
    delete g[k];
  }
  return dir;
}

export function removeDir(dir: string) {
  const g = globalThis as G;
  const db = g.__ontobuilderDb as { close?: () => void } | undefined;
  try {
    db?.close?.();
  } catch {
  }
  delete g.__ontobuilderDb;
  fs.rmSync(dir, { recursive: true, force: true });
}

export interface AppLike {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export async function createPizzaProject(app: AppLike): Promise<string> {
  const res = await app.request("/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Pizza" }),
  });
  if (res.status !== 201) throw new Error(`create project failed: ${res.status} ${await res.text()}`);
  const project = (await res.json()) as { id: string };
  const put = await app.request(`/api/v1/projects/${project.id}/source?branch=main`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: PIZZA_TTL, commit_message: "Seed pizza ontology" }),
  });
  if (!put.ok) throw new Error(`seed failed: ${put.status} ${await put.text()}`);
  return project.id;
}

export interface SseEvent {
  event: string;
  data: unknown;
}

export function parseSse(text: string): SseEvent[] {
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      return { event, data: JSON.parse(data.join("\n")) };
    });
}
