import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { desktopCommanderCommand, resolveDevices } from '../src/devices.js'

const proxy = fileURLToPath(new URL('../src/proxy.js', import.meta.url))
const executable = fileURLToPath(new URL('./fixture-mcp.js', import.meta.url))

test('validates device identifiers and quotes absolute paths for SSH', async t => {
  for (const [id, params] of [
    ['Bad-ID', { transport: 'local' }],
    ['a', { transport: 'ssh', sshHost: '-oProxyCommand' }],
    ['a', { transport: 'ssh', sshHost: 'valid', cwd: '\u000a/x' }],
    ['a', { transport: 'local', sshConfig: '/tmp/config' }],
  ]) {
    assert.throws(() => resolveDevices({ [id]: { executable, ...params } }), /remote-dc:/)
  }

  const cwd = await mkdtemp(join(tmpdir(), "rdc quote ' $ "))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const [device] = resolveDevices({
    a: { transport: 'ssh', sshHost: 'verified-alias', sshConfig: '/tmp/config', executable: '/usr/bin/env', cwd },
  })
  const { args } = desktopCommanderCommand(device)
  assert.deepEqual(args.slice(-3, -1), ['--', 'verified-alias'])
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes('ClearAllForwardings=yes'))
  assert.ok(args.includes('ForwardAgent=no'))
  const clientConfig = spawnSync('ssh', ['-G', ...args.filter((_, index) => index !== 0 && index !== 1)], {
    encoding: 'utf8',
  })
  assert.equal(clientConfig.status, 0, clientConfig.stderr)
  const result = spawnSync('/bin/sh', ['-c', args.at(-1).replace(' --no-onboarding', '')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes(`PWD=${cwd}\n`))
  assert.ok(result.stdout.includes('DESKTOP_COMMANDER_DISABLE_TELEMETRY=1\n'))
})

for (const [access, described] of [
  ['read', ['read_file']],
  ['write', ['read_file', 'write_file']],
  ['shell', ['read_file', 'write_file', 'start_process']],
]) {
  test(`${access} filters discovery and direct calls and cleans up stdio`, { timeout: 8000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'rdc-policy-'))
    const path = join(directory, 'fixture.txt')
    await writeFile(path, 'readable')
    const processHandle = spawn(process.execPath, [
      proxy, JSON.stringify({ executable, id: access, access, transport: 'local' }),
    ], { stdio: ['pipe', 'pipe', 'inherit'] })
    const closed = once(processHandle, 'close')
    t.after(async () => {
      processHandle.kill('SIGTERM')
      await closed
      await rm(directory, { recursive: true, force: true })
    })
    const lines = createInterface({ input: processHandle.stdout })[Symbol.asyncIterator]()
    let id = 0
    async function rpc(method, params) {
      processHandle.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n')
      const { value } = await lines.next()
      assert.ok(value, `connection closed during ${method}`)
      const response = JSON.parse(value)
      assert.equal(response.id, id)
      assert.equal(response.error, undefined)
      return response.result
    }
    const call = (name, args = {}) => rpc('tools/call', { name, arguments: args })
    const { tools } = await rpc('tools/list')
    assert.deepEqual(tools.map(tool => tool.name), described)
    assert.equal(Object.hasOwn(tools[0].inputSchema.properties, 'isUrl'), false)
    assert.equal((await call('read_file', { path })).content[0].text, 'readable')
    assert.equal((await call('read_file', { path, isUrl: true })).isError, true)
    assert.equal((await call('set_config_value')).isError, true)
    assert.equal((await call('start_process')).isError ?? false, access !== 'shell')
    assert.equal((await call('write_file', { path, content: 'changed' })).isError ?? false, access === 'read')
    assert.equal(await readFile(path, 'utf8'), access === 'read' ? 'readable' : 'changed')
    processHandle.stdin.end()
    assert.deepEqual(await closed, [0, null])
  })
}
