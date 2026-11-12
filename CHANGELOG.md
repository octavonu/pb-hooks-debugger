# Changelog

Notable changes to the PocketBase Hooks Debugger. There are no version numbers yet, so entries are grouped by date.

## 2026-11-12

### Added

- **Breakpoints only pause while the debugger is open.** Each open debugger tab sends a heartbeat to the new `POST /api/dbg/presence` route every 15 s, and says goodbye when it closes. Without a heartbeat in the last 90 s, requests run through breakpoints. A forgotten breakpoint can no longer hang real traffic, e.g. while your app keeps a hosted instance awake. The realtime connection isn't used to detect an open debugger: behind a proxy such as PocketHost the server may keep a closed tab's connection for minutes.
- **Pause for: Only me / Everyone** toggle in the debug toolbar. With **Only me** (the default), only your own requests pause:
  - requests from the browser running the debugger, which sets a secret `dbg` cookie;
  - requests that send its `X-Dbg` header (the copy button next to the toggle copies it, for curl or an app on another origin);
  - requests from a superuser.

  Other users' requests run through breakpoints. **Everyone** pauses any request, which is also needed for hooks that don't run for a request (cron jobs, model hooks such as `onRecordAfterCreateSuccess`).
- Tooltip on **as superuser** in the request runner, explaining what it changes.

### Changed

- `dbg_sessions` no longer fills up. A session is deleted as soon as it ends (Resume, Step or timeout), and every pause or step creates its own session.
- At startup, sessions still marked `paused` are closed. Their request died with the process, e.g. on **Disable debug**, so the UI no longer shows a dead pause after a reload.
- A pending Step is no longer consumed by a request that isn't allowed to pause.
- New README screenshot showing the **Only me / Everyone** toggle.
- README: deploy to PocketHost with the new `pockethost` CLI instead of `phio`, including how to add the debugger to an existing instance without deleting its files. `.phioconfig` is now `.pockethostconfig`.

### Upgrading

Upload `pb_hooks/_dbg_runtime.js`, `pb_hooks/dbg.pb.js` and `pb_public/debug/index.html`. No new migration is needed. Reload any open debugger tab, because the older UI sends no heartbeat, so its breakpoints would not pause.

## 2026-11-02

### Added

- Debugger UI with an icon debug toolbar, editor tabs, a file tree and a tabbed panel (Variables, Breakpoints, Evaluate).
- Subfolders in `pb_hooks`, e.g. helpers loaded with `require()`.
- **Step Into** (F5) follows calls into other debug-enabled files.
- Call stack: click a frame to see its variables and evaluate expressions in it.
- **Step Over** (F6) and **Step Out** (F7) that respect the call stack.
- The debugger's own files are shown read-only and can't be debugged.
- Demo: `GET /api/board/stats` calls a helper from `pb_hooks/tests/test.js`.
- Larger, captioned demo GIF and screenshot.

### Upgrading

Run the `1792870000_add_dbg_session_stack.js` migration. Files instrumented by an older version have no call stack: disable and enable debug again.

## 2026-10-24

### Added

- First release: a breakpoint debugger for PocketBase JS hooks that runs inside PocketBase itself. It instruments a hook file on the same lines, pauses a live request at a breakpoint, shows its local variables and evaluates expressions in the paused scope.
- Demo realtime message board to try it on.
- MIT license, demo GIF and screenshot.

### Fixed

- The breakpoint status no longer goes stale.
