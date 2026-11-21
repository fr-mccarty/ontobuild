/**
 * Importing a project from a git repository: clone it (full history) into a new project
 * folder, keep the clone's `origin` as the project's linked remote, and pick the ontology file.
 *
 * Mapping a repository onto a project folder (data/projects/<folder>/):
 * - The clone *is* the project folder, so the repository's own layout and history are kept.
 *   Nothing is moved; `projects.git_ontology_path` records where the ontology lives.
 * - A Turtle (.ttl) ontology is edited in place, wherever it is in the repository. It is not
 *   rewritten on import, so the first commit after the clone is the user's own edit.
 * - Any other RDF format is converted to Turtle (OntoBuild reads and writes Turtle) with the
 *   same normalization as an uploaded file, and committed as `ontology.ttl` at the top of the
 *   repository (or next to the original when that name is taken). The original file is left
 *   unchanged. The conversion is a local commit; it reaches the remote only when the user pushes.
 * - When the repository has no usable ontology, the project is created without one, like a
 *   project whose ontology file is missing.
 * - `code/` is created if missing but not committed (git doesn't track empty folders).
 */
import fs from "node:fs";
import path from "node:path";
import { cloneRepository, parseRemoteUrl, repoNameFromUrl } from "./github";
import * as git from "./git";
import { insert, newId, nowIso, run, toJson, update } from "./db";
import { httpError } from "./http";
import { emitOntologyEvent, requireProject, DEFAULT_ONTOLOGY_FILE, type ProjectRow } from "./ontology";
import { FORMAT_NAMES, RdfParseError, ontologyMetadata, type ImportNormalizationReport } from "./rdf";
import {
  candidatesFromTree,
  cleanRelativePath,
  conversionMessage,
  countLanguageTags,
  languageTagWarning,
  listTree,
  loadCandidate,
  requireTreeCandidate,
  siblingTurtlePath,
  type LoadedCandidate,
  type OntologyCandidate,
  type TreeListing,
} from "./ontologyFiles";
import { LOCAL_USER } from "./user";
import { CODE_DIR, PROJECTS_DIR, allocateFolder, removeProjectDir } from "./workspace";

export { MAX_ONTOLOGY_FILE_SIZE, findOntologyCandidates, type OntologyCandidate } from "./ontologyFiles";

/** How many plausible files are parsed, best first, before giving up on finding an ontology. */
const MAX_PARSE_ATTEMPTS = 5;

export interface GitImportSummary {
  remote_url: string;
  web_url: string | null;
  branch: string | null;
  /** The file the project edits (repository-relative), or null when no ontology was found. */
  ontology_path: string | null;
  /** The file it came from: the same as ontology_path, or the original when it was converted to Turtle. */
  source_path: string | null;
  /** True when the ontology was converted to Turtle and committed as a new file. */
  converted: boolean;
  /** How the file was chosen. */
  selection: "requested" | "automatic" | "none";
  /** Every RDF file considered, best first. */
  candidates: OntologyCandidate[];
  /** Things the user should know: files that could not be parsed, too large, language tags kept. */
  warnings: string[];
}

/** Where a converted ontology is committed: `ontology.ttl` at the top, else `<name>.ttl` next to the original. */
function convertedPath(dir: string, entries: TreeListing, source: string): string {
  const taken = (p: string) => entries.has(p) || fs.existsSync(path.join(dir, p));
  if (!taken(DEFAULT_ONTOLOGY_FILE)) return DEFAULT_ONTOLOGY_FILE;
  const sibling = siblingTurtlePath(source);
  if (!taken(sibling)) return sibling;
  httpError(
    409,
    `Can't convert ${source} to Turtle: both ${DEFAULT_ONTOLOGY_FILE} and ${sibling} already exist. ` +
      "Pick one of the Turtle files as the ontology instead.",
  );
}

export interface GitImportRequest {
  url?: unknown;
  branch?: unknown;
  name?: unknown;
  description?: unknown;
  ontology_path?: unknown;
  is_public?: unknown;
}

