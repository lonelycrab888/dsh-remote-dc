import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Account } from './account.js'
import { resolveDevices } from './devices.js'
import { registerSettings } from './settings-route.js'

export const name = 'remote-dc'
export const inject = { tools: true, credentials: true, connection: false, systemPrompt: false }

const Device = Schema.object({
  transport: Schema.union(['local', 'ssh']).required(),
  sshHost: Schema.string(),
  sshConfig: Schema.string(),
  executable: Schema.string().default('desktop-commander'),
  cwd: Schema.string(),
  access: Schema.union(['read', 'write', 'shell']).default('read'),
  enabled: Schema.boolean().default(true),
  startupTimeoutMs: Schema.number().step(1).min(1000).max(120000).default(20000),
  toolCallTimeoutMs: Schema.number().step(1).min(1000).max(300000).default(60000),
})

export const Config = Schema.object({
  devices: Schema.dict(Device).default({}),
})

export async function apply(ctx, config) {
  const devices = resolveDevices(config.devices)
  const account = new Account(ctx)
  ctx.effect(() => () => account.dispose())
  account.initialize()
  if (ctx.get('connection')?.fetch) registerSettings(ctx, account)
  const prompt = ctx.get('systemPrompt')
  if (prompt) {
    prompt.section({
      name: 'mcp:remote_desktop_commander',
      order: prompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      text: () => {
        const instructions = account.current?.client.getInstructions()?.trim()
        return account.status === 'connected' && instructions && Buffer.byteLength(instructions) <= 32768
          ? 'Remote Desktop Commander MCP server instructions:\n' + instructions
          : ''
      },
    })
  }
  if (devices.length === 0) return

  const launcher = fileURLToPath(new URL('./proxy.js', import.meta.url))
  const connections = new Map()
  const started = new Set()
  const failed = new Set()
  // rc.1 can discover tools but does not expose MCP supervisor status.
  const connectionStatusOf = McpClient.connectionStatusOf
  const prefixes = devices.filter(device => device.enabled)
    .map(device => `mcp__${device.serverName}__`)
    .sort((a, b) => b.length - a.length)
  for (const device of devices) {
    if (!device.enabled) continue
    const fiber = ctx.plugin(McpClient, {
      serverName: device.serverName,
      transport: 'stdio',
      command: process.execPath,
      args: [launcher, JSON.stringify(device)],
      startupTimeoutMs: device.startupTimeoutMs,
      toolCallTimeoutMs: device.toolCallTimeoutMs,
    })
    connections.set(device.id, fiber)
  }

  ctx.tools.register(defineTool({
    name: 'remote_dc_list_devices',
    description: 'List Desktop Commander devices, their connection status, access mode and tool namespace. Paths and session IDs belong to the selected device.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            transport: { type: 'string', required: true },
            access: { type: 'string', required: true },
            status: { type: 'string', required: true },
            toolPrefix: { type: 'string', required: true },
            toolCount: { type: 'integer', required: true },
          },
        },
      },
      render: (_args, devices) => [{ type: 'text', text: JSON.stringify(devices, null, 2) }],
    },
    async execute() {
      const legacyCounts = new Map()
      if (!connectionStatusOf) {
        for (const tool of ctx.tools.schemas()) {
          const prefix = prefixes.find(prefix => tool.name.startsWith(prefix))
          if (prefix) legacyCounts.set(prefix, (legacyCounts.get(prefix) ?? 0) + 1)
        }
      }
      return devices.map(device => {
        const connection = connections.get(device.id)
        const status = connection && connectionStatusOf?.(connection)?.current()
        const toolPrefix = `mcp__${device.serverName}__`
        const legacyCount = legacyCounts.get(toolPrefix) ?? 0
        const fallback = legacyCount > 0 ? 'connected'
          : failed.has(device.id) ? 'failed'
          : started.has(device.id) ? 'disconnected'
          : 'connecting'
        return {
          id: device.id,
          transport: device.transport,
          access: device.access,
          status: status?.state ?? (device.enabled ? fallback : 'disabled'),
          toolPrefix,
          toolCount: status ? (status.state === 'connected' ? status.toolCount : 0) : legacyCount,
        }
      })
    },
  }))
  const startup = [...connections].map(async ([id, fiber]) => {
    try {
      await fiber.await()
      started.add(id)
    } catch (error) {
      failed.add(id)
      ctx.logger.warn(`remote-dc(${id}): device failed to load.`, error)
    }
  })
  await Promise.all(startup)
}
