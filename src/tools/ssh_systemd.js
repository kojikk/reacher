/**
 * SSH Systemd tool
 * Manage systemd services on a remote host.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, shellQuote, validateTarget, ensureKey } from '../lib/ssh.js'

export const name = 'ssh_systemd'

export const description =
  'Manage a systemd service on a remote host: start, stop, restart, status, ' +
  'enable, disable, or reload. Returns structured service state.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  service: z.string().describe('Systemd service name, e.g. "nginx" or "nginx.service"'),
  action: z
    .enum(['start', 'stop', 'restart', 'status', 'enable', 'disable', 'reload'])
    .describe('Systemd action to perform'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
}

export async function handler({ hostname, service, action, user }) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  if (config.dry_run) {
    return { success: true, dry_run: true, would_run: `systemctl ${action} ${service}`, hostname, user }
  }

  if (!ensureKey()) {
    return { success: false, hostname, error: 'SSH binary or reacher key not found' }
  }

  const quotedService = shellQuote(service)

  // For 'status' we collect structured output; for others we just run + check exit code
  let remoteCmd
  if (action === 'status') {
    remoteCmd =
      `systemctl is-active ${quotedService} 2>/dev/null; ` +
      `systemctl show ${quotedService} --property=ActiveState,SubState,LoadState,MainPID,MemoryCurrent,TasksCurrent,UnitFileState,ExecMainStartTimestamp 2>/dev/null; ` +
      `journalctl -u ${quotedService} -n 10 --no-pager --output=short-iso 2>/dev/null`
  } else {
    remoteCmd = `systemctl ${action} ${quotedService}`
  }

  const sshArgs = [
    ...SSH_BASE_OPTS,
    `${user}@${hostname}`,
    remoteCmd,
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(SSH_BINARY, sshArgs, { timeout: 30_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, service, action, error: err.message })
    })

    proc.on('close', (code) => {
      if (action !== 'status') {
        return resolve({
          success: code === 0,
          hostname,
          service,
          action,
          exitCode: code ?? 1,
          stderr: stderr.trim() || undefined,
        })
      }

      // Parse status output
      const lines = stdout.split('\n')
      const active = lines[0]?.trim() // is-active output: "active" | "inactive" | "failed" etc.

      const props = {}
      for (const line of lines.slice(1)) {
        const eq = line.indexOf('=')
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        const val = line.slice(eq + 1).trim()
        if (key && val) props[key] = val
      }

      // The last section is journalctl output — everything after the empty line following props
      const journalStart = lines.findIndex((l, i) => i > 0 && l.startsWith('--') || (i > 1 && !l.includes('=')))
      const recentLogs = lines.slice(journalStart >= 0 ? journalStart : lines.length).join('\n').trim()

      resolve({
        success: true,
        hostname,
        service,
        action,
        active,
        state: {
          active: props.ActiveState,
          sub: props.SubState,
          load: props.LoadState,
          unit_file: props.UnitFileState,
          pid: props.MainPID,
          memory: props.MemoryCurrent,
          tasks: props.TasksCurrent,
          started: props.ExecMainStartTimestamp,
        },
        recent_logs: recentLogs || undefined,
      })
    })
  })
}
