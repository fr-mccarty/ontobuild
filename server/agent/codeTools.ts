import { spawn } from "node:child_process";
import fs from "node:fs";
import { commitFolderChanges } from "../folderChanges";
import { ApiError } from "../http";
import { DEFAULT_ONTOLOGY_FILE, ontologyFilePath, requireProject } from "../ontology";
import { deletePath, listFiles, normalizeRelPath, readTextFile, resolveProjectPath, writeTextFile } from "../workspaceFiles";
// Type-only: tools.ts imports CODE_TOOLS from this module.
import type { ToolContext, ToolDef } from "./tools";

/** Tools for the project folder (data/projects/<folder>/): reading and editing code, running commands. */

export const MAX_LIST_PATHS = 1000;
export const MAX_READ_CHARS = 100_000;
export const MAX_COMMAND_OUTPUT = 20_000;
export const DEFAULT_COMMAND_TIMEOUT_S = 60;
export const MAX_COMMAND_TIMEOUT_S = 300;

function fail(message: string): never {
  throw new ApiError(400, message);
}

function ontologyPaths(projectId: string): string[] {
  const paths = new Set([DEFAULT_ONTOLOGY_FILE, ontologyFilePath(requireProject(projectId))]);
  return [...paths].map((p) => {
    try {
      return normalizeRelPath(p).toLowerCase();
    } catch {
      return p.toLowerCase();
    }
  });
}

/** Refuse paths that are, or contain, the ontology file; it is edited only through the ontology tools. */
function guardOntology(projectId: string, rel: string, verb: string) {
  const clean = normalizeRelPath(rel).toLowerCase();
  for (const onto of ontologyPaths(projectId)) {
    if (clean === onto || onto.startsWith(`${clean}/`)) {
      fail(`Refusing to ${verb} ${onto}: the ontology is edited only through the ontology tools (edit_source, create_entity, ...)`);
    }
  }
}

/** The environment for run_command: the server's, without settings meant for the Next.js server itself. */
export function commandEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    // Code the agent runs must not see the key it is driven with.
    if (k === "NODE_OPTIONS" || k === "OPENROUTER_API_KEY" || /^_*NEXT_/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

export interface CommandResult {
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  output: string;
  truncated: boolean;
}

/** Run `bash -lc <command>` in `cwd`, keeping the last MAX_COMMAND_OUTPUT characters of stdout and stderr. */
export function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: commandEnv() as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let truncated = false;
    let timedOut = false;
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > MAX_COMMAND_OUTPUT * 2) {
        output = output.slice(-MAX_COMMAND_OUTPUT);
        truncated = true;
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const kill = () => {
      try {
        // Kill the whole process group so children of bash stop too.
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (output.length > MAX_COMMAND_OUTPUT) {
        output = output.slice(-MAX_COMMAND_OUTPUT);
        truncated = true;
      }
      resolve({ exit_code: code, signal: sig, timed_out: timedOut, output, truncated });
    });
  });
}

const s = (input: Record<string, unknown>, key: string) => input[key] as string;

