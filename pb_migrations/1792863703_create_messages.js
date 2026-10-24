/// <reference path="../pb_data/types.d.ts" />

// Colecția publică "messages" pentru panoul de mesaje.
// Oricine poate citi și posta; nimeni nu poate edita/șterge prin API.
// Like-urile se fac doar prin ruta custom din pb_hooks/messages.pb.js.
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