export async function importFromGit(body: GitImportRequest): Promise<{ project: ProjectRow; summary: GitImportSummary }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) httpError(422, "Expected a JSON object");
  if (typeof body.url !== "string" || !body.url.trim()) httpError(422, "Field 'url' is required");
  const remote = parseRemoteUrl(body.url);
  let branch: string | null = null;
  if (body.branch !== undefined && body.branch !== null && body.branch !== "") {
    if (typeof body.branch !== "string" || !(await git.isValidBranchName(body.branch.trim()))) {
      httpError(422, "Field 'branch' is not a valid branch name");
    }
    branch = body.branch.trim();
  }
  if (body.name !== undefined && body.name !== null && typeof body.name !== "string") httpError(422, "Field 'name' must be a string");
  const nameOverride = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  if (nameOverride && nameOverride.length > 255) httpError(422, "name must be between 1 and 255 characters");
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string")
    httpError(422, "Field 'description' must be a string");
  const descOverride = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  if (descOverride && descOverride.length > 5000) httpError(422, "description too long");
  const requestedPath = cleanRelativePath(body.ontology_path, "ontology_path");

  const repoName = repoNameFromUrl(remote.url);
  const id = newId();
  const now = nowIso();
  // Reserve the folder (and the row that owns it) before cloning, so two imports never share one.
  const folder = allocateFolder(nameOverride || repoName);
  const dir = path.join(PROJECTS_DIR, folder);
  insert("projects", {
    id,
    name: nameOverride || repoName,
    description: descOverride,
    is_public: body.is_public === true,
    owner_id: LOCAL_USER.id,
    created_at: now,
    updated_at: now,
    source_file_path: null,
    git_ontology_path: null,
    folder,
    ontology_iri: null,
    normalization_report: null,
  });

  try {
    await cloneRepository(remote.url, dir, { branch });
    const checkedOut = await git.checkedOutBranch(id);
    const entries = await listTree(dir, "HEAD");
    const candidates = await candidatesFromTree(dir, entries);
    const warnings: string[] = [];

    let chosen: LoadedCandidate | null = null;
    if (requestedPath) {
      const c = requireTreeCandidate(dir, entries, requestedPath, candidates, branch);
      try {
        chosen = await loadCandidate(dir, "HEAD", c);
      } catch (e) {
        if (e instanceof RdfParseError) httpError(422, `Failed to parse ${requestedPath}: ${e.message}`);
        throw e;
      }
    } else {
      for (const c of candidates.slice(0, MAX_PARSE_ATTEMPTS)) {
        try {
          chosen = await loadCandidate(dir, "HEAD", c);
          break;
        } catch (e) {
          if (!(e instanceof RdfParseError)) throw e;
          warnings.push(`Skipped ${c.path}: couldn't read it as ${FORMAT_NAMES[c.format]} (${e.message.split("\n")[0]})`);
        }
      }
      if (!chosen) {
        warnings.push(
          candidates.length
            ? "No readable ontology file was found, so the project has no ontology yet."
            : "The repository has no RDF files (.ttl, .owl, .rdf, .jsonld, …), so the project has no ontology yet.",
        );
      }
    }

    fs.mkdirSync(path.join(dir, CODE_DIR), { recursive: true });

    const summary: GitImportSummary = {
      remote_url: remote.url,
      web_url: remote.web_url,
      branch: checkedOut,
      ontology_path: null,
      source_path: null,
      converted: false,
      selection: chosen ? (requestedPath ? "requested" : "automatic") : "none",
      candidates,
      warnings,
    };
    if (!chosen) return { project: requireProject(id), summary };

    const meta = ontologyMetadata(chosen.store);
    let ontologyPath = chosen.candidate.path;
    let report: ImportNormalizationReport | null = null;
    let commit: git.CommitInfo | null = null;
    if (chosen.converted) {
      if (!checkedOut) httpError(409, "The clone has no branch checked out, so the converted ontology can't be committed");
      ontologyPath = convertedPath(dir, entries, chosen.candidate.path);
      report = {
        ...chosen.converted.report,
        notes: [
          ...chosen.converted.report.notes,
          `Saved as ${ontologyPath}, committed locally (not pushed); ${chosen.candidate.path} is unchanged`,
        ],
      };
    } else {
      const tagged = countLanguageTags(chosen.store);
      if (tagged) warnings.push(languageTagWarning(tagged, ontologyPath));
    }

    update(
      "projects",
      {
        description: descOverride || meta.description,
        source_file_path: `projects/${id}/${ontologyPath}`,
        git_ontology_path: ontologyPath,
        ontology_iri: meta.iri,
        normalization_report: report ? toJson(report) : null,
      },
      { id },
    );

    if (chosen.converted && checkedOut) {
      const message = conversionMessage(chosen.candidate.path, ontologyPath, FORMAT_NAMES[chosen.candidate.format]);
      const parent = await git.resolveRef(id, `refs/heads/${checkedOut}`);
      commit = await git.commitFiles(id, {
        branch: checkedOut,
        files: [{ path: ontologyPath, content: chosen.converted.turtle }],
        message,
        author: { name: LOCAL_USER.name, email: LOCAL_USER.email },
      });
      await emitOntologyEvent({
        type: "commit",
        projectId: id,
        branch: checkedOut,
        commitHash: commit.hash,
        parentHash: parent,
        message,
        origin: "import",
      });
    }

    summary.ontology_path = ontologyPath;
    summary.source_path = chosen.candidate.path;
    summary.converted = !!chosen.converted;
    return { project: requireProject(id), summary };
  } catch (e) {
    try {
      removeProjectDir(dir);
    } catch {
    }
    run("DELETE FROM projects WHERE id = ?", id);
    throw e;
  }
}
