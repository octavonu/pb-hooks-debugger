/// <reference path="../pb_data/types.d.ts" />

// Helpers for the debugger routes (used from dbg.pb.js via require, because
// pb_hooks handlers can't see functions defined at file level).

const MARKER = '\n// @dbg-instrumented\n'
// The only snippets the browser may insert: a line probe before statements,
// and enter()/exit() wrapped around function bodies (call stack tracking).
// Each is matched exactly.
const ENTER_SNIPPET = '/*@dbg*/;require(__hooks+"/_dbg_runtime.js").enter();try{/*@/dbg*/'
const EXIT_SNIPPET = '/*@dbg*/}finally{require(__hooks+"/_dbg_runtime.js").exit()}/*@/dbg*/'
const PROBE_RE =
  /\/\*@dbg\*\/;require\(__hooks\+"\/_dbg_runtime\.js"\)\.bp\("[\w.\-]+(?:\/[\w.\-]+)*",\d+,\(__dbgx\)=>eval\(__dbgx\),\[(?:"[\w$]+"(?:,"[\w$]+")*)?\]\);\/\*@\/dbg\*\//g

// The debugger's own files are listed read-only: they can be viewed but
// never instrumented (probes there would recurse or block the debugger).
// PocketHost internals (_ph_*) are not listed at all.
const READONLY = ['dbg.pb.js', '_dbg_runtime.js', '_dbg_server.js']

// Files are addressed by their path relative to pb_hooks, e.g.
// "tests/helpers.js". Every segment must be a plain name: no "..", no
// hidden entries, no absolute paths.
const SEGMENT_RE = /^[\w\-][\w.\-]*$/
const MAX_DEPTH = 8
const MAX_PATH = 200

function backupDir() {
  return $app.dataDir() + '/dbg_originals'
}

function hookPath(name) {
  return __hooks + '/' + name
}

function readText(path) {
  return toString($os.readFile(path))
}

function exists(path) {
  try {
    $os.stat(path)
    return true
  } catch (err) {
    return false
  }
}

function isAllowedSegment(segment) {
  return SEGMENT_RE.test(segment) && segment.indexOf('_ph_') !== 0 && segment !== 'node_modules'
}

function isListable(name) {
  if (typeof name !== 'string' || name.length > MAX_PATH || !/\.js$/.test(name)) return false
  const segments = name.split('/')
  return segments.length <= MAX_DEPTH && segments.every(isAllowedSegment)
}

function isReadonly(name) {
  return READONLY.indexOf(name) !== -1
}

function isDebuggable(name) {
  return isListable(name) && !isReadonly(name)
}

// Recursively collects the .js files under pb_hooks.
function walk(dir, prefix, depth, out) {
  $os.readDir(dir).forEach((entry) => {
    const name = entry.name()
    if (!isAllowedSegment(name)) return
    const rel = prefix + name
    if (entry.isDir()) {
      if (depth + 1 < MAX_DEPTH) walk(dir + '/' + name, rel + '/', depth + 1, out)
    } else if (isListable(rel)) {
      out.push(rel)
    }
  })
  return out
}

function dirname(path) {
  return path.slice(0, path.lastIndexOf('/'))
}

function assertReadable(name) {
  if (!isListable(name) || !exists(hookPath(name))) {
    throw new NotFoundError('File not found: ' + name)
  }
}

function assertFile(name) {
  assertReadable(name)
  if (isReadonly(name)) throw new BadRequestError('The debugger cannot debug its own files: ' + name)
}

function isInstrumented(source) {
  return source.endsWith(MARKER)
}

module.exports = {
  MARKER: MARKER,

  list() {
    return walk(__hooks, '', 0, [])
      .map((name) => {
        const source = readText(hookPath(name))
        return { name: name, size: source.length, instrumented: isInstrumented(source), readonly: isReadonly(name) }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  // Always returns the original source, even when the file is instrumented.
  source(name) {
    assertReadable(name)
    const current = readText(hookPath(name))
    if (isReadonly(name)) return { name: name, source: current, instrumented: false, readonly: true }
    const backup = backupDir() + '/' + name
    if (isInstrumented(current) && exists(backup)) {
      return { name: name, source: readText(backup), instrumented: true }
    }
    return { name: name, source: current, instrumented: false }
  },

  // Accepts the instrumented source from the browser only if, with the probes
  // removed, it is identical to the original. This way the route can't be
  // used to write arbitrary code.
  instrument(name, instrumented) {
    assertFile(name)
    const original = this.source(name).source
    if (typeof instrumented !== 'string' || !isInstrumented(instrumented)) {
      throw new BadRequestError('Instrumented source is missing or invalid.')
    }
    const stripped = instrumented
      .slice(0, -MARKER.length)
      .split(ENTER_SNIPPET)
      .join('')
      .split(EXIT_SNIPPET)
      .join('')
      .replace(PROBE_RE, '')
    if (stripped !== original || stripped.indexOf('/*@dbg*/') !== -1) {
      throw new BadRequestError('Instrumented source does not match the original.')
    }

    const backup = backupDir() + '/' + name
    $os.mkdirAll(dirname(backup), 0o755)
    $os.writeFile(backup, original, 0o644)
    $os.writeFile(hookPath(name), instrumented, 0o644)
  },

  restore(name) {
    assertFile(name)
    const backup = backupDir() + '/' + name
    const current = readText(hookPath(name))
    if (isInstrumented(current) && exists(backup)) {
      $os.writeFile(hookPath(name), readText(backup), 0o644)
    }
    if (exists(backup)) $os.remove(backup)
  },
}
