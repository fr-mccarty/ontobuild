# OntoKit Full

OntoKit as a single local Node app. It combines the Next.js frontend from `ontokit-web` with
the API from the FastAPI `ontokit-api`, which now runs inside the same Next server under
`/api/v1`. The app is local-only and single-user, with no login. Each project's ontology is
stored in its own bare git repository, and metadata is stored in SQLite.

## Sources

This project was rebuilt from two upstream projects:

| Project | Repository | Local copy used | Commit (branch `dev`) |
|---|---|---|---|
| ontokit-web (Next.js frontend) | https://github.com/CatholicOS/ontokit-web | `~/ontokit-web` | `c5d3ae0` |
| ontokit-api (FastAPI backend) | https://github.com/CatholicOS/ontokit-api | `~/ontokit-api` | `c8383ad` |

- The frontend (`app/`, `components/`, `lib/`, `messages/`, `__tests__/`) is copied from
  ontokit-web, with authentication and the dropped features removed.
- The API (`server/`) is a TypeScript port of ontokit-api. It keeps the same `/api/v1` paths
  and JSON shapes, so the frontend's API clients work unchanged. Each route file in
  `server/routes/` corresponds to the matching `ontokit/api/routes/*.py` file in ontokit-api.
  The services in `server/linter.ts` and `server/quality.ts` port `services/linter.py`,
  `consistency_service.py` and `duplicate_detection_service.py`.
- Neither source repository was modified.

## Requirements

- Node.js 24 or newer (uses the built-in `node:sqlite`, no native build step)
- `git` 2.38 or newer on your `PATH` (branch merges use `git merge-tree --write-tree`)

No Postgres, Redis, MinIO, Zitadel or Docker is needed.

## Run

```bash
npm install
npm run dev          # development server on http://localhost:3000
```

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
  comments, lint runs and issues, change events, background jobs, user settings)
- `data/repos/<projectId>.git`: bare git repository holding the project's ontology file
  (Turtle). Each branch is a git branch, and each save is a commit.

To reset everything, stop the server and delete `data/`.

## Architecture

```
browser ──> Next.js (App Router pages, React Query)
              │  fetch("/api/v1/...")   (same origin)
              ▼
            app/api/v1/[[...path]]/route.ts  ──>  Hono app (server/app.ts)
                                                    ├── server/routes/*.ts
                                                    ├── SQLite (node:sqlite)   data/ontokit.db
                                                    ├── git CLI (bare repos)   data/repos/*.git
                                                    └── in-process jobs (lint, quality, normalization, index)
```

```
app/, components/, lib/, messages/, public/   frontend (Next.js App Router)
app/api/v1/[[...path]]/route.ts               forwards every /api/v1/* request to Hono
server/app.ts                                 Hono app (basePath /api/v1), error handler, /health, /openapi.json
server/routes/<domain>.ts                     projects, ontology, pullRequests, lint, quality,
                                              normalization, analytics, userSettings
server/schema/*.sql                           SQLite schema, applied at startup (idempotent)
server/db.ts                                  SQLite access helpers
server/git.ts                                 bare-repo helper using the git CLI (no working tree)
server/rdf.ts                                 parse Turtle, RDF/XML, JSON-LD, N-Triples; serialize Turtle
server/ontology.ts                            load a branch into an N3 store (cached by commit), commit edits
server/linter.ts  quality.ts                  lint rules, consistency checks, duplicate detection
server/jobs.ts                                in-process background jobs (replaces ARQ/Redis)
server/user.ts                                the fixed local user (owner of every project)
```

- The API keeps the URL paths and the request and response JSON of the old FastAPI service,
  so the frontend's `lib/api/*` clients work unchanged. They call the relative `/api/v1` by
  default. Set `NEXT_PUBLIC_API_URL` to point them at another server.
- Every request acts as the local user, who owns every project, so the UI always shows the
  owner/editor view.
- Websockets were replaced by polling the existing status endpoints (lint status, index
  status, quality and normalization jobs).
- The OpenAPI document is served at `/api/v1/openapi.json` and rendered at `/api-docs`.

## What was dropped compared with ontokit-web + ontokit-api

These features were removed from both the API and the UI:

- Login and authentication (Zitadel, next-auth, sign-in pages, session guard, user menu)
- Project members, roles, join requests and ownership transfer
- The suggestions workflow for non-editor roles
- Notifications and user search
- GitHub integration: create from GitHub, GitHub tokens, webhooks, remote sync
- Embeddings, semantic search, similar entities and rank-suggestions
- Real-time collaboration websockets and the Turtle LSP websocket client
- The sitemap beacon

The Developer editor mode was also removed from the UI: the Standard/Developer switch and the
Turtle source editor are gone, and the form-based editor is the only editor.

## Behaviour changes compared with the original

- **Adding an entity saves immediately.** In ontokit-web, "Add class / property / individual"
  only appended Turtle to the editor's in-memory source and showed the entity as "Unsaved".
  It was persisted only by the original app's source editor Save button or as a side effect
  of the next form edit. Here the Add dialog commits right away ("Add class X").
- **Deleting a class works.** The editor called `DELETE /ontology/classes/:iri`, which the
  old API never implemented.
- Background jobs (lint, quality, normalization, reindex) run in-process, and the UI polls
  status endpoints instead of using websockets.

## Quick API check

```bash
curl -s localhost:3000/api/v1/health
curl -s -X POST localhost:3000/api/v1/projects/import -F file=@my-ontology.ttl -F is_public=false
curl -s localhost:3000/api/v1/projects
curl -s -H 'Accept: text/turtle' localhost:3000/api/v1/projects/<id>/source
```

Imports accept Turtle, N-Triples, N3, RDF/XML (`.owl`, `.rdf`, `.xml`) and JSON-LD. The
imported file is converted to Turtle before it is committed.
