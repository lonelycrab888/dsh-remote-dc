import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { auth, UnauthorizedError } from '@modelcontextprotocol/client'

export const endpoint = new URL('https://mcp.desktopcommander.app/mcp')
const callbackPath = '/desktop-commander/callback'
const scope = 'mcp:tools desktop:auth'

export function sameState(expected, received) {
  if (typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function vendorFetch(fetcher, server, signal) {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== server.origin || url.username || url.password) {
      throw new Error('Unexpected Desktop Commander endpoint.')
    }
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const combined = signal && requestSignal ? AbortSignal.any([signal, requestSignal]) : signal ?? requestSignal
    return fetcher(input, { ...init, signal: combined, redirect: 'error' })
  }
}

export function oauthProvider({ registration, tokens, redirectUrl, authorize }) {
  let discovery
  let verifier
  const state = randomBytes(32).toString('base64url')
  return {
    redirectUrl,
    clientMetadata: {
      client_name: 'DeepSeek Harness — Remote Desktop Commander',
      redirect_uris: [String(redirectUrl)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope,
    },
    state: () => state,
    clientInformation: () => registration,
    saveClientInformation(value) { registration = value },
    tokens: () => tokens,
    saveTokens(value) {
      tokens = { ...value, ...(value.refresh_token || !tokens?.refresh_token ? {} : { refresh_token: tokens.refresh_token }) }
    },
    invalidateCredentials(kind) {
      if (kind === 'client' || kind === 'all') registration = undefined
      if (kind === 'tokens' || kind === 'all') tokens = undefined
    },
    redirectToAuthorization(url) {
      if (!authorize) throw new UnauthorizedError('Reconnect your Desktop Commander account in Settings.')
      authorize(url)
    },
    saveCodeVerifier(value) { verifier = value },
    codeVerifier: () => verifier,
    saveDiscoveryState(value) { discovery = value },
    discoveryState: () => discovery,
    grant: () => ({ registration, tokens, redirectUrl: String(redirectUrl) }),
  }
}

export async function openCallback() {
  let consume
  const server = createServer((request, response) => {
    const address = server.address()
    if (!address || request.headers.host !== `127.0.0.1:${address.port}` || request.method !== 'GET') {
      response.writeHead(404).end()
      return
    }
    const url = new URL(request.url, 'http://127.0.0.1')
    const send = (status, message) => response.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    }).end(message)
    if (url.pathname !== callbackPath || !consume) {
      send(404, 'Desktop Commander login is unavailable.')
      return
    }
    void consume(url.searchParams).then(({ status, message }) => send(status, message), () => {
      send(502, 'Desktop Commander authorization failed. Return to DeepSeek Harness and retry.')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    redirectUrl: new URL(`http://127.0.0.1:${server.address().port}${callbackPath}`),
    receive(handler) { consume = handler },
    close() { server.close(); server.closeIdleConnections() },
  }
}

export function requestAuthorization(provider, server, fetchFn, extra = {}) {
  return auth(provider, { serverUrl: server, scope, fetchFn, ...extra })
}
