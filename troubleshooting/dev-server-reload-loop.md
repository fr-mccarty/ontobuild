# Dev server reload loop ("the flashing screen")

## Symptom

With `npm run dev` running, every open page (the project editor, `/docs`, the home
page) reloads itself about 7 to 15 times a second. The dev server log repeats this
block over and over:

```
✓ Compiled in 6ms
 GET /projects/<id>?branch=main 200
 GET /api/v1/projects/<id> 200
 ...
```

Sometimes it also shows
`[browser] Failed to fetch RSC payload ... Falling back to browser navigation. TypeError: Load failed`.
That line is a side effect of the loop: the full reload cuts off a fetch that was
still running. It is not the cause.

## Cause

The Next.js dev build cache in `.next/` is corrupted. The dev server then tells every
connected page to reload each time the page loads, so the reloads never stop.

It has happened twice (2026-11-17):

1. A production `next build` wrote into `.next/` while a dev server was using it.
2. A dev server was killed (`pkill`) and another was started on the same `.next/`.

## Fix

```sh
# 1. Stop the dev server (Ctrl-C in its terminal, or kill it).
lsof -nP -iTCP:3000 -sTCP:LISTEN     # should print nothing
# 2. Delete the cache. It only holds generated files and is git-ignored.
rm -rf .next
# 3. Start again.
npm run dev
```

Then reload the browser tab once. It should load a single time and stay put.

## How to check that it's this

- **Every page loops, not just one.** Open `/docs` too. If that page also reloads,
  your app code is not the cause.
- **No real files are changing.** Look for files modified in the last few seconds:

  ```sh
  touch /tmp/ref; sleep 3
  find . -path ./node_modules -prune -o -path ./.next -prune -o -newer /tmp/ref -print
  ```

  The `find` on this machine is `bfs`. It rejects GNU-style `-newermt "-3 seconds"`
  and then silently matches nothing, so use `-newer <file>` as above.
- **The app has no reload code.** Search for it:
  `git grep -n -e location.reload -e router.refresh -- app components lib`
  finds nothing outside the tests.

## False leads (don't spend time on these again)

- **`.git` keeps changing.** The repository's `.git` folder's timestamp changes every
  few seconds because something creates and deletes `.git/index.lock` (a
  `git status` from an editor or Claude Code). Touching `.git` doesn't trigger a
  rebuild.
- **The hot-reload websocket "hangs".** Next 16's hot-reload endpoint is
  `/_next/hmr`, not the older `/_next/webpack-hmr`. A websocket test against the old
  path gets no answer, which looks like a broken server but isn't. Requests with a
  `localhost` origin get `400` because the server is bound to `127.0.0.1`, which is
  Next's normal cross-origin block.
- **`?branch=` navigation in the project page.** `useBranchChangeNotifier` calls
  `onBranchChange` with the initial branch on every mount. The page used to answer
  with `router.replace(...?branch=main)` even when the URL already said so. That
  wasn't the cause, but it is now a no-op when the URL already names the branch, and
  it otherwise uses `window.history.replaceState` (no server round trip). See
  `handleBranchChange` in `app/projects/[id]/page.tsx`.

## Prevention

- Don't run `next build` while a dev server is running in this folder.
- Stop the dev server cleanly before starting another one, and keep only one running
  at a time.
- If the loop starts anyway, don't debug the app: stop the server, delete `.next/`
  and restart.
