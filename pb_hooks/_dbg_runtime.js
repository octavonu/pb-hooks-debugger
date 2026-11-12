/// <reference path="../pb_data/types.d.ts" />

// Debugger runtime. Instrumented files call bp(file, line, evalInScope, names)
// before each line, and enter()/exit() around each function body. If the line
// has a breakpoint (or we are stepping), the current handler pauses here, via
// sleep(), until the UI sends a command through the dbg_sessions collection.
//
// Call stack: require() caches this module per JS VM and a VM runs one handler
// at a time, so module-level state is per execution. `frames` is the stack of
// instrumented functions currently running in this VM.

const POLL_MS = 150
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const STEP_WINDOW_MS = 3000

const BPS_KEY = 'dbg.bps'
const STEP_KEY = 'dbg.step'
const PAUSED_KEY = 'dbg.paused'

const VM_ID = $security.randomString(10)
// { file, line, scope, names } per running instrumented function; the probe
// of each frame keeps its current line and a closure over its scope.
const frames = []

function breakpointIndex() {
  const store = $app.store()
  let index = store.get(BPS_KEY)
  if (typeof index !== 'string') {
    index = '|'
    try {
      $app.findAllRecords('dbg_breakpoints').forEach((r) => {
        index += r.getString('file') + ':' + r.getInt('line') + '|'
      })
    } catch (err) {
      // Collection missing (migration hasn't run yet): no breakpoints.
    }
    store.set(BPS_KEY, index)
  }
  return index
}

// A pause only makes sense when someone can resume it, i.e. a superuser has
// the debugger UI open. Without this check a forgotten breakpoint would hang
// real requests for minutes, e.g. after a hosted instance wakes up from idle
// with breakpoints still set.
//
// Each open debugger tab posts a heartbeat to /api/dbg/presence and a "bye"
// when it closes; we keep { tabId: lastSeenMs } in the app store. The
// realtime connection is not a reliable signal: behind a proxy (e.g.
// PocketHost) the server can keep a closed tab's connection for minutes.
// The window is generous because browsers throttle timers in background
// tabs (Chrome: about once a minute after 5 minutes hidden).
const PRESENCE_KEY = 'dbg.presence'
const PRESENCE_MS = 90 * 1000

function readPresence(store) {
  try {
    const tabs = JSON.parse(store.get(PRESENCE_KEY) || '{}')
    return tabs && typeof tabs === 'object' ? tabs : {}
  } catch (err) {
    return {}
  }
}

function debuggerOpen() {
  const tabs = readPresence($app.store())
  const since = Date.now() - PRESENCE_MS
  for (const tab in tabs) {
    if (tabs[tab] > since) return true
  }
  return false
}

function presence(tab, bye) {
  const store = $app.store()
  const tabs = readPresence(store)
  const since = Date.now() - PRESENCE_MS
  for (const id in tabs) {
    if (!(tabs[id] > since)) delete tabs[id]
  }
  if (bye) delete tabs[tab]
  else tabs[tab] = Date.now()
  store.set(PRESENCE_KEY, JSON.stringify(tabs))
}

// Useful hook event fields come first; `app` (the PocketBase instance),
// `response` (the HTTP writer) and `event` are just internal noise.
const PRIORITY_KEYS = ['record', 'collection', 'auth', 'request', 'requestEvent']
const HIDDEN_KEYS = ['app', 'response', 'event']
const SECRET_HEADERS = ['authorization', 'cookie', 'set-cookie']

function isHttpRequest(value) {
  return typeof value.method === 'string' && !!value.url && !!value.header && typeof value.remoteAddr === 'string'
}

function isCollection(value) {
  return typeof value.isAuth === 'function' && typeof value.name === 'string' && !!value.fields
}

function isDateTime(value) {
  return typeof value.isZero === 'function' && typeof value.time === 'function' && typeof value.string === 'function'
}

// http.Request reduced to what matters. http.Header can't be iterated from
// the JSVM (it only exposes methods), so headers come from e.requestInfo()
// when we have the event. Tokens are masked because values get stored in
// dbg_sessions.
function summarizeRequest(req, headerMap) {
  const url = req.url
  const out = {
    method: req.method,
    url: url.path + (url.rawQuery ? '?' + url.rawQuery : ''),
    host: req.host,
    remoteAddr: req.remoteAddr,
    contentLength: req.contentLength,
  }
  if (!headerMap) {
    out.headers = "‹use e.request.header.get('Name')›"
    return out
  }
  out.headers = {}
  for (const name in headerMap) {
    let value = String(headerMap[name])
    if (SECRET_HEADERS.indexOf(name.replace(/_/g, '-')) !== -1 && value.length > 12) {
      value = value.slice(0, 12) + '… (masked)'
    }
    out.headers[name] = value
  }
  return out
}