export const CODE_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    kind: "read",
    description:
      "List files in the project folder (the ontology file, code/ and anything else in it), recursively. Directories end with \"/\". Skips .git, node_modules, virtualenvs and build output.",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory relative to the project folder, for example \"code\". Defaults to the whole folder." },
      },
    },
    async run(input, ctx: ToolContext) {
      const dir = (input.dir as string | undefined) ?? "";
      const { entries, truncated } = listFiles(ctx.projectId, dir);
      const paths = entries.slice(0, MAX_LIST_PATHS).map((e) => (e.type === "dir" ? `${e.path}/` : e.path));
      const more = truncated || entries.length > MAX_LIST_PATHS;
      return {
        result: { dir: normalizeRelPath(dir), paths, truncated: more },
        summary: `Listed ${paths.length}${more ? "+" : ""} paths${dir ? ` in ${normalizeRelPath(dir) || "."}` : ""}`,
        mutated: false,
      };
    },
  },
  {
    name: "read_file",
    kind: "read",
    description:
      "Read a text file in the project folder. Optionally pass a 1-based inclusive line range. Long output is cut off; read a range to see more.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, description: "File path relative to the project folder, for example \"code/main.py\"" },
        start_line: { type: "integer", minimum: 1, description: "First line to return (1-based)" },
        end_line: { type: "integer", minimum: 1, description: "Last line to return (inclusive)" },
      },
      required: ["path"],
    },
    async run(input, ctx) {
      const file = readTextFile(ctx.projectId, s(input, "path"));
      const lines = file.content.split("\n");
      const start = (input.start_line as number | undefined) ?? 1;
      if (start > lines.length) fail(`start_line ${start} is past the end of the file (${lines.length} lines)`);
      const end = Math.min((input.end_line as number | undefined) ?? lines.length, lines.length);
      if (end < start) fail("end_line must not be before start_line");
      let content = lines.slice(start - 1, end).join("\n");
      let truncated = false;
      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS);
        truncated = true;
      }
      return {
        result: { path: file.path, size: file.size, total_lines: lines.length, start_line: start, end_line: end, content, truncated },
        summary: `Read ${file.path}`,
        mutated: false,
      };
    },
  },
  {
    name: "write_file",
    kind: "code",
    description:
      "Create or overwrite a text file in the project folder (put code under code/). Parent directories are created. Not for the ontology file: edit it with the ontology tools.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, description: "File path relative to the project folder, for example \"code/main.py\"" },
        content: { type: "string", description: "The full new file content" },
      },
      required: ["path", "content"],
    },
    async run(input, ctx) {
      guardOntology(ctx.projectId, s(input, "path"), "write");
      const out = writeTextFile(ctx.projectId, s(input, "path"), s(input, "content"));
      return {
        result: out,
        summary: `${out.created ? "Created" : "Wrote"} ${out.path}`,
        mutated: true,
      };
    },
  },
  {
    name: "delete_file",
    kind: "code",
    description: "Delete a file or directory (recursively) in the project folder. Not for the ontology file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, description: "Path relative to the project folder" },
      },
      required: ["path"],
    },
    async run(input, ctx) {
      guardOntology(ctx.projectId, s(input, "path"), "delete");
      const rel = normalizeRelPath(s(input, "path"));
      deletePath(ctx.projectId, rel);
      return { result: { path: rel, deleted: true }, summary: `Deleted ${rel}`, mutated: true };
    },
  },
  {
    name: "commit_folder_changes",
    kind: "code",
    description:
      "Save the project: commit every change in the project folder except the ontology file (files you wrote or deleted, output of commands, edits made in a terminal or text editor) " +
      "to the branch checked out in the folder, locally (not pushed). New files are added and deleted ones removed; node_modules, virtualenvs and build output are left out. " +
      "Your ontology edits are already committed as you make them. If `ontology_changed` comes back true, the ontology file was also changed outside the ontology tools: " +
      "commit it with commit_ontology_folder_changes. Fails when there is nothing to commit.",
    parameters: {
      type: "object",
      properties: {
        commit_message: {
          type: "string",
          description:
            "What the changes are, in the imperative mood, for example \"Add the import script\". Defaults to \"Commit <n> changed files in the project folder\".",
        },
      },
    },
    async run(input, ctx) {
      const out = await commitFolderChanges(ctx.projectId, input.commit_message);
      const n = out.files.length;
      return {
        result: out,
        summary: `Committed ${n} ${n === 1 ? "file" : "files"} on ${out.branch}`,
        mutated: true,
      };
    },
  },
  {
    name: "run_command",
    kind: "code",
    description:
      "Run a shell command with `bash -lc` in the project folder (or a subdirectory), for example to run tests or a script. Returns the exit code and the last 20 KB of combined stdout and stderr. The command is killed after the timeout.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1, description: "The shell command" },
        cwd: { type: "string", description: "Working directory relative to the project folder, for example \"code\". Defaults to the project folder." },
        timeout_seconds: {
          type: "integer",
          minimum: 1,
          maximum: MAX_COMMAND_TIMEOUT_S,
          description: `Timeout in seconds (default ${DEFAULT_COMMAND_TIMEOUT_S}, max ${MAX_COMMAND_TIMEOUT_S})`,
        },
      },
      required: ["command"],
    },
    async run(input, ctx) {
      const { abs, rel } = resolveProjectPath(ctx.projectId, (input.cwd as string | undefined) ?? "");
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) fail(`Not a directory: ${rel || "."}`);
      const timeoutS = Math.min((input.timeout_seconds as number | undefined) ?? DEFAULT_COMMAND_TIMEOUT_S, MAX_COMMAND_TIMEOUT_S);
      const out = await runShellCommand(s(input, "command"), abs, timeoutS * 1000, ctx.signal);
      const summary = out.timed_out
        ? `Command timed out after ${timeoutS}s`
        : out.exit_code === 0
          ? "Command succeeded"
          : `Command exited with ${out.exit_code ?? out.signal}`;
      return { result: { cwd: rel || ".", ...out }, summary, mutated: true };
    },
  },
];
