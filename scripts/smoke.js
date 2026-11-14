import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const here = fileURLToPath(new URL('.', import.meta.url))
const packageDir = resolve(here, '..')
const fixture = join(here, 'fixture-mcp.js')
const configuredExecutable = process.env.RDC_SMOKE_EXECUTABLE
const executable = configuredExecutable ? resolve(configuredExecutable) : fixture
const sshConfig = process.env.RDC_SMOKE_SSH_CONFIG
const checkout = process.env.RDC_SMOKE_CHECKOUT === '1'
const realBackend = executable !== fixture
const home = await mkdtemp(join(tmpdir(), 'dsh-rdc-smoke-'))
const env = { ...process.env, DSH_HOME: home, RDC_SMOKE_REAL: realBackend ? '1' : '0' }
const profile = 'web'
const cli = (...args) => execFileSync('dsh', args, { encoding: 'utf8', env, timeout: 90000 })
const source = join(home, 'sample.txt')
const destination = join(home, 'new.txt')
const probe = join(home, 'probe.mjs')
const accountProbe = join(home, 'account-probe.mjs')
const patch = join(home, 'probe.patch.yml')
const reportFile = join(home, 'report.json')
const accountReportFile = join(home, 'account-report.json')
env.RDC_SMOKE_REPORT = reportFile
env.RDC_ACCOUNT_REPORT = accountReportFile
env.RDC_SMOKE_SOURCE = source
env.RDC_SMOKE_DESTINATION = destination

const device = sshConfig
  ? { transport: 'ssh', sshHost: 'rdc-smoke', sshConfig, executable, access: 'shell', cwd: home }
  : { transport: 'local', executable, access: 'shell', cwd: home }

try {
  await writeFile(source, 'Test from Desktop Commander\n')
  await writeFile(probe, await readFile(join(here, 'smoke-probe.js')))
  await writeFile(accountProbe, await readFile(join(here, 'account-probe.js')))
  const { access: _access, ...reader } = device
  const config = [
    { id: 'tool-executor-native', disabled: false },
    { id: 'remote-dc', config: { devices: {
      primary: device,
      reader,
      inactive: { transport: 'local', executable: '/does/not/exist', enabled: false },
    } } },
    { insert: [{ id: 'rdc-smoke-probe', name: probe }, { id: 'rdc-account-probe', name: accountProbe }] },
  ]
  // JSON is a YAML subset and keeps fixture paths with spaces intact.
  await writeFile(patch, JSON.stringify(config))
  let installSource = packageDir
  if (!checkout) {
    const pack = execFileSync('npm', ['pack', '--json', '--pack-destination', home], { cwd: packageDir, encoding: 'utf8' })
    installSource = join(home, JSON.parse(pack)[0].filename)
  }
  cli('--profile', profile, '--dump-config')
  cli('plugin', '--profile', profile, 'add', installSource)
  assert.match(cli('--profile', profile, '--dump-config'), /remote-dc/)
  const host = spawn('dsh', ['--profile', profile, '--patch', patch, '--no-open', '--port', '0'], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const closed = once(host, 'close')
  let hostLog = ''
  for (const stream of [host.stdout, host.stderr]) {
    stream.on('data', chunk => { hostLog += chunk })
  }
  const log = () => hostLog.replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
  let report
  let accountReport
  try {
    const deadline = Date.now() + 65000
    const readReport = async path => {
      try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    while (!report || !accountReport) {
      report ??= await readReport(reportFile)
      accountReport ??= await readReport(accountReportFile)
      if (report && accountReport) break
      assert.equal(host.exitCode, null, 'DSH host exited while running the probe')
      assert.ok(Date.now() < deadline, 'Timed out waiting for the probe')
      await delay(100)
    }
    assert.equal(report.ok, true, report.error)
    assert.equal(accountReport.ok, true, accountReport.error)
  } catch (error) {
    console.error(log())
    throw error
  } finally {
    host.kill('SIGTERM')
    const kill = setTimeout(() => host.kill('SIGKILL'), 8000)
    await closed.finally(() => clearTimeout(kill))
    if (process.env.RDC_SMOKE_VERBOSE === '1') console.error(log())
  }
  assert.match(await readFile(destination, 'utf8'), /created via Desktop Commander/)
  if (realBackend) assert.match(await readFile(destination, 'utf8'), /updated via Desktop Commander/)
  cli('plugin', '--profile', profile, 'remove', 'dsh-remote-dc')
  assert.doesNotMatch(cli('--profile', profile, '--dump-config'), /name: dsh-remote-dc/)
  console.log(JSON.stringify({ ...report, accountChecks: accountReport.checks, transport: device.transport, realBackend, uninstalled: true }, null, 2))
} catch (error) {
  if (error.stdout) console.error(error.stdout)
  if (error.stderr) console.error(error.stderr)
  try { console.error(await readFile(reportFile, 'utf8')) } catch (failure) {
    if (failure.code !== 'ENOENT') console.error(failure.message)
  }
  throw error
} finally {
  await rm(home, { recursive: true, force: true })
}
