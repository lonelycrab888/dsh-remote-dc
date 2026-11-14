import { Client, SdkErrorCode, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { endpoint, oauthProvider, openCallback, requestAuthorization, sameState, vendorFetch } from './oauth.js'

const key = credentialKey('dsh-remote-dc', 'desktop-commander')
const callTimeout = 60000
const connectionTimeout = 20000
const prefix = 'mcp__remote_desktop_commander__'
const callbackLifetime = 5 * 60 * 1000
const publicName = /^[A-Za-z0-9_-]{1,64}$/
const authFailure = error => error instanceof UnauthorizedError || error?.code === SdkErrorCode.ClientHttpAuthentication

export class Account {
  constructor(ctx, { server = endpoint, fetcher = globalThis.fetch } = {}) {
    this.ctx = ctx
    this.server = server
    this.fetcher = fetcher
    this.phase = 'loading'
    this.status = 'disconnected'
    this.disposers = []
    this.tools = new Map()
    this.queue = Promise.resolve()
    this.retryDelay = 1000
  }

  initialize() {
    void this.serial(async () => {
      this.grant = await this.readGrant()
      this.phase = this.grant ? 'connected' : 'disconnected'
      if (this.grant) this.mount()
    }).catch(() => { this.phase = 'failed'; this.error = 'Unable to read Desktop Commander credentials.' })
  }

  serial(operation) {
    const result = this.queue.then(() => {
      if (this.stopped) throw new Error('Desktop Commander plugin was unloaded.')
      return operation()
    })
    this.queue = result.catch(() => {})
    return result
  }

  view() {
    return {
      phase: this.phase,
      connection: this.status,
      toolCount: this.tools.size,
      ...(this.attempt?.url && !this.attempt.exchanging ? { authorizationUrl: this.attempt.url } : {}),
      ...(this.error ? { error: this.error } : {}),
    }
  }

  begin() {
    if (this.grant && this.phase !== 'needs-auth') return Promise.resolve(this.view())
    if (this.starting) return this.starting
    const start = this.serial(async () => {
      if (this.attempt) return this.view()
      this.error = undefined
      let callback
      try {
        callback = await openCallback()
      } catch {
        this.error = 'Unable to open the local authorization callback.'
        return this.view()
      }
      if (this.stopped) { callback.close(); return this.view() }
      const controller = new AbortController()
      const attempt = { callback, controller, url: undefined, exchanging: false }
      this.attempt = attempt
      this.phase = 'authorizing'
      const provider = oauthProvider({
        redirectUrl: callback.redirectUrl,
        authorize: url => {
          if (url.origin !== this.server.origin) throw new Error('Unexpected authorization URL.')
          attempt.url = url.href
        },
      })
      callback.receive(params => this.receive(attempt, provider, params))
      attempt.timer = setTimeout(() => this.finishAttempt(attempt, 'Desktop Commander sign-in expired.'), callbackLifetime)
      const fetcher = vendorFetch(this.fetcher, this.server, AbortSignal.any([
        controller.signal, AbortSignal.timeout(connectionTimeout),
      ]))
      try {
        const result = await requestAuthorization(provider, this.server, fetcher)
        if (result !== 'REDIRECT' || !attempt.url) throw new Error('Expected an authorization redirect.')
      } catch {
        this.finishAttempt(attempt, 'Unable to start Desktop Commander sign-in. Try again.')
      }
      return this.view()
    })
    this.starting = start.finally(() => { this.starting = undefined })
    return this.starting
  }

  async receive(attempt, provider, params) {
    if (this.attempt !== attempt || attempt.exchanging || !sameState(provider.state(), params.get('state'))) {
      return { status: 400, message: 'Invalid or expired Desktop Commander authorization request.' }
    }
    if (params.has('error') || !params.get('code')) {
      this.finishAttempt(attempt, 'Desktop Commander authorization was declined or interrupted.')
      return { status: 400, message: 'Authorization was not completed. Return to DeepSeek Harness to try again.' }
    }
    attempt.exchanging = true
    const signal = AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(connectionTimeout)])
    try {
      const result = await requestAuthorization(provider, this.server, vendorFetch(this.fetcher, this.server, signal), {
        authorizationCode: params.get('code'), iss: params.get('iss') ?? undefined,
      })
      if (result !== 'AUTHORIZED') throw new Error('No grant received.')
      const grant = provider.grant()
      await this.serial(async () => {
        if (this.attempt !== attempt) throw new Error('Authorization expired.')
        await this.ctx.credentials.modifyRecord(key, () => ({ kind: 'grant', payload: grant }))
        if (this.attempt !== attempt || this.stopped) {
          await this.ctx.credentials.deleteRecord(key)
          throw new Error('Authorization cancelled.')
        }
        this.grant = grant
        this.finishAttempt(attempt)
        this.phase = 'connected'
        this.error = undefined
        await this.drop()
        this.mount()
      })
      return { status: 200, message: 'Desktop Commander is connected. You can close this tab and return to DeepSeek Harness.' }
    } catch {
      this.finishAttempt(attempt, 'Desktop Commander sign-in failed. Try again.')
      return { status: 502, message: 'Unable to finish Desktop Commander sign-in. Return to DeepSeek Harness to retry.' }
    }
  }

  finishAttempt(attempt, error) {
    if (!attempt || this.attempt !== attempt) return
    this.attempt = undefined
    clearTimeout(attempt.timer)
    attempt.controller.abort()
    attempt.callback.close()
    this.phase = this.grant ? 'needs-auth' : error ? 'failed' : 'disconnected'
    this.error = error
  }

  cancel() {
    this.finishAttempt(this.attempt)
    return this.view()
  }

  disconnect() {
    this.cancel()
    return this.serial(async () => {
      this.cancel()
      await this.ctx.credentials.deleteRecord(key)
      this.grant = undefined
      this.phase = 'disconnected'
      this.error = undefined
      clearTimeout(this.reconnect)
      await this.drop()
      return this.view()
    })
  }

  retry() {
    return this.serial(async () => {
      if (this.grant && this.phase === 'connected') {
        clearTimeout(this.reconnect)
        await this.drop()
        this.mount()
      }
      return this.view()
    })
  }

  async readGrant() {
    const record = await this.ctx.credentials.readRecord(key)
    if (record?.kind !== 'grant') return undefined
    const grant = record.payload
    if (typeof grant?.tokens?.access_token !== 'string' || typeof grant.registration?.client_id !== 'string'
      || !/^http:\/\/127\.0\.0\.1:\d+\/desktop-commander\/callback$/.test(grant.redirectUrl)) return undefined
    return grant
  }

  async token() {
    return (await this.readGrant())?.tokens.access_token
  }

  refresh(staleToken, signal) {
    return this.serial(async () => {
      let updated
      await this.ctx.credentials.modifyRecord(key, async record => {
        if (record?.kind !== 'grant' || !this.grant) throw new UnauthorizedError('Connect Desktop Commander in Settings.')
        const current = record.payload
        if (current.tokens.access_token !== staleToken) { updated = current; return }
        const provider = oauthProvider(current)
        await requestAuthorization(provider, this.server, vendorFetch(this.fetcher, this.server, signal))
        signal.throwIfAborted()
        updated = provider.grant()
        return { kind: 'grant', payload: updated }
      })
      this.grant = updated
    })
  }

  mount() {
    if (this.stopped) return
    clearTimeout(this.reconnect)
    this.status = 'connecting'
    this.error = undefined
    const state = { controller: new AbortController() }
    const expiredTokens = new WeakMap()
    const fetcher = vendorFetch(this.fetcher, this.server, state.controller.signal)
    const transport = new StreamableHTTPClientTransport(this.server, {
      fetch: async (input, init) => {
        const response = await fetcher(input, init)
        if (response.status === 401) {
          const authorization = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('authorization')
          expiredTokens.set(response, authorization?.slice('Bearer '.length))
        }
        return response
      },
      authProvider: {
        token: () => this.token(),
        onUnauthorized: async ({ response }) => {
          const bearer = expiredTokens.get(response)
          const signal = AbortSignal.any([state.controller.signal, AbortSignal.timeout(connectionTimeout)])
          await this.refresh(bearer, signal)
        },
      },
    })
    // Keep the exact token attached to each rejected HTTP request, so another
    // request's successful refresh never rotates the same grant again.
    const client = new Client({ name: 'dsh-remote-dc', version: '0.2.0' }, {
      listChanged: { tools: { onChanged: (error, tools) => {
        if (!error && tools && this.current === state) {
          try { this.publish(state, tools) } catch { void this.connectionFailed(state) }
        }
      } } },
    })
    client.onclose = () => {
      if (this.status === 'connected' && this.current === state) void this.connectionFailed(state)
    }
    state.client = client
    state.transport = transport
    this.current = state
    const signal = AbortSignal.any([state.controller.signal, AbortSignal.timeout(connectionTimeout)])
    const timeout = setTimeout(() => { if (this.status === 'connecting' && this.current === state) void this.connectionFailed(state) }, connectionTimeout)
    timeout.unref()
    void (async () => {
      try {
        await client.connect(transport)
        signal.throwIfAborted()
        const tools = client.getServerCapabilities()?.tools ? (await client.listTools(undefined, { signal })).tools : []
        if (this.current !== state) return
        this.publish(state, tools)
        this.status = 'connected'
        this.retryDelay = 1000
      } catch (error) {
        if (this.current === state) await this.connectionFailed(state, error)
      } finally { clearTimeout(timeout) }
    })()
  }

  publish(state, tools) {
    const definitions = new Map()
    for (const tool of tools) {
      const name = prefix + tool.name
      if (!publicName.test(name) || definitions.has(tool.name)) {
        throw new Error('Unsupported Desktop Commander tool name.')
      }
      definitions.set(tool.name, createMcpToolDefinition(this.ctx, {
        name, rawName: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema, taskRequired: tool.execution?.taskSupport === 'required',
        call: (args, execution) => this.call(state, tool.name, args, execution.signal),
      }))
    }
    this.clearTools()
    try {
      for (const definition of definitions.values()) this.disposers.push(this.ctx.tools.register(definition))
      this.tools = new Map(tools.map(tool => [tool.name, tool]))
    } catch (error) {
      this.clearTools()
      throw error
    }
  }

  clearTools() {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.tools.clear()
  }

  async call(state, name, args, signal) {
    const definition = this.tools.get(name)
    if (this.current !== state || this.status !== 'connected' || !definition) {
      throw new Error('Desktop Commander is unavailable. Check its connection in Settings.')
    }
    try {
      return await state.client.callTool({ name, arguments: args }, {
        signal: AbortSignal.any([signal, state.controller.signal]), timeout: callTimeout, toolDefinition: definition,
      })
    } catch (error) {
      if (authFailure(error)) void this.connectionFailed(state, error)
      throw error
    }
  }

  async devices(signal) {
    if (!this.current || !this.tools.has('list_devices')) return { text: '' }
    const result = await this.call(this.current, 'list_devices', {}, signal)
    return { text: result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'), failed: result.isError === true }
  }

  async connectionFailed(state, error) {
    if (this.current !== state) return
    const needsAuth = authFailure(error)
    this.status = needsAuth ? 'disconnected' : 'failed'
    if (needsAuth) this.phase = 'needs-auth'
    this.error = needsAuth
      ? 'Desktop Commander authorization expired. Connect your account again.'
      : 'Unable to connect to Desktop Commander. Retry the connection.'
    await this.drop(false)
    if (!needsAuth && !this.stopped && this.phase === 'connected' && !this.current) {
      this.reconnect = setTimeout(() => {
        if (this.phase === 'connected' && !this.current) this.mount()
      }, this.retryDelay)
      this.reconnect.unref()
      this.retryDelay = Math.min(30000, this.retryDelay * 2)
    }
  }

  async drop(resetStatus = true) {
    const state = this.current
    this.current = undefined
    this.clearTools()
    if (resetStatus) this.status = 'disconnected'
    if (!state) return
    state.controller.abort()
    await state.client.close().catch(() => {})
  }

  async dispose() {
    this.stopped = true
    clearTimeout(this.reconnect)
    this.cancel()
    await this.drop()
    await this.queue
  }
}
