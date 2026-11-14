window.__ModuleLoader__.load({
  id: 'dsh-remote-dc',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const page = 'Remote Desktop Commander'
    const sectionId = 'remote-desktop-commander'
    // 64px PNG for the settings navigation on Web and Electron.
    const artwork = 'data:image/png;base64,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'
    const copy = {
      en: {
        account: 'Desktop Commander account', loading: 'Checking connection…', connect: 'Connect account',
        reconnect: 'Reconnect account', disconnect: 'Disconnect', cancel: 'Cancel sign-in',
        retry: 'Retry connection', pending: 'Complete sign-in in the browser, then return here.',
        link: 'Open authorization page', devices: 'Paired devices', refresh: 'Refresh devices',
        manage: 'Manage and pair devices', unavailable: 'Desktop Commander settings are unavailable. Restart this dsh profile.',
        signedIn: 'Account connected', offline: 'Account disconnected', expired: 'Authorization expired',
        connecting: 'Connecting to MCP…', failed: 'MCP connection failed', tools: n => `${n} MCP tools available`,
        help: 'Run this on the computer you want to control. Verify the pairing code with the same Desktop Commander account.',
      },
      zh: {
        account: 'Desktop Commander 账户', loading: '正在检查连接…', connect: '连接账户',
        reconnect: '重新连接账户', disconnect: '断开连接', cancel: '取消登录',
        retry: '重试连接', pending: '请在浏览器中完成登录，再返回这里。',
        link: '打开授权页面', devices: '已配对设备', refresh: '刷新设备',
        manage: '管理与配对设备', unavailable: '无法访问 Desktop Commander 设置。请重启当前 dsh 配置档。',
        signedIn: '账户已连接', offline: '账户未连接', expired: '授权已过期',
        connecting: '正在连接 MCP…', failed: 'MCP 连接失败', tools: n => `已加载 ${n} 个 MCP 工具`,
        help: '在要控制的电脑上运行以下命令，并用同一个 Desktop Commander 账户核对配对码。',
      },
    }

    async function request(action, signal) {
      const response = await fetch('api/dsh-remote-dc.account', {
        method: action ? 'POST' : 'GET',
        headers: { 'x-dsh-remote-dc': 'settings', ...(action ? { 'content-type': 'application/json' } : {}) },
        ...(action ? { body: JSON.stringify({ action }) } : {}),
        signal,
      })
      if (response.status === 404) return { phase: 'unavailable' }
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      return result
    }

    function Settings() {
      const t = copy[document.documentElement.lang.startsWith('zh') ? 'zh' : 'en']
      const [view, setView] = useState({ phase: 'loading' })
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [deviceResult, setDeviceResult] = useState()

      useEffect(() => {
        const controller = new AbortController()
        let timer
        async function refresh() {
          try {
            const result = await request(undefined, controller.signal)
            if (!controller.signal.aborted) setView(result)
          } catch (cause) {
            if (!controller.signal.aborted) setError(cause.message)
          } finally {
            if (!controller.signal.aborted) timer = setTimeout(refresh, 1500)
          }
        }
        if (!busy) void refresh()
        return () => { controller.abort(); clearTimeout(timer) }
      }, [busy])

      useEffect(() => {
        if (view.connection !== 'connected') {
          setDeviceResult(undefined)
          return
        }
        const controller = new AbortController()
        request('devices', controller.signal).then(result => {
          if (!controller.signal.aborted) setDeviceResult(result)
        }, cause => {
          if (!controller.signal.aborted) setError(cause.message)
        })
        return () => controller.abort()
      }, [view.connection])

      async function run(action) {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          const result = await request(action)
          if (action === 'devices') setDeviceResult(result)
          else setView(result)
        } catch (cause) {
          setError(cause.message)
        } finally { setBusy(false) }
      }

      const button = (action, label) => h('button', {
        type: 'button', className: 'dsh-rdc-button', disabled: busy, onClick: () => void run(action),
      }, label)
      const link = (url, label) => h('a', {
        className: 'dsh-rdc-button', href: url, target: '_blank', rel: 'noopener noreferrer',
      }, label)
      const phase = view.phase
      const status = {
        loading: t.loading, disconnected: t.offline, failed: t.offline, authorizing: t.pending,
        'needs-auth': t.expired, connected: t.signedIn, unavailable: t.unavailable,
      }[phase]
      return h('section', { className: 'dsh-rdc-settings', 'aria-label': page, 'aria-busy': busy },
        h('h2', null, page),
        h('div', { className: 'dsh-rdc-card' },
          h('h3', null, t.account),
          h('p', { role: 'status' }, status),
          phase === 'connected' && h('p', null, {
            connecting: t.connecting, failed: t.failed, connected: t.tools(view.toolCount),
          }[view.connection]),
          h('div', { className: 'dsh-rdc-actions' },
            (phase === 'disconnected' || phase === 'failed') && button('connect', t.connect),
            phase === 'needs-auth' && button('connect', t.reconnect),
            ['connected', 'needs-auth'].includes(phase) && button('disconnect', t.disconnect),
            phase === 'authorizing' && view.authorizationUrl && link(view.authorizationUrl, t.link),
            phase === 'authorizing' && button('cancel', t.cancel),
            phase === 'connected' && view.connection === 'failed' && button('retry', t.retry)),
          (error || view.error) && h('p', { role: 'alert', className: 'dsh-rdc-error' }, error || view.error)),
        h('div', { className: 'dsh-rdc-card' },
          h('h3', null, t.devices),
          h('p', null, t.help),
          h('pre', null, 'npx @wonderwhy-er/desktop-commander@latest remote'),
          h('div', { className: 'dsh-rdc-actions' },
            link('https://mcp.desktopcommander.app/', t.manage),
            view.connection === 'connected' && button('devices', t.refresh)),
          deviceResult?.text && h('pre', {
            ...(deviceResult.failed ? { role: 'alert', className: 'dsh-rdc-error' } : {}),
          }, deviceResult.text)))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = `
            .dsh-rdc-settings{display:grid;gap:16px;padding:8px 0;max-width:760px;color:var(--dsw-alias-label-primary,inherit)}
            .dsh-rdc-settings h2,.dsh-rdc-settings h3,.dsh-rdc-settings p{margin:0}
            .dsh-rdc-settings h2{font-size:20px;font-weight:650}
            .dsh-rdc-settings h3{font-size:14px;font-weight:650}
            .dsh-rdc-settings p{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,inherit)}
            .dsh-rdc-card{display:grid;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px;min-width:0}
            .dsh-rdc-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
            .dsh-rdc-button{display:inline-flex;align-items:center;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:8px;color:inherit;background:transparent;text-decoration:none;cursor:pointer;font:inherit;font-size:13px}
            .dsh-rdc-button:hover{background:var(--dsw-alias-interactive-bg-hover,#8882)}
            .dsh-rdc-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4569da);outline-offset:2px}
            .dsh-rdc-button:disabled{opacity:.55;cursor:wait}
            .dsh-rdc-settings pre{margin:0;padding:10px 12px;overflow:auto;max-height:320px;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,#8882);font-size:12px}
            .dsh-rdc-settings .dsh-rdc-error{color:var(--dsw-alias-state-danger,#d64545)}
          `
          document.head.append(style)
          return () => style.remove()
        })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: sectionId, order: 60, label: page,
        }, Settings))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: sectionId, label: page,
        }, ({ size }) => h('img', { src: artwork, width: size, height: size, alt: '' })))
      },
    }
  },
})
