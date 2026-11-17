import { error, ref, type DocMap, type QueryParamDoc, type Schema } from "./types";

export const workspaceSchemas: Record<string, Schema> = {
  WorkspaceFileEntry: {
    type: "object",
    required: ["path", "type", "size"],
    properties: {
      path: { type: "string", description: "Path relative to the project folder, `/` separated.", examples: ["code/app.py"] },
      type: { type: "string", enum: ["file", "dir"] },
      size: { type: "integer", description: "Size in bytes (0 for directories)." },
    },
  },
  TerminalSession: {
    type: "object",
    required: ["id", "title", "kind", "running", "exit_code", "cwd"],
    properties: {
      id: { type: "string" },
      title: { type: "string", description: "Shell name, file name for `run` sessions, or `Dev server`.", examples: ["hello.py"] },
      kind: { type: "string", enum: ["shell", "run", "devserver"] },
      running: { type: "boolean" },
      exit_code: { type: ["integer", "null"], description: "Exit code once the process has ended." },
      cwd: { type: "string", description: "Working directory relative to the project folder (`\"\"` is the project root)." },
    },
  },
  DevServerStatus: {
    type: "object",
    required: ["command", "cwd", "configured_url", "detected_url", "url", "running", "terminal_id", "suggested_command"],
    properties: {
      command: { type: ["string", "null"], description: "Configured shell command." },
      cwd: { type: "string", description: "Directory the command runs in, relative to the project folder." },
      configured_url: { type: ["string", "null"], description: "URL set in the configuration." },
      detected_url: {
        type: ["string", "null"],
        description: "First local http URL printed by the running dev server (`0.0.0.0` reported as `localhost`).",
        examples: ["http://localhost:5173"],
      },
      url: { type: ["string", "null"], description: "`configured_url`, else `detected_url`." },
      running: { type: "boolean" },
      terminal_id: { type: ["string", "null"], description: "Terminal session of the most recent dev server run." },
      suggested_command: {
        type: ["string", "null"],
        description: "Command guessed from `code/` (package.json scripts, manage.py or index.html), used when none is configured.",
        examples: ["npm run dev"],
      },
    },
  },
};

const pathQuery: QueryParamDoc = {
  name: "path",
  description: "File path relative to the project folder, `/` separated.",
  required: true,
  schema: { type: "string" },
};

const tidParam = { tid: "Terminal session id." };

const pathErrors = {
  "400": error("The path is outside the project folder."),
  "403": error("The path is inside `.git`."),
};

const devServer = (description: string) => ({ description, schema: ref("DevServerStatus") });

