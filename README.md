# OntoKit Monorepo

OntoKit as a single local Node app. It combines the Next.js frontend from `ontokit-web` with
the API from the FastAPI `ontokit-api`, which now runs inside the same Next server under
`/api/v1`. The app is single-user, with no login. Each project's ontology is stored in its own
bare git repository, and metadata is stored in SQLite. Everything runs on your machine except
the optional editor agent, which calls OpenRouter (see [Editor agent](#editor-agent)).

## Sources

This project was rebuilt from two upstream projects:

| Project | Repository | Local copy used | Commit (branch `dev`) |
|---|---|---|---|
| ontokit-web (Next.js frontend) | https://github.com/CatholicOS/ontokit-web | `~/ontokit-web` | `c5d3ae0` |
| ontokit-api (FastAPI backend) | https://github.com/CatholicOS/ontokit-api | `~/ontokit-api` | `c8383ad` |

- The frontend (`app/`, `components/`, `lib/`, `__tests__/`) is copied from ontokit-web, with
  authentication, roles and the dropped features removed.
- The API (`server/`) started as a TypeScript port of ontokit-api, with the same `/api/v1`
  paths and JSON shapes. Most route files in `server/routes/` still correspond to the matching
  `ontokit/api/routes/*.py` file in ontokit-api, and `server/linter.ts` and `server/quality.ts`
  port `services/linter.py`, `consistency_service.py` and `duplicate_detection_service.py`.
  The API has since changed in places (see [API changes](#api-changes-compared-with-ontokit-api)),
  and `/api/v1/openapi.json` is the reference for the current contract.
- Neither source repository was modified.

## Requirements

- Node.js 24 or newer (uses the built-in `node:sqlite`, no native build step). Use 24.15 or
  newer to avoid `EBADENGINE` warnings from the test dependencies (jsdom) during `npm install`.
  The app itself runs on any 24.x.
- `git` 2.38 or newer on your `PATH` (branch merges use `git merge-tree --write-tree`)
- Optional: an [OpenRouter](https://openrouter.ai) API key for the editor agent

No Postgres, Redis, MinIO, Zitadel or Docker is needed.

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
server/jobs.ts                                in-process background jobs (replaces ARQ/Redis)
server/user.ts                                the fixed local user (author of every commit and comment)
```

- The frontend's `lib/api/*` clients call the relative `/api/v1` by default. Set
  `NEXT_PUBLIC_API_URL` to point them at another server.
- Every request acts as the single local user. There are no roles or permission checks, so
  every action is always available.
- Websockets were replaced by polling the existing status endpoints (lint status, index
  status, quality and normalization jobs).
- The OpenAPI document is generated from the registered routes, served at
  `/api/v1/openapi.json` and rendered at `/api-docs`. Tests fail if an operation has no
  documentation.

## What was dropped compared with ontokit-web + ontokit-api

These features were removed from both the API and the UI:

- Login and authentication (Zitadel, next-auth, sign-in pages, session guard, user menu)
- Project members, roles, permissions, join requests and ownership transfer
- Exemplar projects
- The suggestions workflow for non-editor roles
- Notifications and user search
- GitHub integration: create from GitHub, GitHub tokens, webhooks, remote sync
- Embeddings, semantic search, similar entities and rank-suggestions
- Real-time collaboration websockets and the Turtle LSP websocket client
- The sitemap beacon
- Language tags and the language dimension (see below)
- The project viewer page and the public/private project setting. The editor is the only view
  of a project (`/projects/<id>/editor` redirects to `/projects/<id>`). The API still stores
  an optional `is_public` flag, but the UI no longer uses it.

The Developer editor mode was also removed from the UI: the Standard/Developer switch and the
Turtle source editor are gone, and the form-based editor is the only editor. The pull requests
link moved from the editor toolbar into the **Share** menu.

## Behaviour changes compared with the original

- **Adding an entity saves immediately.** In ontokit-web, "Add class / property / individual"
  only appended Turtle to the editor's in-memory source and showed the entity as "Unsaved".
  It was persisted only by the original app's source editor Save button or as a side effect
  of the next form edit. Here the Add dialog commits right away ("Add class X").
- **Deleting a class works.** The editor called `DELETE /ontology/classes/:iri`, which the
  old API never implemented.
- **All text is plain strings, with no language tags.** Labels, comments, definitions and
  annotation values are stored as plain literals. Tags are removed on every commit path,
  including imports and pull request merges, so importing `"Pizza"@en` stores `"Pizza"`, and
  values that differed only by language tag become duplicates. The language picker is gone,
  label preferences no longer have a language, and the lint rules about language tags
  (label per language, missing language tag, redundant regional label, missing English label)
  were removed. Normalization reports how many tags it removed.
- **Updating an entity replaces only that entity's exact Turtle block.** Updates no longer
  delete the entity that follows it in the file.
- **Prefixed names are accepted for IRIs** in agent tool inputs (`:Pizza`, `ex:Pizza`,
  `owl:Thing`), and new entities are written with short names using the file's prefixes.
- **The editor layout adapts to narrow windows.** Below the `lg` breakpoint the right sidebar
  overlays the editor and only one sidebar is open at a time. Sub-header controls move into
  the Share menu as the window narrows.
- Background jobs (lint, quality, normalization, reindex) run in-process, and the UI polls
  status endpoints instead of using websockets.

## API changes compared with ontokit-api

- New `/agent/*` endpoints: `GET /agent/status`, `GET /agent/models`, `GET` and
  `PATCH /agent/settings`, `POST /agent/test` and `POST /projects/:id/agent/chat`
  (server-sent events).
- `DELETE /ontology/classes/:iri` is implemented.
- The branch checkout route was removed. Ontology endpoints take the branch as a `?branch=`
  query parameter.
- Unknown branches, IRIs and jobs, and deleting an unknown branch, return 404.
- Queued lint and normalization jobs return 202, and their responses include the run id,
  branch and totals.
- Label and annotation values are returned as `{ value }`, with no `lang` field.
- Project responses no longer include `owner_id`, `owner`, `member_count`, `user_role` or
  `is_superadmin`.
- `is_public` is optional on import and defaults to `false`.
- Requests need no `Authorization` header, and the API ignores one if sent.

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

MIT, the same license as the upstream ontokit-web and ontokit-api projects. See
[LICENSE](LICENSE).
