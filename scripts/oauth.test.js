import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { oauthProvider, openCallback, requestAuthorization, sameState, vendorFetch } from '../src/oauth.js'

test('OAuth code exchange, PKCE, state mismatch and token refresh', async t => {
  const base = 'https://desktop-commander.test'
  const server = new URL('/mcp', base)
  let login
  let refreshCount = 0
  const callback = await openCallback()
  t.after(() => callback.close())
  const provider = oauthProvider({ redirectUrl: callback.redirectUrl, authorize: url => { login = url } })
  const fetcher = vendorFetch(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const params = new URLSearchParams(init?.body)
    switch (url.pathname) {
      case '/.well-known/oauth-protected-resource/mcp':
      case '/.well-known/oauth-protected-resource':
        return Response.json({ resource: base, authorization_servers: [base] })
      case '/.well-known/oauth-authorization-server':
        return Response.json({
          issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
          registration_endpoint: base + '/register', response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        })
      case '/register': {
        const registration = JSON.parse(init.body)
        assert.deepEqual(registration.redirect_uris, [callback.redirectUrl.href])
        assert.equal(registration.token_endpoint_auth_method, 'none')
        return Response.json({ ...registration, client_id: 'registered-client' })
      }
      case '/token':
        assert.equal(params.get('client_id'), 'registered-client')
        if (params.get('grant_type') === 'authorization_code') {
          assert.equal(params.get('code'), 'fixture-code')
          assert.equal(params.get('redirect_uri'), callback.redirectUrl.href)
          const pkce = createHash('sha256').update(params.get('code_verifier')).digest('base64url')
          assert.equal(pkce, login.searchParams.get('code_challenge'))
          return Response.json({ access_token: 'first', token_type: 'Bearer', refresh_token: 'refresh' })
        }
        assert.equal(params.get('grant_type'), 'refresh_token')
        assert.equal(params.get('refresh_token'), 'refresh')
        refreshCount++
        return Response.json({ access_token: 'fresh', token_type: 'Bearer' })
      default:
        return new Response(null, { status: 404 })
    }
  }, server)

  assert.equal(await requestAuthorization(provider, server, fetcher), 'REDIRECT')
  assert.equal(login.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(login.searchParams.get('scope'), 'mcp:tools desktop:auth')
  assert.ok(login.searchParams.get('state').length >= 32)
  callback.receive(async params => {
    if (!sameState(provider.state(), params.get('state'))) return { status: 400, message: 'bad state' }
    const result = await requestAuthorization(provider, server, fetcher, { authorizationCode: params.get('code') })
    return { status: 200, message: result }
  })
  const returnUrl = new URL(callback.redirectUrl)
  returnUrl.searchParams.set('state', 'wrong')
  returnUrl.searchParams.set('code', 'fixture-code')
  assert.equal((await fetch(returnUrl)).status, 400)
  assert.equal(provider.tokens(), undefined)
  returnUrl.searchParams.set('state', login.searchParams.get('state'))
  assert.equal(await (await fetch(returnUrl)).text(), 'AUTHORIZED')
  assert.equal(provider.tokens().access_token, 'first')
  const restarted = oauthProvider(provider.grant())
  assert.equal(await requestAuthorization(restarted, server, fetcher), 'AUTHORIZED')
  assert.equal(refreshCount, 1)
  assert.equal(restarted.tokens().access_token, 'fresh')
  assert.equal(restarted.tokens().refresh_token, 'refresh')
  assert.throws(() => fetcher('https://elsewhere.test/token'), /Unexpected Desktop Commander endpoint/)
})
