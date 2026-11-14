#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const supported = ['read_file', 'write_file', 'start_process', 'set_config_value']
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  const { id, method, params } = JSON.parse(line)
  if (id === undefined) continue
  let result
  let error
  switch (method) {
    case 'initialize':
      result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'test-device', version: '1.0.0' } }
      break
    case 'tools/list':
      result = {
        tools: supported.map(name => ({
          name,
          inputSchema: { type: 'object', properties: name === 'read_file' ? { path: { type: 'string' }, isUrl: { type: 'boolean' } } : {} },
        })),
      }
      break
    case 'tools/call': {
      const args = params.arguments
      if (params.name === 'read_file') {
        result = { content: [{ type: 'text', text: await readFile(args.path, 'utf8') }] }
      } else if (params.name === 'write_file') {
        await writeFile(args.path, args.content)
        result = { content: [{ type: 'text', text: 'written' }] }
      } else {
        result = { content: [{ type: 'text', text: `forwarded ${params.name}` }] }
      }
      break
    }
    default:
      error = { code: -32601, message: 'Unknown method' }
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result, error }) + '\n')
}
