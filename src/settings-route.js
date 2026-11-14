const path = '/api/dsh-remote-dc.account'

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function registerSettings(ctx, account) {
  ctx.effect(() => ctx.connection.fetch.register({
    path,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('x-dsh-remote-dc') !== 'settings') return json({ error: 'Forbidden' }, 403)
      try {
        if (request.method === 'GET') return json(account.view())
        if (request.headers.get('content-type') !== 'application/json') return json({ error: 'Invalid request' }, 400)
        const { action } = await request.json()
        switch (action) {
          case 'connect': return json(await account.begin())
          case 'cancel': return json(account.cancel())
          case 'disconnect': return json(await account.disconnect())
          case 'retry': return json(await account.retry())
          case 'devices': return json(await account.devices(request.signal))
          default: return json({ error: 'Unknown operation' }, 400)
        }
      } catch {
        return json({ error: 'Desktop Commander request failed. Check the connection and try again.' }, 502)
      }
    },
  }), 'remote-dc account settings')
}
