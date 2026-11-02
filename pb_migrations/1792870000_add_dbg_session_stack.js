/// <reference path="../pb_data/types.d.ts" />

// Call stack support for the debugger: the paused session stores the stack
// (`stack`, top frame first) and the frame selected in the UI (`frame`).
migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId('dbg_sessions')
    sessions.fields.add(new JSONField({ name: 'stack', maxSize: 200000 }))
    sessions.fields.add(new NumberField({ name: 'frame', onlyInt: true, min: 0 }))
    app.save(sessions)
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId('dbg_sessions')
    sessions.fields.removeByName('stack')
    sessions.fields.removeByName('frame')
    app.save(sessions)
  }
)
