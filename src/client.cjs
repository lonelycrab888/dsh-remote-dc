window.__ModuleLoader__.load({
  id: 'dsh-remote-dc',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const page = 'Remote DC for dsh'
    const sectionId = 'remote-desktop-commander'
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
      },
    }
  },
})
