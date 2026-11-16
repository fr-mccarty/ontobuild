# OntoKit Monorepo

OntoKit is a local, single-user editor for OWL/RDF ontologies. It runs as one Node app: a
Next.js frontend and an HTTP API (`/api/v1`) served by the same Next server. There is no login.
Each project's ontology is stored in its own bare git repository, and metadata is stored in
SQLite. Everything runs on your machine except the optional editor agent, which calls
OpenRouter (see [Editor agent](#editor-agent)).

## Features

- **Projects.** Create an empty project or import an ontology in Turtle, N3, N-Triples,
  N-Quads, TriG, RDF/XML or JSON-LD. The ontology is stored as Turtle.
- **Form-based editor.** Browse classes, properties and individuals, and add, edit and
  delete entities through forms. Every change is saved immediately as a git commit.
- **Branches and pull requests.** Work on branches, open pull requests, review, comment and
  merge.
- **Health checks.** Lint rules, consistency checks, duplicate detection and normalization,
  run as background jobs, with results shown in the editor's **Health** tab.
- **History and analytics.** Per-entity change history, project activity and the most
  frequently edited entities.
- **Editor agent.** An optional LLM chat in the editor that can read and edit the open project
  (see [Editor agent](#editor-agent)).
- **Documented API.** Every operation is described in an OpenAPI 3.1 document served at
  `/api/v1/openapi.json` and rendered at `/api-docs`.

All text values (labels, comments, definitions, annotations) are plain strings without
language tags. Tags are removed when a file is imported or a change is committed.

## Origins

OntoKit Monorepo is derived from two projects by CatholicOS:
[ontokit-web](https://github.com/CatholicOS/ontokit-web), a Next.js frontend, and
[ontokit-api](https://github.com/CatholicOS/ontokit-api), a FastAPI backend. The frontend code
in this repository started from ontokit-web, and the API in `server/` started as a TypeScript
port of ontokit-api. Both have since been reworked into a standalone local app.

## Requirements

- Node.js 24 or newer (uses the built-in `node:sqlite`, no native build step). Use 24.15 or
  newer to avoid `EBADENGINE` warnings from the test dependencies (jsdom) during `npm install`.
  The app itself runs on any 24.x.
- `git` 2.38 or newer on your `PATH` (branch merges use `git merge-tree --write-tree`)
- Optional: an [OpenRouter](https://openrouter.ai) API key for the editor agent

No database server or Docker is needed.

## Installation and getting started

```bash
git clone <this repository> ontokit-monorepo
cd ontokit-monorepo
npm install
npm run dev          # development server on http://localhost:3000
```

Open http://localhost:3000, choose **New project**, and either create an empty project or
import an ontology file. The `data/` directory is created on first start, so there is no
database setup step.

To use the editor agent, add an OpenRouter API key as described in
[Editor agent](#editor-agent). Everything else works without one.

Production build:

```bash
npm run build
npm start            # http://localhost:3000 (set PORT to change it)
```

Other scripts: `npm run type-check`, `npm run lint`, `npm test` (vitest).

The `dev` and `start` scripts set `NODE_OPTIONS` inline to hide Node's SQLite
ExperimentalWarning. That syntax works on macOS and Linux. On Windows, run `npx next dev` or
`npx next start` directly.

## Data

All runtime data lives in `./data`, which is gitignored. Set `ONTOKIT_DATA_DIR` to store it
somewhere else.

- `data/ontokit.db`: SQLite database (projects, branch metadata, pull requests, reviews,
  comments, lint runs, issues and per-project lint configs, quality results, normalization
  runs, entity change events, background jobs, user and agent settings)
- `data/repos/<projectId>.git`: bare git repository holding the project's ontology file
  (Turtle). Each branch is a git branch, and each save is a commit.

To reset everything, stop the server and delete `data/`.

## Editor agent

The editor has a right sidebar with two tabs, **Agent** and **Health**. The Agent tab is a
streaming chat with an LLM that can read and edit the open project. It has 35 tools covering
entity create, update, delete and selection, direct Turtle edits, lint, consistency checks,
duplicate detection, normalization, branches and pull requests. Each change it makes is a normal
commit on the current branch, and the editor refreshes in place. The agent receives the current
page context (project, branch, selected entity) and sends ontology content to OpenRouter.

In practice, you can ask the agent to explore, change and maintain the ontology. It can search
entities, walk the class tree, read an entity's full definition and find everything that
references it before a rename or delete. It can create, update and delete classes, properties
and individuals, including labels, comments, parents, domains, ranges and annotations. For
constructs the forms don't cover (restrictions, prefixes, the ontology header), it edits the
Turtle source directly. It can select an entity in the editor to show it to you, list recent
commits and diff two commits or branches. It can run lint (and change the lint configuration),
consistency checks and duplicate detection, then fix what they find, and normalize the source
with an optional dry run. It can also create branches and work on one other than the one open
in the editor, and open, comment on, merge or close pull requests. IRIs can be given as
prefixed names (`:Pizza`, `ex:Pizza`, `owl:Thing`), and new entities are written with short
names using the file's prefixes.

### Where to put the OpenRouter API key

The key is read only from the environment variable `OPENROUTER_API_KEY`. It is never entered in
or shown by the UI. Put it in `.env.local` at the project root (the directory you run
`npm run dev` from, next to `package.json`):

```bash
# ontokit-monorepo/.env.local
OPENROUTER_API_KEY=sk-or-...
```

- Create a key at https://openrouter.ai/keys.
- `.env.local` is gitignored, so the key is never committed.
- `npm run dev` picks up changes to `.env.local` without a restart. With `npm start`, restart
  the server after adding or changing the key. Exporting `OPENROUTER_API_KEY` in your shell
  also works.
- Open **Settings → Agent** (`/settings`) to check it. It shows *Configured* or *Not
  configured* and the full path of the `.env.local` file the server reads. **Test connection**
  checks the key against OpenRouter.

On the same settings page you can choose the model (default `anthropic/claude-opus-5.5`, from
OpenRouter's model list), the reasoning effort (default `high`) and custom instructions that are
added to the system prompt. These settings are stored in SQLite. The model and effort can also
be changed per chat from the agent panel.

## Architecture

```
browser ──> Next.js (App Router pages, React Query)
              │  fetch("/api/v1/...")   (same origin)
              ▼
            app/api/v1/[[...path]]/route.ts  ──>  Hono app (server/app.ts)
                                                    ├── server/routes/*.ts
                                                    ├── SQLite (node:sqlite)   data/ontokit.db
                                                    ├── git CLI (bare repos)   data/repos/*.git
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
server/git.ts                                 bare-repo helper using the git CLI (no working tree)
server/rdf.ts                                 parse Turtle, N3, N-Triples, N-Quads, TriG, RDF/XML, JSON-LD;
                                              serialize Turtle
server/ontology.ts                            load a branch into an N3 store (cached by commit), commit edits
server/linter.ts  quality.ts                  lint rules, consistency checks, duplicate detection
server/jobs.ts                                in-process background jobs
server/user.ts                                the fixed local user (author of every commit and comment)
```

- The frontend's `lib/api/*` clients call the relative `/api/v1` by default. Set
  `NEXT_PUBLIC_API_URL` to point them at another server.
- Every request acts as the single local user. There are no roles or permission checks, so
  every action is always available.
- Background jobs (lint, quality, normalization, reindex) run in-process, and the UI polls
  their status endpoints.
- Ontology endpoints take the branch as a `?branch=` query parameter.
- The OpenAPI document is generated from the registered routes, served at
  `/api/v1/openapi.json` and rendered at `/api-docs`. Tests fail if an operation has no
  documentation.

## Quick API check

```bash
curl -s localhost:3000/api/v1/health
curl -s -X POST localhost:3000/api/v1/projects/import -F file=@my-ontology.ttl
curl -s localhost:3000/api/v1/projects
curl -s -H 'Accept: text/turtle' localhost:3000/api/v1/projects/<id>/source
```

Imports accept Turtle (`.ttl`), N3, N-Triples (`.nt`), N-Quads (`.nq`), TriG, RDF/XML (`.owl`,
`.rdf`, `.xml`) and JSON-LD (`.jsonld`, `.json`). The imported file is converted to Turtle, with
language tags removed, before it is committed.

## License

MIT. See [LICENSE](LICENSE).
