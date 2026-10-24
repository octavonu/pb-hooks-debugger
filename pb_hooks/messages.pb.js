/// <reference path="../pb_data/types.d.ts" />

// Note: in the PocketBase JSVM each handler runs in isolation, so we can't
// use helper functions defined at file level.

// Normalizes new messages and prevents clients from setting likes directly.
onRecordCreateRequest((e) => {
  const author = String(e.record.get('author') || '').trim()
  const body = String(e.record.get('body') || '').trim()

  if (!author) throw new BadRequestError('Name is required.')
  if (!body) throw new BadRequestError('Message cannot be empty.')

  e.record.set('author', author)
  e.record.set('body', body)
  e.record.set('likes', 0)

  e.next()
}, 'messages')

// POST /api/board/like/{id} — increments a message's likes.
// Saving via app.save() also fires the realtime event.
routerAdd('POST', '/api/board/like/{id}', (e) => {
  const id = e.request.pathValue('id')

  let record
  try {
    record = e.app.findRecordById('messages', id)
  } catch (err) {
    throw new NotFoundError('Message not found.')
  }

  record.set('likes', record.getInt('likes') + 1)
  e.app.save(record)

  return e.json(200, { id: record.id, likes: record.getInt('likes') })
})

// GET /api/board/stats — simple stats for the header.
routerAdd('GET', '/api/board/stats', (e) => {
  const totals = new DynamicModel({ messages: 0, likes: 0, authors: 0 })
  e.app
    .db()
    .newQuery(
      'SELECT COUNT(*) AS messages, COALESCE(SUM(likes), 0) AS likes, COUNT(DISTINCT LOWER(author)) AS authors FROM messages'
    )
    .one(totals)

  return e.json(200, {
    messages: totals.messages,
    likes: totals.likes,
    authors: totals.authors,
  })
})
