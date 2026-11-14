const readTools = [
  'list_directory', 'get_file_info', 'read_file', 'read_multiple_files',
  'start_search', 'get_more_search_results', 'stop_search', 'list_searches',
]
const writeTools = [
  'create_directory', 'write_file', 'edit_block', 'move_file', 'write_pdf',
]
const terminalTools = [
  'start_process', 'read_process_output', 'interact_with_process', 'force_terminate',
  'list_sessions', 'list_processes', 'kill_process',
]

export function allowedTools(access) {
  switch (access) {
    case 'read': return new Set(readTools)
    case 'write': return new Set([...readTools, ...writeTools])
    case 'shell': return new Set([...readTools, ...writeTools, ...terminalTools])
    default: throw new Error('remote-dc: invalid device access mode')
  }
}

export function describeTool(tool) {
  if (tool.name !== 'read_file') return tool
  const { isUrl, ...properties } = tool.inputSchema.properties ?? {}
  return {
    ...tool,
    description: 'Read text, images, or supported documents from an absolute path on the selected device. Use offset and length for lines or pages, and sheet and range for spreadsheets.',
    inputSchema: { ...tool.inputSchema, properties },
  }
}
