# OntoBuilder

OntoBuilder is a local, single-user editor for OWL/RDF ontologies. It runs as one Node app: a
Next.js frontend and an HTTP API (`/api/v1`) served by the same Next server. There is no login.
Each project is a folder holding its ontology and its code, kept in its own git repository,
and metadata is stored in SQLite. Everything runs on your machine except the optional editor agent, which calls
OpenRouter (see [Editor agent](#editor-agent)).

![The OntoBuilder editor showing a class form, the class tree and the agent panel](docs/screenshot.png)

## Features

- **Projects.** Create an empty project or import an ontology in Turtle (`.ttl`), N3,
  N-Triples (`.nt`), N-Quads (`.nq`), TriG, RDF/XML (`.owl`, `.rdf`, `.xml`) or JSON-LD
  (`.jsonld`, `.json`). Imports are converted to Turtle before they are committed.
- **Form-based editor.** Browse classes, properties and individuals, and add, edit and
  delete entities through forms. Every change is saved immediately as a git commit.
- **Branches and pull requests.** Work on branches, open pull requests, review, comment and
  merge.
- **Health checks.** Lint rules, consistency checks, duplicate detection and normalization,
  run as background jobs, with results shown in the editor's **Health** tab.
- **History and analytics.** Per-entity change history, project activity and the most
  frequently edited entities.
- **Imports.** The **Imports** button in the editor's sub-heading adds `owl:imports` to the
  ontology: pick another OntoBuilder project or paste any ontology IRI. Imports are followed
  transitively (for example general principles → Node → your project), and imported classes
  appear read-only in the class tree, where your own classes can subclass them.
- **Code and terminals.** Each project has a `code/` folder. The **Files** tab in the right
  sidebar browses and searches the project folder. **Space** opens a Quick View of the selected
  file (code, text, Markdown, images, PDF, CSV, Word documents, audio and video) and closes it
  again. Files ending in `.sh`, `.py`, `.ts` or `.js` run from the same panel, in a tabbed
  terminal panel at the bottom of the editor that can also open interactive shells.
- **Dev server and View in Browser.** The run menu in the sub-heading starts and stops a dev
  server command for the project, and **View in Browser** opens the URL it reports.
- **GitHub.** Link a project to a GitHub (or other git) remote, then fetch, pull and push, or
  create the repository with the `gh` CLI. Sign-in uses your existing git credentials, SSH keys
  or `gh auth login`; OntoBuilder stores no tokens.
- **Run as prompt, with approval.** The ▶ button next to any text value puts that text in the
  agent's message box (it is not sent until you send it). A green dot means the text was
  approved: it reached the default branch through a merged pull request with an approving
  review. Otherwise OntoBuilder asks before using it. This lets a team agree on a prompt, as part of
  the ontology, before anyone runs it.
- **Editor agent.** An optional LLM chat in the editor that can read and edit the open project
  (see [Editor agent](#editor-agent)).
- **Documented API.** Every operation is described in an OpenAPI 3.1 document served at
  `/api/v1/openapi.json` and rendered at `/api-docs`.

All text values (labels, comments, definitions, annotations) are plain strings without
language tags. Tags are removed when a file is imported or a change is committed.

## Origins

OntoBuilder is derived from two projects by CatholicOS:
[ontokit-web](https://github.com/CatholicOS/ontokit-web), a Next.js frontend, and
[ontokit-api](https://github.com/CatholicOS/ontokit-api), a FastAPI backend. The frontend code
in this repository started from ontokit-web, and the API in `server/` started as a TypeScript
port of ontokit-api. Both have since been reworked into a standalone local app. Credit for
OntoKit goes to its authors, Fr. John R. D'Orazio ([@JohnRDOrazio](https://github.com/JohnRDOrazio))
and Damien Riehl ([@damienriehl](https://github.com/damienriehl)), and the other contributors
to ontokit-web and ontokit-api.

## Requirements

- Node.js 24 or newer (uses the built-in `node:sqlite`, no native build step). Use 24.15 or
  newer to avoid `EBADENGINE` warnings from the test dependencies (jsdom) during `npm install`.
  The app itself runs on any 24.x.
- `git` 2.38 or newer on your `PATH` (branch merges use `git merge-tree --write-tree`)
- Optional: an [OpenRouter](https://openrouter.ai) API key for the editor agent

No database server or Docker is needed.

## Installation and getting started

```bash
git clone <this repository> ontobuilder
cd ontobuilder
npm install
npm run dev          # development server on http://localhost:3000 (this machine only)
```

Open http://localhost:3000, choose **New project**, and either create an empty project or
import an ontology file. The `data/` directory is created on first start, so there is no
database setup step.

Production build:

```bash
npm run build
npm start            # http://localhost:3000 (set PORT to change it)
```

Terminals use `node-pty`, which ships prebuilt binaries for macOS and Windows. On Linux,
`npm install` compiles it, so you need Python 3 and a C++ toolchain (`build-essential`).

Other scripts: `npm run type-check`, `npm run lint`, `npm test` (vitest).

The `dev` and `start` scripts set `NODE_OPTIONS` inline to hide Node's SQLite
ExperimentalWarning. That syntax works on macOS and Linux. On Windows, run `npx next dev` or
`npx next start` directly.

## Data

All runtime data lives in `./data`, which is gitignored. Set `ONTOBUILDER_DATA_DIR` to store it
somewhere else.

- `data/import-cache/`: cached copies of imported ontologies fetched from the web
- `data/ontobuilder.db`: SQLite database (projects, branch metadata, pull requests, reviews,
  comments, lint runs, issues and per-project lint configs, quality results, normalization
  runs, entity change events, background jobs, user and agent settings)
- `data/projects/<folder>/`: one folder per project, named after the project when it is
  created. It is a normal git repository: `ontology.ttl` (Turtle) and a `code/` folder for the
  project's code. Each branch is a git branch, and each save in the editor is a commit.
  Edits to the checked-out branch are written to the folder too. If `ontology.ttl` has
  uncommitted changes there, the editor refuses to save over them until you commit or
  discard them.

Projects created before project folders existed were stored as bare repositories in
`data/repos/<projectId>.git`. They are moved into `data/projects/` automatically the first
time the server handles a request.

To reset everything, stop the server and delete `data/`.

## Editor agent

The **Agent** tab in the editor's right sidebar is a chat with an LLM that can read and edit the
open project. It can search and inspect entities, create, update and delete them, edit the
Turtle source directly, run lint, consistency and duplicate checks and fix what they find, and
work with branches and pull requests. Each change is a normal commit on the current branch.
It can also read the files in the project folder and, when allowed, write code under `code/`
and run shell commands there. The agent sends ontology content, and any files it reads, to
OpenRouter.

Two toggles above the message box control what the agent may change:

- **Edit Ontology** (on by default): changes to the ontology, branches, pull requests and
  project settings.
- **Edit Code** (off by default): writing and deleting files in the project folder and running
  commands with `bash -lc` there (60 s timeout by default, at most 300 s).

With both off the agent is read-only. The agent can open imported ontologies to read them,
but not change them. The choice is remembered in the browser and sent with
every message. The server enforces it: tools that aren't allowed are hidden from the model and
refused if it calls them anyway, and the agent is told which toggle to ask you to turn on.
`ontology.ttl` is changed only through the ontology tools, never as a plain file. Note that a
command run with Edit Code on runs as your user and can reach anything you can.

**Run as prompt** elsewhere in the editor puts text in the agent's message box without sending
it, with a "From:" chip naming its source.

To enable it, add `OPENROUTER_API_KEY=sk-or-...` to `.env.local` in the project root. Choose
the model, reasoning effort and custom instructions under **Settings → Agent**.

## Architecture

```
browser ──> Next.js (App Router pages, React Query)
              │  fetch("/api/v1/...")   (same origin)
              ▼
            app/api/v1/[[...path]]/route.ts  ──>  Hono app (server/app.ts)
                                                    ├── server/routes/*.ts
                                                    ├── SQLite (node:sqlite)   data/ontobuilder.db
                                                    ├── git CLI                data/projects/<folder>/
                                                    ├── in-process jobs (lint, quality, normalization, index)
                                                    └── editor agent (server/agent) ──> OpenRouter
```

```
app/, components/, lib/, public/             frontend (Next.js App Router)
app/api/v1/[[...path]]/route.ts               forwards every /api/v1/* request to Hono
server/app.ts                                 Hono app (basePath /api/v1), error handler, /health, /openapi.json
server/http.ts                                shared request and response helpers
server/routes/<domain>.ts                     projects, ontology, pullRequests, lint, quality,
                                              normalization, analytics, userSettings, agent
server/openapi/                               OpenAPI 3.1 spec built from the Hono route table
                                              (summaries, parameters and schemas per operation)
server/agent/                                 editor agent: chat loop (OpenRouter via the openai SDK),
                                              tools, system prompt, settings, prefixed-name handling
server/schema/*.sql                           SQLite schema, applied at startup (idempotent)
server/db.ts                                  SQLite access helpers
server/git.ts                                 repository helper using the git CLI; keeps the project folder
                                              in step with commits to the checked-out branch
server/workspace.ts                           project folders: naming, lookup, migration from bare repos
server/localOnly.ts                           Host and Origin checks for the API
server/workspaceFiles.ts                      safe file access inside a project folder
server/terminals.ts  devServer.ts             terminal sessions (node-pty) and the dev server
server/imports.ts                             owl:imports resolution (local projects, fetched IRIs, cache)
server/github.ts  provenance.ts               git remotes (fetch, pull, push), prompt approval from PR reviews
server/rdf.ts                                 parse Turtle, N3, N-Triples, N-Quads, TriG, RDF/XML, JSON-LD;
                                              serialize Turtle
server/ontology.ts                            load a branch into an N3 store (cached by commit), commit edits
server/linter.ts  quality.ts                  lint rules, consistency checks, duplicate detection
server/jobs.ts                                in-process background jobs
server/user.ts                                the fixed local user (author of every commit and comment)
```

- The frontend's `lib/api/*` clients call the relative `/api/v1` by default. Set
  `NEXT_PUBLIC_API_URL` to point them at another server.
- The servers listen on `127.0.0.1` only, and the API rejects requests whose `Host` isn't a
  loopback name (DNS rebinding) and browser requests from other origins (CSRF), since it can
  edit files without a login. Set `ONTOBUILDER_ALLOWED_HOSTS` or `ONTOBUILDER_ALLOWED_ORIGINS`
  (comma-separated) to allow more, for example behind a reverse proxy.
- Every request acts as the single local user. There are no roles or permission checks, so
  every action is always available.
- Background jobs (lint, quality, normalization, reindex) run in-process, and the UI polls
  their status endpoints.
- Ontology endpoints take the branch as a `?branch=` query parameter.
- The OpenAPI document is generated from the registered routes. Tests fail if an operation has
  no documentation.

## Quick API check

```bash
curl -s localhost:3000/api/v1/health
curl -s -X POST localhost:3000/api/v1/projects/import -F file=@my-ontology.ttl
curl -s localhost:3000/api/v1/projects
curl -s -H 'Accept: text/turtle' localhost:3000/api/v1/projects/<id>/source
```

## License

MIT. See [LICENSE](LICENSE).
