# PocketBase Hooks Debugger

A breakpoint debugger for [PocketBase](https://github.com/pocketbase/pocketbase) JS hooks (`pb_hooks`), running entirely inside PocketBase itself. No extra binaries and no IDE: open `/debug/` in the browser, pick a hook file, click a line number, trigger the hook, and the request pauses there while you inspect variables, evaluate expressions and step through the code.

It was built and tested on [PocketHost](https://pockethost.io) (PocketBase v0.40.6). It only uses the standard JSVM APIs, so it should work on any self-hosted PocketBase with JS hooks enabled.

## Features

- Browse the files in `pb_hooks` with syntax highlighting.
- Toggle breakpoints by clicking line numbers. Only lines inside handler functions are breakable.
- Pause a live request at a breakpoint and see the location and the enclosing hook, e.g. `routerAdd("GET", "/api/board/stats", ƒ)`.
- Inspect local variables. Hook events are summarised: `record`, `collection`, `auth` and `request` come first, internals like `app` are hidden, and `Authorization`/`Cookie` headers are masked.
- Evaluate arbitrary expressions in the paused scope, e.g. `e.record.get('author')` or `$app.findRecordById(...)`.
- **Continue** (F8) and **Step** (F10, to the next executed line).
- Built-in request runner to trigger hooks without leaving the page.

## How it works

Goja, the JS engine inside PocketBase, has no debugging protocol, so the debugger works by **instrumentation**:

1. The browser parses the hook file with [acorn](https://github.com/acornjs/acorn). Before every statement inside a function body it inserts a probe on the **same line**, so line numbers don't change:

   ```js
   /*@dbg*/;require(__hooks+"/_dbg_runtime.js").bp("messages.pb.js",8,(__dbgx)=>eval(__dbgx),["e","author","body"]);/*@/dbg*/const author = ...
   ```

2. The server only accepts the instrumented file if removing every probe (matched by a strict regex) gives back the original byte for byte. The instrument route therefore can't be used to write arbitrary code. The original is kept in `pb_data/dbg_originals/` and is restored when you disable debug.
3. Writing to `pb_hooks` makes PocketBase reload the hooks. From then on each probe checks a breakpoint index kept in `$app.store()`, which is cheap.
4. On a hit, the probe snapshots the locals by evaluating each name through the closure (a direct `eval`, so it sees the real scope). It stores them in a `dbg_sessions` record and then blocks the handler with `sleep()` while polling that record.
5. The UI receives the session over PocketBase realtime and writes commands (`continue`, `step`, `eval`) back into the record. The paused handler picks them up.

## Files

| Path | Purpose |
| --- | --- |
| `pb_public/debug/index.html` | The debugger UI (single file; acorn and the PocketBase JS SDK come from a CDN) |
| `pb_hooks/dbg.pb.js` | Superuser-only routes: list files, read source, instrument, restore |
| `pb_hooks/_dbg_server.js` | File handling and verification of instrumented sources |
| `pb_hooks/_dbg_runtime.js` | The `bp()` probe: breakpoint checks, pausing, variable snapshots, eval |
| `pb_migrations/1792866000_create_debugger.js` | `dbg_breakpoints` and `dbg_sessions` collections (superuser-only) |
| `pb_hooks/messages.pb.js`, `pb_public/index.html`, `pb_migrations/1792863703_create_messages.js` | A small realtime message board used as a demo target (UI in Romanian) |

## Setup

### Self-hosted PocketBase

Copy `pb_hooks`, `pb_migrations` and `pb_public` next to your `pocketbase` binary and run:

```sh
./pocketbase serve
```

Then open `http://127.0.0.1:8090/debug/` and sign in with a superuser account.

### PocketHost

```sh
npm install -g phio    # phio runs its TypeScript sources through tsx: npm install -g tsx
phio login
phio link <your-instance>
phio deploy
```

Then open `https://<your-instance>.pockethost.io/debug/`.

> **Note:** if hooks and a new migration arrive in the same deploy, the instance can restart on the first hook file before the migration has been uploaded. Migrations only run at startup. If the `dbg_*` collections are missing, trigger one more restart, e.g. by re-uploading any hook file.

## Usage

1. Sign in with a superuser account.
2. Select a hook file and click **Enable debug**. The instance reloads its hooks within a few seconds.
3. Click a line number inside a handler to set a breakpoint.
4. Trigger the hook from your app or the **Send a request** panel.
5. Inspect **Variables**, type expressions into **Evaluate**, then **Continue** or **Step**.
6. Click **Disable debug** to restore the original file.

## Limitations

- **Step** means "pause at the next executed line" (within 3 s). There is no step into/out and no call stack.
- Only statements inside `{ }` blocks of functions can be breakpoints. File-level code and expression-bodied arrow functions can't.
- Only one request can be paused at a time. Other requests run through breakpoints while one is paused.
- A paused request auto-resumes after 5 minutes of inactivity. Proxies may time out the client sooner; Cloudflare, for example, cuts responses after ~100 s. The handler stays paused server-side anyway.
- `http.Header` can't be enumerated from the JSVM. Header names in the `e.request` summary come from `e.requestInfo().headers` (lowercase, `_` instead of `-`). Use `e.request.header.get('Name')` for a specific one.
- Probes add overhead and enabling or disabling debug restarts hooks. **Use it on development instances only.**
- While a file is instrumented on the server, deploy tools that sync by local hash (like `phio deploy`) won't overwrite it unless the local file changed. Disable debug before real deploys.

## Security

All debugger routes require superuser auth (`$apis.requireSuperuserAuth()`), and both `dbg_*` collections have `null` rules. Variable snapshots and eval results are stored in `dbg_sessions`. Sensitive headers are masked, but other values (e.g. record fields) are stored as-is. Clear the collection if that matters.
