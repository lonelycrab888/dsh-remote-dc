import { isAbsolute } from 'node:path'

const idPattern = /^[a-z][a-z0-9_]{0,23}$/
const aliasPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const invalidPathCharacters = /[\u0000-\u001f\u007f]/

export function resolveDevices(devices) {
  return Object.entries(devices).map(([id, device]) => {
    if (!idPattern.test(id)) {
      throw new Error(`remote-dc: invalid device ID "${id}" (expected [a-z][a-z0-9_]{0,23})`)
    }
    const remote = device.transport === 'ssh'
    const absolute = path => remote ? path.startsWith('/') : isAbsolute(path)
    if (remote && !aliasPattern.test(device.sshHost ?? '')) {
      throw new Error(`remote-dc: devices.${id}.sshHost must be a valid OpenSSH host alias`)
    }
    if (!remote && device.sshHost !== undefined) {
      throw new Error(`remote-dc: devices.${id}.sshHost requires transport: ssh`)
    }
    if (device.sshConfig !== undefined &&
      (!remote || !isAbsolute(device.sshConfig) || invalidPathCharacters.test(device.sshConfig))) {
      throw new Error(`remote-dc: devices.${id}.sshConfig requires SSH and an absolute local path`)
    }
    if (device.cwd !== undefined && (!absolute(device.cwd) || invalidPathCharacters.test(device.cwd))) {
      throw new Error(`remote-dc: devices.${id}.cwd must be an absolute path on the target device`)
    }
    if (device.executable !== 'desktop-commander'
      && (!absolute(device.executable) || invalidPathCharacters.test(device.executable))) {
      throw new Error(`remote-dc: devices.${id}.executable must be an absolute path or desktop-commander`)
    }
    return { ...device, id, serverName: `rdc_${id}` }
  })
}

function quoteForShell(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

export function desktopCommanderCommand(device) {
  const environment = { ...process.env, DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1' }
  if (device.transport === 'local') {
    return {
      command: device.executable,
      args: ['--no-onboarding'],
      options: { cwd: device.cwd, env: environment },
    }
  }
  const changeDirectory = device.cwd ? `cd ${quoteForShell(device.cwd)} && ` : ''
  const remoteCommand = changeDirectory
    + `exec env DESKTOP_COMMANDER_DISABLE_TELEMETRY=1 ${quoteForShell(device.executable)} --no-onboarding`
  return {
    command: 'ssh',
    args: [
      ...(device.sshConfig ? ['-F', device.sshConfig] : []),
      '-T',
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ClearAllForwardings=yes',
      '-o', 'ForwardAgent=no',
      '-o', 'ForwardX11=no',
      '-o', 'Tunnel=no',
      '-o', 'PermitLocalCommand=no',
      '-o', 'RemoteCommand=none',
      '-o', 'ControlMaster=no',
      '-o', 'ControlPath=none',
      '-o', 'ConnectTimeout=8',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=2',
      '--', device.sshHost, remoteCommand,
    ],
    options: { env: environment },
  }
}
