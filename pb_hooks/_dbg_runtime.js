/// <reference path="../pb_data/types.d.ts" />

// Debugger runtime. Instrumented files call bp(file, line, evalInScope, names)
// before each line. If the line has a breakpoint (or we are stepping), the
// current handler pauses here, via sleep(), until the UI sends a command
// through the dbg_sessions collection.

const POLL_MS = 150
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const STEP_WINDOW_MS = 3000

const BPS_KEY = 'dbg.bps'
const STEP_KEY = 'dbg.step'
const PAUSED_KEY = 'dbg.paused'

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

// Useful hook event fields come first; `app` (the PocketBase instance),
// `response` (the HTTP writer) and `event` are just internal noise.
const PRIORITY_KEYS = ['record', 'collection', 'auth', 'request']
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
  // On a hook event (has `request`) skip the internal fields and put the
  // useful ones first.
  const isEvent = keys.indexOf('request') !== -1 && keys.indexOf('app') !== -1
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

function pause(file, line, evalInScope, names) {
  const store = $app.store()
  store.set(PAUSED_KEY, true)

  const session = new Record($app.findCollectionByNameOrId('dbg_sessions'))
  session.set('status', 'paused')
  session.set('file', file)
  session.set('line', line)
  session.set('locals', snapshot(evalInScope, names))
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

      if (command === 'eval') {
        let result
        try {
          result = describe(evalInScope(current.getString('expr')), 4)
        } catch (err) {
          result = { type: 'error', value: String(err) }
        }
        result.seq = current.getInt('evalSeq')
        current.set('result', result)
        // The expression may have changed variables, so refresh locals too.
        current.set('locals', snapshot(evalInScope, names))
        $app.save(current)
        continue
      }

      // "Step" = pause at the next probe that runs, but only within the next
      // few seconds so we don't catch an unrelated new request.
      store.set(STEP_KEY, command === 'step' ? Date.now() + STEP_WINDOW_MS : 0)
      current.set('status', 'running')
      $app.save(current)
      return
    }

    const timedOut = $app.findRecordById('dbg_sessions', session.id)
    timedOut.set('status', 'timeout')
    $app.save(timedOut)
  } finally {
    store.set(PAUSED_KEY, false)
  }
}

module.exports = {
  bp(file, line, evalInScope, names) {
    const store = $app.store()
    // One pause at a time; also prevents nested pauses from hooks triggered
    // by saving the debug session itself.
    if (store.get(PAUSED_KEY) === true) return

    const stepping = (store.get(STEP_KEY) || 0) > Date.now()
    if (!stepping && breakpointIndex().indexOf('|' + file + ':' + line + '|') === -1) return

    store.set(STEP_KEY, 0)
    pause(file, line, evalInScope, names)
  },
}
