import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { desktopCommanderCommand } from './devices.js'
import { allowedTools, describeTool } from './policy.js'

// Preserve stdio framing and MCP request IDs. DSH owns connection supervision,
// schema discovery, tool rendering, timeouts and cancellation.
const device = JSON.parse(process.argv[2])
const tools = allowedTools(device.access)
const launch = desktopCommanderCommand(device)
const server = spawn(launch.command, launch.args, { ...launch.options, stdio: ['pipe', 'pipe', 'inherit'] })
const clientLines = createInterface({ input: process.stdin, crlfDelay: Infinity })
const serverLines = createInterface({ input: server.stdout, crlfDelay: Infinity })
const pendingLists = new Set()
let stopping = false
let inputPaused = false
let outputPaused = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  clientLines.close()
  process.stdin.pause()
  serverLines.close()
  server.stdin.destroy()
  server.stdout.destroy()
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return
  server.kill('SIGTERM')
  const timer = setTimeout(() => server.kill('SIGKILL'), 1500)
  timer.unref()
  server.once('close', () => clearTimeout(timer))
}

function reply(message) {
  if (process.stdout.write(JSON.stringify(message) + '\n') || outputPaused) return
  outputPaused = true
  serverLines.pause()
  clientLines.pause()
  process.stdout.once('drain', () => {
    outputPaused = false
    if (stopping) return
    serverLines.resume()
    if (!inputPaused) clientLines.resume()
  })
}

function parse(line) {
  const message = JSON.parse(line)
  if (message?.jsonrpc !== '2.0' || Array.isArray(message)) {
    throw new Error('expected a JSON-RPC 2.0 message')
  }
  return message
}

clientLines.on('line', line => {
  if (stopping || !line.trim()) return
  let message
  try {
    message = parse(line)
  } catch {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid MCP stdio message' } })
    return
  }
  const denied = message.method === 'tools/call' && (
    !tools.has(message.params?.name)
    || (message.params.name === 'read_file' && message.params.arguments?.isUrl === true)
  )
  if (denied) {
    if (message.id !== undefined) {
      reply({
        jsonrpc: '2.0',
        id: message.id,
        result: { isError: true, content: [{ type: 'text', text: 'This call is disabled for the selected device.' }] },
      })
    }
    return
  }
  if (message.method === 'tools/list') pendingLists.add(message.id)
  if (message.method === 'notifications/cancelled') pendingLists.delete(message.params?.requestId)
  if (!server.stdin.write(line + '\n') && !inputPaused) {
    inputPaused = true
    clientLines.pause()
    server.stdin.once('drain', () => {
      inputPaused = false
      if (!stopping && !outputPaused) clientLines.resume()
    })
  }
})

serverLines.on('line', line => {
  if (stopping || !line.trim()) return
  try {
    const message = parse(line)
    if (!message.method && pendingLists.delete(message.id) && message.result) {
      message.result.tools = message.result.tools.filter(tool => tools.has(tool.name)).map(describeTool)
    }
    reply(message)
  } catch {
    console.error(`remote-dc(${device.id}): invalid MCP response from Desktop Commander. Ensure the transport's stdout is reserved for JSON-RPC.`)
    stop(1)
  }
})

clientLines.on('close', () => stop())
server.on('error', error => {
  console.error(`remote-dc(${device.id}): unable to launch ${launch.command}: ${error.message}`)
  stop(1)
})
server.stdin.on('error', error => {
  if (stopping || error.code === 'EPIPE') return
  console.error(`remote-dc(${device.id}): transport input failed: ${error.message}`)
  stop(1)
})
server.on('close', code => stop(code ?? 1))
process.stdout.on('error', () => stop(1))
process.on('SIGTERM', () => stop())
process.on('SIGINT', () => stop())
