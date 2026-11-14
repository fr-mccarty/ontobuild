# OntoKit Full — rebuild plan (shared by all agents)

Sources (read-only, never modify): `/Users/joshmccarty/ontokit-web` (Next.js frontend) and
`/Users/joshmccarty/ontokit-api` (FastAPI backend). Target: `/Users/joshmccarty/ontokit-full`.

## Goal
One Node project, run locally with `npm install && npm run dev` (or `npm run build && npm start`)
from `ontokit-full/`. Same user-facing behaviour as the old web+api pair, minus login.
Stack: React (Next.js App Router, reused from ontokit-web) + Node (API inside the same Next
server) + SQLite. Local-only, single user, **no authentication**.

## Architecture
```
ontokit-full/
  app/ components/ lib/ messages/ ...   # copied from ontokit-web (frontend)
  app/api/v1/[[...path]]/route.ts       # single catch-all: hands every /api/v1/* request to Hono
  server/
    app.ts            # Hono app (basePath /api/v1), registers route modules, JSON error handler
    db.ts             # node:sqlite DatabaseSync singleton, schema creation (CREATE TABLE IF NOT EXISTS), helpers
    git.ts            # bare-repo helper using the `git` CLI (execFile), no working tree
    rdf.ts            # parse (turtle, rdf/xml, json-ld, n-triples) -> N3 Store; serialize to turtle
    ontology.ts       # load a project's ontology (branch) into an N3 Store, cached by commit sha
    jobs.ts           # in-process background jobs (replaces ARQ/Redis): run async fn, track status in SQLite
    user.ts           # the fixed local user: { id: "local-user", name: "Local User", email: "local@localhost" }
    routes/<domain>.ts  # one file per domain, each exports a Hono sub-app; registered in server/app.ts
  data/               # runtime data (gitignored): ontokit.db, repos/<projectId>.git
```
- URL paths, query params, request and response JSON shapes **must match the old FastAPI API**
  (snake_case fields etc.) so the existing frontend `lib/api/*.ts` clients work unchanged.
  Read the matching `ontokit-api/ontokit/api/routes/*.py`, `schemas/*.py`, `services/*.py` for
  shapes. Simplify internals freely; keep the contract.
- Same-origin: the frontend calls `/api/v1/...` relative (NEXT_PUBLIC_API_URL defaults to "").
- No Postgres, Redis, MinIO, Zitadel, ARQ. Files live in git; metadata lives in SQLite.
- Data dir is `process.env.ONTOKIT_DATA_DIR || <cwd>/data`.
- Background work (lint runs, index, quality, normalization) is in-process async via `server/jobs.ts`;
  websockets are replaced by polling of the existing status endpoints.
- Use `node:sqlite` (`DatabaseSync`, built into Node 24, no native build). IDs are UUID strings
  (`crypto.randomUUID()`), timestamps ISO-8601 UTC strings, JSON columns stored as TEXT.
- Every request acts as the local user, who is the owner of every project (role "owner").
  Endpoints that return `current_user`/`user_role`/permissions return owner/full permissions.

## Feature scope
KEEP (port to Node): projects (CRUD, create from upload/import, source get/save), ontology tree,
class/property/individual detail, search, index-status/reindex, entity references, revisions
(history, file at ref, diff), branches (list/create/delete/checkout/preference), pull requests
(+ comments, reviews, diff, commits, merge, close/reopen, pr-settings), lint (rules, levels,
config, run, runs, issues, status), quality (consistency check, duplicates), normalization,
analytics (change events: activity, contributors, hot entities, entity history), user settings
that are not GitHub-related, docs pages, api-docs page.

DROP (remove backend AND frontend UI/routes/links cleanly, no dead buttons): login/auth pages,
next-auth, SessionGuard, user menu sign-in/out, members/roles management, join requests,
transfer ownership, notifications, user search, GitHub integration / from-github / github token /
webhooks, remote sync, embeddings + semantic search + similar entities + rank-suggestions,
suggestions workflow (only meaningful for non-editor roles), realtime collab websockets, sitemap
beacon. Where the UI branched on roles/permissions, take the owner/editor branch.

