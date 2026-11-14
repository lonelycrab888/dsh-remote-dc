import assert from 'node:assert/strict'
import { writeFile, rename } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const inject = ['credentials', 'tools']

export function apply(ctx) {
  ctx.effect(() => {
    const timer = setTimeout(() => void run(ctx), 100)
    return () => clearTimeout(timer)
  })
}

async function run(ctx) {
  const resultPath = process.env.RDC_ACCOUNT_REPORT
  let report
  let account
  let saved
  try {
    const source = pathToFileURL(join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules', 'dsh-remote-dc', 'src', 'account.js'))
    const { Account } = await import(source.href)
    const root = 'https://rdc-fixture.invalid'
    const server = new URL('/mcp', root)
    let refreshes = 0
    let rejectedAccessToken = false
    let lastCall
    let seenBearer
    let saveCount = 0
    const fetcher = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return Response.json({ resource: root, authorization_servers: [root] })
      }
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: root, authorization_endpoint: root + '/authorize', token_endpoint: root + '/token',
          registration_endpoint: root + '/register', response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        })
      }
      if (url.pathname === '/register') return Response.json({ ...JSON.parse(init.body), client_id: 'fixture-client' })
      if (url.pathname === '/token') {
        const params = new URLSearchParams(init.body)
        const refresh = params.get('grant_type') === 'refresh_token'
        if (refresh) refreshes++
        return Response.json({
          access_token: refresh ? 'refreshed-access' : 'initial-access', token_type: 'Bearer',
          refresh_token: refresh ? 'rotated-refresh' : 'initial-refresh',
        })
      }
      if (url.pathname !== '/mcp') return new Response(null, { status: 404 })
      if (init.method === 'GET') return new Response(null, { status: 405 })
      const msg = JSON.parse(init.body)
      seenBearer = new Headers(init.headers).get('authorization')
      if (msg.method === 'tools/call' && seenBearer === 'Bearer initial-access') {
        rejectedAccessToken = true
        return new Response(null, { status: 401 })
      }
      if (msg.id === undefined) return new Response(null, { status: 202 })
      let result
      switch (msg.method) {
        case 'initialize':
          result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'rdc-fixture', version: '1.0.0' } }
          break
        case 'tools/list':
          result = { tools: [
            { name: 'list_devices', inputSchema: { type: 'object', properties: {} } },
            { name: 'read_file', inputSchema: {
              type: 'object', properties: { deviceId: { type: 'string' }, path: { type: 'string' } }, required: ['deviceId', 'path'],
            } },
            { name: 'review_device_call', inputSchema: { type: 'object', properties: {} } },
          ] }
          break
        case 'tools/call':
          lastCall = msg.params
          result = { content: [{ type: 'text', text: msg.params.name === 'list_devices' ? 'dev1 online' : 'file contents' }] }
          break
        default: throw new Error(`Unexpected MCP method ${msg.method}`)
      }
      return Response.json({ jsonrpc: '2.0', id: msg.id, result })
    }
    const credentials = {
      async readRecord() { return saved },
      async modifyRecord(_key, mutate) {
        const next = await mutate(saved)
        if (next) { saved = next; saveCount++ }
      },
      async deleteRecord() { saved = undefined },
    }
    const context = { credentials, tools: ctx.tools }
    const waitForTools = async instance => {
      const deadline = Date.now() + 5000
      while (instance.view().connection !== 'connected') {
        assert.ok(Date.now() < deadline, JSON.stringify(instance.view()))
        await delay(25)
      }
    }
    account = new Account(context, { server, fetcher })
    account.initialize()
    const start = await account.begin()
    assert.equal(start.phase, 'authorizing')
    const authorize = new URL(start.authorizationUrl)
    const callback = new URL(authorize.searchParams.get('redirect_uri'))
    callback.searchParams.set('state', authorize.searchParams.get('state'))
    callback.searchParams.set('code', 'fixture-code')
    assert.equal((await fetch(callback)).status, 200)
    await waitForTools(account)
    assert.equal(account.view().toolCount, 3)
    assert.ok(ctx.tools.get('mcp__remote_desktop_commander__review_device_call'))

    const call = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: 'rdc-account-read', name: 'mcp__remote_desktop_commander__read_file',
        arguments: JSON.stringify({ deviceId: 'dev1', path: '/example.txt' }) }],
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(call.results[0].result.isError, false, JSON.stringify(call.results[0].result))
    assert.equal(call.results[0].result.content[0].text, 'file contents')
    assert.deepEqual(lastCall.arguments, { deviceId: 'dev1', path: '/example.txt' })
    assert.equal(rejectedAccessToken, true)
    assert.equal(seenBearer, 'Bearer refreshed-access')
    assert.equal(refreshes, 1)
    assert.equal(saveCount, 2)
    assert.equal(saved.payload.tokens.refresh_token, 'rotated-refresh')
    assert.deepEqual(await account.devices(AbortSignal.timeout(5000)), { text: 'dev1 online', failed: false })
    assert.ok(!JSON.stringify(account.view()).includes('refreshed-access'))

    await account.dispose()
    assert.equal(ctx.tools.get('mcp__remote_desktop_commander__read_file'), undefined)
    account = new Account(context, { server, fetcher })
    account.initialize()
    await waitForTools(account)
    await account.disconnect()
    assert.equal(saved, undefined)
    assert.equal(account.view().phase, 'disconnected')
    assert.equal(ctx.tools.get('mcp__remote_desktop_commander__read_file'), undefined)
    report = { ok: true, checks: ['OAuth callback', 'MCP discovery and device dispatch', 'token refresh and rotation', 'restart and disconnect'] }
  } catch (error) {
    report = { ok: false, error: error.stack }
  } finally {
    await account?.dispose()
    await writeFile(resultPath + '.tmp', JSON.stringify(report))
    await rename(resultPath + '.tmp', resultPath)
  }
}
