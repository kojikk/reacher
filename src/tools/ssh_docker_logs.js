/**
 * SSH Docker Logs tool
 * Fetch logs from a Docker container on a remote host.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, shellQuote, validateTarget, ensureKey } from '../lib/ssh.js'

export const name = 'ssh_docker_logs'

export const description =
  'Fetch logs from a Docker container on a remote host. ' +
  'Supports tail, since (ISO or relative "1h"/"30m"), and grep filtering.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  container: z.string().describe('Container name or ID'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  tail: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe('Number of lines from the end of logs (default 100)'),
  since: z
    .string()
    .optional()
    .describe('Show logs since timestamp (ISO) or relative shorthand: "1h", "30m", "2d"'),
  grep: z
    .string()
    .optional()
    .describe('Filter log lines containing this string'),
  timestamps: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include timestamps in output (default true)'),
}

function resolveDockerSince(value) {
  if (!value) return null
  // Docker accepts "1h", "30m", "2h30m" natively — pass through
  // Also accepts ISO timestamps — pass through
  return value
}

export async function handler({ hostname, container, user, tail = 100, since, grep, timestamps = true }) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  if (config.dry_run) {
    return { success: true, dry_run: true, hostname, user, container }
  }

  if (!ensureKey()) {
    return { success: false, hostname, error: 'SSH binary or reacher key not found' }
  }

  const args = [`--tail=${tail}`]
  if (timestamps) args.push('--timestamps')
  const sinceParsed = resolveDockerSince(since)
  if (sinceParsed) args.push(`--since=${shellQuote(sinceParsed)}`)

  let remoteCmd = `docker logs ${args.join(' ')} ${shellQuote(container)} 2>&1`
  if (grep) {
    remoteCmd += ` | grep ${shellQuote(grep)}`
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
      resolve({ success: false, hostname, container, error: err.message })
    })

    proc.on('close', (code) => {
      // grep exits 1 on no matches — not an error
      if (code !== 0 && code !== 1) {
        return resolve({ success: false, hostname, container, exitCode: code ?? 1, stderr: stderr.trim(), stdout: stdout.trim() })
      }

      const lines = stdout.split('\n').filter((l) => l.trim())
      resolve({
        success: true,
        hostname,
        container,
        user,
        count: lines.length,
        logs: stdout.trim(),
      })
    })
  })
}
