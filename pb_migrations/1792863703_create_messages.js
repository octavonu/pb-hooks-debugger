/// <reference path="../pb_data/types.d.ts" />

// Public "messages" collection for the message board.
// Anyone can read and post; nobody can edit/delete through the API.
// Likes only go through the custom route in pb_hooks/messages.pb.js.
migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'messages',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'author', required: true, min: 1, max: 40 },
        { type: 'text', name: 'body', required: true, min: 1, max: 280 },
        {
          type: 'select',
          name: 'mood',
          required: true,
          maxSelect: 1,
          values: ['happy', 'love', 'idea', 'party', 'chill'],
        },
        { type: 'number', name: 'likes', min: 0, onlyInt: true },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_messages_created ON messages (created)'],
    })

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('messages')
    app.delete(collection)
  }
)
