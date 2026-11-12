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

// Heartbeat from an open debugger tab; breakpoints only pause while one is
// open, and by default only for that user's requests (see pauseScope() and
// requestAllowed() in _dbg_runtime.js).
routerAdd(
  'POST',
  '/api/dbg/presence',
  (e) => {
    const body = e.requestInfo().body
    const tab = String(body.tab || '')
    if (!/^[A-Za-z0-9]{1,40}$/.test(tab)) throw new BadRequestError('Invalid tab id.')
    const token = String(body.token || '')
    if (body.bye !== true && !/^[a-f0-9]{32}$/.test(token)) throw new BadRequestError('Invalid token.')
    require(`${__hooks}/_dbg_runtime.js`).presence(tab, body.bye === true, token, body.all === true)
    return e.json(200, { ok: true })
  },
  $apis.requireSuperuserAuth()
)

// A paused request dies with the process (Disable debug, deploy, hosted
// instance going idle). Its session would stay "paused" and the UI would
// show it after a reload, with commands nobody reads. Close such leftovers
// at startup. Ended sessions are only history (every pause and every step
// creates one), so delete them. Paused ones are marked ended rather than
// deleted: a delete event carries the old "paused" record, which an open
// debugger tab would show again.
onBootstrap((e) => {
  e.next()
  try {
    const paused = $dbx.hashExp({ status: 'paused' })
    e.app.findAllRecords('dbg_sessions', $dbx.not(paused)).forEach((r) => e.app.delete(r))
    e.app.findAllRecords('dbg_sessions', paused).forEach((r) => {
      r.set('status', 'timeout')
      e.app.save(r)
    })
  } catch (err) {
    // Collection missing (migrations haven't run yet): nothing to clean up.
  }
})

// The breakpoint index lives in the app store; invalidate it on any change.
onRecordAfterCreateSuccess((e) => {
  $app.store().remove('dbg.bps')
  e.next()
}, 'dbg_breakpoints')

onRecordAfterDeleteSuccess((e) => {
  $app.store().remove('dbg.bps')
  e.next()
}, 'dbg_breakpoints')
