# next dev reloads a page in a loop after a restart with a changed `NEXT_PUBLIC_` value (Turbopack dev cache)

## Run it

```bash
pnpm install
pnpm exec playwright install chromium
node repro.mjs
```

`repro.mjs` starts `next dev` three times on the same `.next`, which keeps Turbopack's dev filesystem cache between sessions.

- **Session 1** builds the cache: it loads `/a`, does `router.push("/b")`, then loads `/c`.
- **Sessions 2 and 3** each start with a different `NEXT_PUBLIC_VALUE` and POST to a route handler (`/api/ping`). They then load `/a` and count document loads for 6 seconds.

`/a` renders a client component that reads `process.env.NEXT_PUBLIC_VALUE`.

## Expected and observed

Expected: 1 load of `/a` per session.

Observed on 16.4.1:

```
session 1 (build cache): 2 loads of /a, /c
session 2: 240 loads of /a
session 3: 244 loads of /a
```

The dev server logs `GET /a 200` followed by `✓ Compiled` on every reload.

| next | sessions 2–3 loop |
|---|---|
| 16.3.8 | no (2 of 2 runs clean) |
| 16.4.1 | yes (6 of 6 runs) |
| 16.5.0-canary.11 | yes (1 of 2 runs) |

## Each ingredient is needed (16.4.1)

| change | result |
|---|---|
| `FIXED_VALUE=1` (same `NEXT_PUBLIC_VALUE` every session) | rarely loops; see below |
| `NO_POST=1` (no route handler request before the page) | no loop, 2 of 2 |
| session 1 loads only `/a` | no loop, 4 of 4 |
| session 1: `/a`, then a full load of `/c`, with no `router.push` | no loop, 4 of 4 |
| session 1: `/a`, then `router.push("/b")`, with no full load of `/c` | no loop, 4 of 4 |
| `experimental.turbopackFileSystemCacheForDev: false` | no loop (observed in the app this was reduced from) |

## A restart with nothing changed can loop too

With `FIXED_VALUE=1` nothing the client bundle inlines changes, yet a restart
sometimes loops anyway. Server-only variables make no difference. `repro.mjs` also
passes `SERVER_VALUE`, which `/a`'s server component renders, and `UNUSED_VALUE`,
which nothing reads. Six runs of `node repro.mjs 4` each, so 18 restarts per row:

| env | restarts that looped |
|---|---|
| `FIXED_VALUE=1` (nothing changes) | 1 of 18 |
| `FIXED_VALUE=1 UNUSED_VARY=1` (an unread variable changes) | 1 of 18 |
| `FIXED_VALUE=1 SERVER_VARY=1` (a variable read during render changes) | 1 of 18 |
| neither (`NEXT_PUBLIC_VALUE` changes) | every restart |

A looping restart reloads about 200 times in 6 seconds, the same as the
`NEXT_PUBLIC_` case, and the next restart is usually clean. In the larger app
this was reduced from, a restart with no `NEXT_PUBLIC_` change, on a cache the
previous session had just built, looped in 3 of 3 runs. A bigger app seems to
make it more likely. So a changed `NEXT_PUBLIC_` value makes the loop reliable
here, but it is not the only way in.

## What the dev server does

Seen by logging inside `next/dist/server/dev/hot-reloader-turbopack.js` during a looping session:

- Each load subscribes to two chunk lists. The page's own list's first emission is `issues`. The list for the **main client entry** (react-dom, the Next client) has a first emission of `restart`, on every load.
- `subscribeToClientHmrEvents` forwards any first emission other than `issues` through `sendTurbopackMessage`. That bumps `clientHmrVersion`, so the page's next `turbopack-subscribe` carries a stale `hmrVersion`, gets `RELOAD_PAGE` "HMR hash mismatch", and the loop repeats.
- The main entry's chunk files are byte-identical between the session that built the cache and the looping one.

Reading the 16.4.1 source (not verified by instrumentation): `update_chunk_list` returns `Update::Total` when the `from` version isn't a `ChunkListVersion`, i.e. a `NotFoundVersion`. That points at the baseline taken in `Project::hmr_version_state`, through `VersionedContentMap::get` → `raw_get`, coming back empty for the entry chunk list. `raw_get` uses the first operation in `map_path_to_op[path]`.
