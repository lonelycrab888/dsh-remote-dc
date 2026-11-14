import assert from 'node:assert/strict'
import { rename, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(() => {
    const timer = setTimeout(() => { void run(ctx) }, 100)
    return () => clearTimeout(timer)
  })
}

async function run(ctx) {
  const checks = []
  let id = 0
  const source = process.env.RDC_SMOKE_SOURCE
  const destination = process.env.RDC_SMOKE_DESTINATION
  const names = () => ctx.tools.schemas().map(tool => tool.name)
  const call = async (name, args) => {
    const { results } = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: `remote-dc-smoke-${++id}`, name, arguments: JSON.stringify(args) }],
      signal: AbortSignal.timeout(20000),
    })
    const result = results[0].result
    assert.equal(result.isError, false, JSON.stringify(result))
    return result
  }
  const text = result => result.content.map(block => block.text ?? '').join('\n')
  const primary = (name, args) => call(`mcp__rdc_primary__${name}`, args)
  let report
  try {
    const deadline = Date.now() + 40000
    while (!names().includes('mcp__rdc_reader__read_file') || !names().includes('mcp__rdc_primary__read_file')) {
      assert.ok(Date.now() < deadline, `Devices did not connect: ${names().join(', ')}`)
      await delay(100)
    }
    assert.ok(!names().includes('mcp__rdc_reader__write_file'))
    assert.ok(!names().includes('mcp__rdc_reader__start_process'))
    assert.ok(!names().some(name => name.endsWith('__set_config_value')))
    const devices = (await call('remote_dc_list_devices', {})).value
    assert.deepEqual(Object.fromEntries(devices.map(({ id, status }) => [id, status])), {
      primary: 'connected', reader: 'connected', inactive: 'disabled',
    })
    assert.equal(devices.find(device => device.id === 'reader').access, 'read')
    checks.push('Device status, namespace and read-only discovery')
    assert.match(text(await call('mcp__rdc_reader__read_file', { path: source })), /Test from Desktop Commander/)
    await primary('write_file', { path: destination, content: 'created via Desktop Commander\n' })
    checks.push('File read and write through DSH')
    if (process.env.RDC_SMOKE_REAL === '1') {
      assert.match(text(await primary('list_directory', { path: process.env.DSH_HOME, depth: 1 })), /sample\.txt/)
      await primary('edit_block', {
        file_path: destination,
        old_string: 'created via Desktop Commander',
        new_string: 'created via Desktop Commander\nupdated via Desktop Commander',
      })
      const launch = text(await primary('start_process', {
        command: "/bin/sh -c 'printf READY; read -r line && printf \"\\nRDC_REPLY=%s\\n\" \"$line\"'",
        timeout_ms: 1000,
      }))
      const pid = Number(launch.match(/\bPID[: ]+([0-9]+)/i)?.[1])
      assert.ok(pid > 0, launch)
      const response = text(await primary('interact_with_process', { pid, input: 'pong', timeout_ms: 3000 }))
      assert.match(response, /RDC_REPLY=pong/)
      const start = text(await primary('start_search', {
        path: process.env.DSH_HOME, pattern: 'Test from Desktop Commander', searchType: 'content',
        literalSearch: true, filePattern: 'sample.txt', contextLines: 0, maxResults: 4, timeout_ms: 3000,
      }))
      const sessionId = start.match(/\bsearch_[a-zA-Z0-9_-]+/)?.[0]
      assert.ok(sessionId, start)
      const searchDeadline = Date.now() + 8000
      let page
      do {
        page = text(await primary('get_more_search_results', { sessionId, offset: 0, length: 4 }))
        if (/sample\.txt/.test(page) || !/IN PROGRESS/i.test(page)) break
        await delay(100)
      } while (Date.now() < searchDeadline)
      assert.match(page, /sample\.txt/)
      checks.push('Directory listing, block edit, interactive process, and search session with the upstream server')
    }
    report = { ok: true, checks, modelCalls: 0 }
  } catch (error) {
    report = { ok: false, error: error.stack }
  }
  await writeFile(process.env.RDC_SMOKE_REPORT + '.tmp', JSON.stringify(report))
  await rename(process.env.RDC_SMOKE_REPORT + '.tmp', process.env.RDC_SMOKE_REPORT)
}
