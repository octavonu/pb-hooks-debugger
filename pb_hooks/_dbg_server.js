/// <reference path="../pb_data/types.d.ts" />

// Helpers for the debugger routes (used from dbg.pb.js via require, because
// pb_hooks handlers can't see functions defined at file level).

const MARKER = '\n// @dbg-instrumented\n'
const PROBE_RE =
  /\/\*@dbg\*\/;require\(__hooks\+"\/_dbg_runtime\.js"\)\.bp\("[\w.\-]+",\d+,\(__dbgx\)=>eval\(__dbgx\),\[(?:"[\w$]+"(?:,"[\w$]+")*)?\]\);\/\*@\/dbg\*\//g

// The debugger's own files and PocketHost internals can't be debugged.
const HIDDEN = ['dbg.pb.js', '_dbg_runtime.js', '_dbg_server.js']

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

function isDebuggable(name) {
  return /^[\w.\-]+\.js$/.test(name) && HIDDEN.indexOf(name) === -1 && name.indexOf('_ph_') !== 0
}

function assertFile(name) {
  if (!isDebuggable(name) || !exists(hookPath(name))) {
    throw new NotFoundError('File not found or not debuggable: ' + name)
  }
}

function isInstrumented(source) {
  return source.endsWith(MARKER)
}

module.exports = {
  MARKER: MARKER,

  list() {
    return $os
      .readDir(__hooks)
      .filter((entry) => !entry.isDir() && isDebuggable(entry.name()))
      .map((entry) => {
        const source = readText(hookPath(entry.name()))
        return { name: entry.name(), size: source.length, instrumented: isInstrumented(source) }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  // Always returns the original source, even when the file is instrumented.
  source(name) {
    assertFile(name)
    const current = readText(hookPath(name))
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
    const original = this.source(name).source
    if (typeof instrumented !== 'string' || !isInstrumented(instrumented)) {
      throw new BadRequestError('Instrumented source is missing or invalid.')
    }
    const stripped = instrumented.slice(0, -MARKER.length).replace(PROBE_RE, '')
    if (stripped !== original || stripped.indexOf('/*@dbg*/') !== -1) {
      throw new BadRequestError('Instrumented source does not match the original.')
    }

    $os.mkdirAll(backupDir(), 0o755)
    $os.writeFile(backupDir() + '/' + name, original, 0o644)
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