export const workspaceDocs: DocMap = {
  "GET /projects/{id}/files": {
    summary: "List project files",
    description:
      "Lists every file and directory in the project folder, recursively. `.git`, `node_modules` and similar build or cache directories are skipped. " +
      "At most 5000 entries are returned; `truncated` is true when there were more.",
    responses: {
      "200": {
        description: "Files and directories, directories first within each folder.",
        schema: {
          type: "object",
          required: ["entries", "truncated"],
          properties: { entries: { type: "array", items: ref("WorkspaceFileEntry") }, truncated: { type: "boolean" } },
        },
      },
      "404": error("Project not found."),
    },
  },
  "GET /projects/{id}/files/content": {
    summary: "Read a text file",
    description: "Returns a file's contents as UTF-8 text. Files over 2 MB and binary files are refused; use the raw endpoint for those.",
    query: [pathQuery],
    responses: {
      "200": {
        description: "File contents.",
        schema: {
          type: "object",
          required: ["path", "content", "size"],
          properties: { path: { type: "string" }, content: { type: "string" }, size: { type: "integer" } },
        },
      },
      ...pathErrors,
      "404": error("Project or file not found."),
      "413": error("The file is too large to open as text."),
      "415": error("The file is binary."),
      "422": error("The `path` query parameter is missing."),
    },
  },
  "PUT /projects/{id}/files/content": {
    summary: "Write a text file",
    description: "Creates or overwrites a file with UTF-8 text, creating parent directories as needed. The change is not committed.",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["path", "content"],
        properties: { path: { type: "string", minLength: 1 }, content: { type: "string" } },
      },
    },
    responses: {
      "200": {
        description: "The file was written.",
        schema: {
          type: "object",
          required: ["path", "size", "created"],
          properties: {
            path: { type: "string" },
            size: { type: "integer", description: "Bytes written." },
            created: { type: "boolean", description: "True when the file did not exist before." },
          },
        },
      },
      ...pathErrors,
      "404": error("Project not found."),
      "422": error("The body is invalid."),
    },
  },
  "DELETE /projects/{id}/files": {
    summary: "Delete a file or directory",
    description: "Deletes a file, or a directory with everything in it. The project folder itself can't be deleted.",
    query: [pathQuery],
    responses: {
      "204": { description: "Deleted." },
      ...pathErrors,
      "404": error("Project or path not found."),
      "422": error("The `path` query parameter is missing."),
    },
  },
  "GET /projects/{id}/files/raw": {
    summary: "Download a file's bytes",
    description:
      "Streams a file's raw bytes with a content type from its extension. Responses carry `Content-Security-Policy: sandbox` and " +
      "`X-Content-Type-Options: nosniff` so HTML and SVG files can't run scripts. Single `Range: bytes=` requests are supported (206), " +
      "so audio and video can seek.",
    query: [pathQuery],
    responses: {
      "200": { description: "The whole file.", contentType: "application/octet-stream", schema: { type: "string", format: "binary" } },
      "206": { description: "The requested byte range.", contentType: "application/octet-stream", schema: { type: "string", format: "binary" } },
      ...pathErrors,
      "404": error("Project or file not found."),
      "416": { description: "The range is outside the file." },
      "422": error("The `path` query parameter is missing."),
    },
  },
  "GET /projects/{id}/terminals": {
    summary: "List terminals",
    description: "Lists the project's terminal sessions, oldest first, including ones whose process has exited.",
    responses: {
      "200": {
        description: "Terminal sessions.",
        schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: ref("TerminalSession") } } },
      },
      "404": error("Project not found."),
    },
  },
  "POST /projects/{id}/terminals": {
    summary: "Open a terminal",
    description:
      "Starts a pseudo-terminal. `shell` runs the user's login shell in `cwd`. `run` runs the file at `run` in its own directory: " +
      "`.sh`/`.bash` with bash, `.py` with python3, `.js`/`.mjs`/`.ts`/`.mts` with node. A `run` session is kept after it exits so its output can be read.",
    body: {
      required: true,
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["shell", "run"], description: "Defaults to `run` when `run` is given, else `shell`." },
          cwd: { type: "string", description: "Directory for a shell, relative to the project folder. Defaults to the project root." },
          run: { type: "string", description: "File to run, relative to the project folder.", examples: ["code/app.py"] },
          cols: { type: "integer", minimum: 1, maximum: 1000, default: 80 },
          rows: { type: "integer", minimum: 1, maximum: 1000, default: 24 },
        },
      },
    },
    responses: {
      "201": { description: "The session was started.", schema: ref("TerminalSession") },
      "400": error("The file type can't be run, `cwd` is not a directory, or a path is outside the project folder."),
      "404": error("Project or file not found."),
      "422": error("The body is invalid."),
    },
  },
  "GET /projects/{id}/terminals/{tid}/stream": {
    summary: "Stream terminal output",
    description:
      "Streams a session's output as [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html). " +
      "The first `data` event replays the last ~200 KB of output; later `data` events carry new output as `{data}`. " +
      "When the process ends an `exit` event `{exit_code}` is sent and the stream closes.",
    pathParams: tidParam,
    responses: {
      "200": { description: "Event stream.", contentType: "text/event-stream", schema: { type: "string" } },
      "404": error("Project or terminal not found."),
    },
  },
  "POST /projects/{id}/terminals/{tid}/input": {
    summary: "Send terminal input",
    description: "Writes keystrokes (or any text) to the session's terminal.",
    pathParams: tidParam,
    body: { required: true, schema: { type: "object", required: ["data"], properties: { data: { type: "string" } } } },
    responses: {
      "204": { description: "Written." },
      "404": error("Project or terminal not found."),
      "409": error("The process has exited."),
      "422": error("The body is invalid."),
    },
  },
  "POST /projects/{id}/terminals/{tid}/resize": {
    summary: "Resize a terminal",
    pathParams: tidParam,
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["cols", "rows"],
        properties: { cols: { type: "integer", minimum: 1, maximum: 1000 }, rows: { type: "integer", minimum: 1, maximum: 1000 } },
      },
    },
    responses: {
      "204": { description: "Resized (ignored when the process has exited)." },
      "404": error("Project or terminal not found."),
      "422": error("The body is invalid."),
    },
  },
  "DELETE /projects/{id}/terminals/{tid}": {
    summary: "Close a terminal",
    description: "Removes the session and ends its process (SIGHUP, then SIGKILL after 2 seconds).",
    pathParams: tidParam,
    responses: {
      "204": { description: "Closed." },
      "404": error("Project or terminal not found."),
    },
  },
  "GET /projects/{id}/dev-server": {
    summary: "Get dev server status",
    description: "Returns the dev server configuration, a suggested command, and whether it is running.",
    responses: { "200": devServer("Dev server status."), "404": error("Project not found.") },
  },
  "PUT /projects/{id}/dev-server": {
    summary: "Configure the dev server",
    description: "Updates any of the command, its directory and the URL to open. `null` or an empty string clears the command or URL.",
    body: {
      required: true,
      schema: {
        type: "object",
        properties: {
          command: { type: ["string", "null"], maxLength: 4000, examples: ["npm run dev"] },
          cwd: { type: "string", description: "Directory relative to the project folder.", examples: ["code"] },
          url: { type: ["string", "null"], description: "http(s) URL to open instead of the detected one." },
        },
      },
    },
    responses: {
      "200": devServer("Updated status."),
      "400": error("`cwd` is outside the project folder."),
      "404": error("Project not found."),
      "422": error("A field is invalid."),
    },
  },
  "POST /projects/{id}/dev-server/start": {
    summary: "Start the dev server",
    description:
      "Runs the configured command (or the suggested one) with `$SHELL -lc` in a `devserver` terminal session. " +
      "Does nothing when it is already running.",
    responses: {
      "200": devServer("Status after starting."),
      "400": error("No command is configured or suggested, or its directory doesn't exist."),
      "404": error("Project not found."),
    },
  },
  "POST /projects/{id}/dev-server/stop": {
    summary: "Stop the dev server",
    description: "Ends the dev server process and waits for it to exit. Its terminal session is kept so the output can still be read.",
    responses: { "200": devServer("Status after stopping."), "404": error("Project not found.") },
  },
};