// Turns any value (including Go objects exposed to the JSVM) into a plain
// JSON structure with limited depth.
function toPlain(value, depth, seen) {
  if (value === null || value === undefined) return value === null ? null : '‹undefined›'
  const type = typeof value
  if (type === 'function') return 'ƒ ' + (value.name || 'anonymous') + '()'
  if (type === 'number' && !isFinite(value)) return String(value)
  if (type !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return 'Error: ' + value.message

  if (typeof value.publicExport === 'function') {
    try {
      return toPlain(value.publicExport(), depth, seen)
    } catch (err) {}
  }
  try {
    if (isDateTime(value)) return value.isZero() ? '' : value.string()
    if (isHttpRequest(value)) return summarizeRequest(value, null)
    if (isCollection(value)) return { id: value.id, name: value.name, type: value.type }
  } catch (err) {}
  if (seen.indexOf(value) !== -1) return '‹circular›'
  if (depth <= 0) return Array.isArray(value) ? '‹Array(' + value.length + ')›' : '‹Object›'
  seen.push(value)

  if (Array.isArray(value)) {
    const arr = value.slice(0, 50).map((v) => toPlain(v, depth - 1, seen))
    if (value.length > 50) arr.push('… ' + (value.length - 50) + ' more')
    return arr
  }

  const keys = []
  for (const key in value) keys.push(key)
  // On a hook event skip the internal fields and put the useful ones first.
  // Router events have `request` directly; record request events (e.g.
  // onRecordCreateRequest) keep it under `requestEvent`.
  const isEvent =
    keys.indexOf('app') !== -1 && (keys.indexOf('request') !== -1 || keys.indexOf('requestEvent') !== -1)
  const ordered = isEvent
    ? PRIORITY_KEYS.filter((k) => keys.indexOf(k) !== -1).concat(
        keys.filter((k) => PRIORITY_KEYS.indexOf(k) === -1 && HIDDEN_KEYS.indexOf(k) === -1)
      )
    : keys

  const out = {}
  let count = 0
  for (const key of ordered) {
    let item
    try {
      item = value[key]
    } catch (err) {
      item = '‹read error›'
    }
    if (typeof item === 'function') continue
    if (++count > 40) {
      out['…'] = 'truncated'
      break
    }
    if (isEvent && key === 'request' && item && typeof value.requestInfo === 'function') {
      try {
        out[key] = summarizeRequest(item, value.requestInfo().headers)
        continue
      } catch (err) {}
    }
    out[key] = toPlain(item, depth - 1, seen)
  }
  return out
}

function describe(value, depth) {
  let plain
  try {
    plain = toPlain(value, depth, [])
  } catch (err) {
    plain = '‹cannot display: ' + err + '›'
  }
  let type = typeof value
  if (value === null) type = 'null'
  else if (Array.isArray(value)) type = 'array'
  let json = JSON.stringify(plain === undefined ? null : plain)
  if (json && json.length > 20000) json = JSON.stringify(json.slice(0, 20000) + '… (truncated)')
  return { type: type, value: JSON.parse(json || 'null') }
}

function snapshot(evalInScope, names) {
  const locals = {}
  names.forEach((name) => {
    try {
      locals[name] = describe(evalInScope(name), 3)
    } catch (err) {
      // ReferenceError: the variable is not in scope (or not initialized yet).
      if (String(err).indexOf('ReferenceError') === -1) {
        locals[name] = { type: 'error', value: String(err) }
      }
    }
  })
  return locals
}

// The step target lives in the app store (shared by all VMs) as a string:
// "mode|vmId|depth|until". `into` stops at the next probe anywhere; `over`
// and `out` only in the VM that paused, at the same or a lower depth.
function readStep(store) {
  const raw = store.get(STEP_KEY)
  if (typeof raw !== 'string' || !raw) return null
  const parts = raw.split('|')
  const step = { mode: parts[0], vm: parts[1], depth: parseInt(parts[2], 10), until: parseInt(parts[3], 10) }
  return step.until > Date.now() ? step : null
}

function stepHits(step) {
  if (!step) return false
  if (step.mode === 'into') return true
  if (step.vm !== VM_ID) return false
  return step.mode === 'over' ? frames.length <= step.depth : frames.length < step.depth
}

function stackInfo() {
  const out = []
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].file) out.push({ file: frames[i].file, line: frames[i].line })
  }
  return out
}

