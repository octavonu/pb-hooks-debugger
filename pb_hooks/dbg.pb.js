/// <reference path="../pb_data/types.d.ts" />

// Routes for the pb_hooks debugger (UI in pb_public/debug/).
// All of them require superuser auth.

routerAdd(
  'GET',
  '/api/dbg/files',
  (e) => e.json(200, require(`${__hooks}/_dbg_server.js`).list()),
  $apis.requireSuperuserAuth()
)

routerAdd(
  'GET',
  '/api/dbg/source/{path...}',
  (e) => e.json(200, require(`${__hooks}/_dbg_server.js`).source(e.request.pathValue('path'))),
  $apis.requireSuperuserAuth()
)

// Writing to pb_hooks restarts the instance automatically, so the new probes
// become active after a few seconds.
routerAdd(
  'POST',
  '/api/dbg/instrument/{path...}',
  (e) => {
    const body = e.requestInfo().body
    require(`${__hooks}/_dbg_server.js`).instrument(e.request.pathValue('path'), body.source)
    return e.json(200, { ok: true })
  },
  $apis.requireSuperuserAuth()
)

routerAdd(
  'POST',
  '/api/dbg/restore/{path...}',
  (e) => {
    require(`${__hooks}/_dbg_server.js`).restore(e.request.pathValue('path'))
    return e.json(200, { ok: true })
  },
  $apis.requireSuperuserAuth()
)

// The breakpoint index lives in the app store; invalidate it on any change.
onRecordAfterCreateSuccess((e) => {
  $app.store().remove('dbg.bps')
  e.next()
}, 'dbg_breakpoints')

onRecordAfterDeleteSuccess((e) => {
  $app.store().remove('dbg.bps')
  e.next()
}, 'dbg_breakpoints')
