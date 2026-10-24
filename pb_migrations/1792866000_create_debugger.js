/// <reference path="../pb_data/types.d.ts" />

// Collections for the pb_hooks debugger. Both are superuser-only
// (all rules are null).
migrate(
  (app) => {
    const breakpoints = new Collection({
      type: 'base',
      name: 'dbg_breakpoints',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'file', required: true, max: 200 },
        { type: 'number', name: 'line', required: true, min: 1, onlyInt: true },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_dbg_bp_file_line ON dbg_breakpoints (file, line)'],
    })
    app.save(breakpoints)

    // A session = one pause at a breakpoint. The UI writes `command`
    // (continue / step / eval) and the paused hook replies via `result`.
    const sessions = new Collection({
      type: 'base',
      name: 'dbg_sessions',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: 'select',
          name: 'status',
          required: true,
          maxSelect: 1,
          values: ['paused', 'running', 'timeout'],
        },
        { type: 'text', name: 'file', max: 200 },
        { type: 'number', name: 'line', onlyInt: true },
        { type: 'json', name: 'locals', maxSize: 2000000 },
        { type: 'text', name: 'command', max: 20 },
        { type: 'text', name: 'expr', max: 2000 },
        { type: 'json', name: 'result', maxSize: 2000000 },
        { type: 'number', name: 'evalSeq', onlyInt: true },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_dbg_sessions_created ON dbg_sessions (created)'],
    })
    app.save(sessions)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('dbg_sessions'))
    app.delete(app.findCollectionByNameOrId('dbg_breakpoints'))
  }
)