// Ends a session: the status update tells the UI that execution went on,
// then the record is deleted (each pause and step creates its own session).
// The delete event carries the ended status, so the UI ignores it.
function endSession(record, status) {
  record.set('status', status)
  $app.save(record)
  try {
    $app.delete(record)
  } catch (err) {}
}

function pause(file, line) {
  const store = $app.store()
  store.set(PAUSED_KEY, true)

  // Frame 0 is the top of the stack (where we paused).
  const frameAt = (index) => frames[frames.length - 1 - index] || frames[frames.length - 1]
  let selected = 0

  const session = new Record($app.findCollectionByNameOrId('dbg_sessions'))
  session.set('status', 'paused')
  session.set('file', file)
  session.set('line', line)
  session.set('stack', stackInfo())
  session.set('frame', 0)
  session.set('locals', snapshot(frameAt(0).scope, frameAt(0).names))
  $app.save(session)

  try {
    let deadline = Date.now() + IDLE_TIMEOUT_MS
    while (Date.now() < deadline) {
      sleep(POLL_MS)
      const current = $app.findRecordById('dbg_sessions', session.id)
      const command = current.getString('command')
      if (!command) continue

      deadline = Date.now() + IDLE_TIMEOUT_MS
      current.set('command', '')

      // Show the variables of another frame of the stack.
      if (command === 'frame') {
        const index = current.getInt('frame')
        selected = index >= 0 && index < frames.length ? index : 0
        current.set('frame', selected)
        current.set('locals', snapshot(frameAt(selected).scope, frameAt(selected).names))
        $app.save(current)
        continue
      }

      if (command === 'eval') {
        const frame = frameAt(selected)
        let result
        try {
          result = describe(frame.scope(current.getString('expr')), 4)
        } catch (err) {
          result = { type: 'error', value: String(err) }
        }
        result.seq = current.getInt('evalSeq')
        current.set('result', result)
        // The expression may have changed variables, so refresh locals too.
        current.set('locals', snapshot(frame.scope, frame.names))
        $app.save(current)
        continue
      }

      // Stepping = pause at a later probe, but only within the next few
      // seconds so we don't catch an unrelated new request.
      const mode = command === 'step' ? 'into' : command
      if (mode === 'into' || mode === 'over' || mode === 'out') {
        store.set(STEP_KEY, [mode, VM_ID, frames.length, Date.now() + STEP_WINDOW_MS].join('|'))
      } else {
        store.set(STEP_KEY, '')
      }
      endSession(current, 'running')
      return
    }

    endSession($app.findRecordById('dbg_sessions', session.id), 'timeout')
  } finally {
    store.set(PAUSED_KEY, false)
  }
}

module.exports = {
  // Heartbeat ("bye" = the tab is closing) from an open debugger tab.
  presence: presence,

  // Called at the start of every instrumented function body.
  enter() {
    frames.push({ file: '', line: 0, scope: null, names: [] })
  },

  // Called from the `finally` of every instrumented function body.
  exit() {
    frames.pop()
    if (frames.length) return
    // The handler has finished in this VM: a pending step from here has
    // nothing left to stop at, so let execution simply continue.
    const store = $app.store()
    const step = readStep(store)
    if (step && step.vm === VM_ID) store.set(STEP_KEY, '')
  },

  bp(file, line, evalInScope, names) {
    // Files instrumented by an older version have no enter()/exit().
    if (!frames.length) frames.push({ file: '', line: 0, scope: null, names: [] })
    const top = frames[frames.length - 1]
    top.file = file
    top.line = line
    top.scope = evalInScope
    top.names = names

    const store = $app.store()
    // One pause at a time; also prevents nested pauses from hooks triggered
    // by saving the debug session itself.
    if (store.get(PAUSED_KEY) === true) return

    if (!stepHits(readStep(store)) && breakpointIndex().indexOf('|' + file + ':' + line + '|') === -1) return

    store.set(STEP_KEY, '')
    if (!debuggerOpen()) return
    pause(file, line)
  },
}
