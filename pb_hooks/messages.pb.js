/// <reference path="../pb_data/types.d.ts" />

// Notă: în JSVM-ul PocketBase fiecare handler rulează izolat, așa că
// nu putem folosi funcții helper definite la nivelul fișierului.

// Normalizează mesajele noi și împiedică setarea manuală a like-urilor.
onRecordCreateRequest((e) => {
  const author = String(e.record.get('author') || '').trim()
  const body = String(e.record.get('body') || '').trim()

  if (!author) throw new BadRequestError('Numele este obligatoriu.')
  if (!body) throw new BadRequestError('Mesajul nu poate fi gol.')

  e.record.set('author', author)
  e.record.set('body', body)
  e.record.set('likes', 0)

  e.next()
}, 'messages')

// POST /api/board/like/{id} — incrementează like-urile unui mesaj.
// Salvarea prin app.save() declanșează și evenimentul realtime.
routerAdd('POST', '/api/board/like/{id}', (e) => {
  const id = e.request.pathValue('id')

  let record
  try {
    record = e.app.findRecordById('messages', id)
  } catch (err) {
    throw new NotFoundError('Mesajul nu există.')
  }

  record.set('likes', record.getInt('likes') + 1)
  e.app.save(record)

  return e.json(200, { id: record.id, likes: record.getInt('likes') })
})

// GET /api/board/stats — statistici simple pentru antet.
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