## Ownership (to avoid conflicts between parallel agents)
- Foundation agent: scaffold, server/{app,db,git,rdf,ontology,jobs,user}.ts, routes/projects.ts
  (project CRUD/import/source/branches/revisions), auth removal in frontend.
- Editor agent: routes/ontology.ts (tree, classes, properties, search, index-status, reindex,
  entity references, /ontologies/* routes).
- Lint/quality agent: routes/lint.ts, routes/quality.ts, routes/normalization.ts.
- PR/analytics agent: routes/pullRequests.ts, routes/analytics.ts, routes/userSettings.ts.
- Frontend-prune agent: removes DROP features from the UI.
Each backend agent touches only its own route files + adds its tables in its own
`server/schema/<domain>.sql`-style block (db.ts loads every `server/schema/*.sql` at startup) +
one `app.route(...)` line in server/app.ts. Shared helpers in server/*.ts may be extended
(append-only, don't change existing signatures).

## Foundation status (done) — reuse these helpers
- server/http.ts: ApiError, httpError(status, detail): never ({detail} JSON), readJson<T>(c), queryInt, queryBool, requireString, noContent(c). Uncaught GitError -> 400.
- server/db.ts: getDb, all/get/run(sql, ...params), transaction(fn) (sync), insert(table,row), update(table,set,where), toJson/fromJson, bool, nowIso, newId, DATA_DIR, REPOS_DIR. Every server/schema/*.sql loaded alphabetically at startup — must be idempotent (CREATE TABLE IF NOT EXISTS). FK to projects(id) ON DELETE CASCADE.
- server/git.ts (async, projectId first): resolveRef, getDefaultBranch, listBranches, createBranch, deleteBranch, aheadBehind, mergeBase, readFile/readFileOrNull, getCommit, getHistory, getCommitsBetween(from,to), diff(from,to)->DiffInfo, commitFiles/commitFile, mergeBranch(source,target,{message,author})->MergeResult (UNTESTED via endpoint — PR agent must test), withRepoLock.
- server/rdf.ts: NS, parseTurtle, parseRdf, serializeTurtle(store|quads, prefixes), normalizeToTurtle, findOntologyIri.
- server/ontology.ts: requireProject(id), resolveBranch(id, branch?), projectLabelPreferences, loadOntology(id, ref?) -> {commitHash, filePath, content, store (shared, read-only), prefixes}; invalidateOntologyCache; commitOntology({projectId, branch, content, message, origin}); onOntologyEvent('commit'|'branch-created'|'branch-deleted'|'project-deleted', fn) (commit event has parentHash, commitHash); recordChange stub (for analytics); store queries getLabels/getComments/getTypes/getObjects/getSubjects/getPreferredLabel/listClasses/listProperties/listIndividuals/getSuperClasses/getSubClasses/getRootClasses/entityType/quadsAbout/quadsReferencing/isDeprecated/localName. openPullRequestBranches reads table pull_requests(project_id, source_branch, status='open') — PR agent must use those names.
- server/jobs.ts: startJob(kind, {projectId, branch}, async ctx => result) -> jobId; ctx.setProgress; getJob, latestJob, listJobs, isJobActive.
- server/user.ts: LOCAL_USER, LOCAL_ROLE, currentUser(), userSummary().
- Frontend: next-auth imports now point to lib/localUser.ts (useSession always signed in). lib/api/client.ts uses relative /api/v1.
- Commands: npm run type-check / build / test / dev. Read README.md. Tests live in __tests__ (vitest).

## Parallel-phase rules
- Several agents work at once. Only edit files you own. For server/app.ts, add exactly your app.route line(s). Shared server/*.ts: append-only.
- If you run the dev server, use your own port (PORT env) and your own data dir (ONTOKIT_DATA_DIR=/private/tmp/... unique) and stop it when done. Don't run `npm install` of new packages without need; if you must, say so in your report.
- Done = type-check passes for your files, and your endpoints were exercised with curl against a running server, with the frontend page(s) that use them returning 200.
