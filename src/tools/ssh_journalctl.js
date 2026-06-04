/**
 * SSH Journalctl tool
 * Fetch systemd journal logs from a remote host with filters.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, shellQuote, validateTarget, ensureKey } from '../lib/ssh.js'

export const name = 'ssh_journalctl'

export const description =
  'Fetch systemd journal logs from a remote host. ' +
  'Supports filtering by unit, time range (ISO timestamp or relative like "1h", "30m"), ' +
  'priority, and grep pattern.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  unit: z
    .string()
    .optional()
    .describe('Systemd unit to filter by, e.g. "nginx.service"'),
  since: z
    .string()
    .optional()
    .describe(
      'Start of time range. ISO timestamp ("2024-01-15 10:00:00") or relative shorthand ' +
      '("1h" = last hour, "30m" = last 30 min, "2d" = last 2 days). ' +
      'Relative values are converted to "N minutes/hours/days ago" for journalctl.'
    ),
  until: z
    .string()
    .optional()
    .describe('End of time range. ISO timestamp or relative shorthand (same format as since).'),
  lines: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe('Maximum number of log lines to return (default 100)'),
  priority: z
    .enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'])
    .optional()
    .describe('Minimum log priority level'),
  grep: z
    .string()
    .optional()
    .describe('Filter log lines by regex pattern (journalctl --grep)'),
}

/**
 * Convert relative shorthand ("1h", "30m", "2d") to journalctl "N unit ago" syntax.
 * ISO timestamps are returned as-is.
 */
function resolveTime(value) {
  if (!value) return null
  const relMatch = value.match(/^(\d+)(m|h|d)$/)
  if (!relMatch) return value // assume ISO
  const [, num, unit] = relMatch
  const unitMap = { m: 'minutes', h: 'hours', d: 'days' }
  return `${num} ${unitMap[unit]} ago`
}

export async function handler({ hostname, user, unit, since, until, lines = 100, priority, grep }) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  if (config.dry_run) {
    return { success: true, dry_run: true, hostname, user, unit, since, lines }
  }

  if (!ensureKey()) {
    return { success: false, hostname, error: 'SSH binary or reacher key not found' }
  }

  const args = ['--no-pager', '--output=json-short', `-n ${lines}`]
  if (unit) args.push(`-u ${shellQuote(unit)}`)
  const sinceResolved = resolveTime(since)
  if (sinceResolved) args.push(`--since ${shellQuote(sinceResolved)}`)
  const untilResolved = resolveTime(until)
  if (untilResolved) args.push(`--until ${shellQuote(untilResolved)}`)
  if (priority) args.push(`-p ${priority}`)
  if (grep) args.push(`--grep=${shellQuote(grep)}`)

  const remoteCmd = `journalctl ${args.join(' ')} 2>&1`

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
      resolve({ success: false, hostname, error: err.message })
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, hostname, exitCode: code ?? 1, stderr: stderr.trim(), stdout: stdout.trim() })
      }

      const entries = []
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          entries.push({
            timestamp: obj.__REALTIME_TIMESTAMP
              ? new Date(parseInt(obj.__REALTIME_TIMESTAMP, 10) / 1000).toISOString()
              : undefined,
            unit: obj._SYSTEMD_UNIT || obj.SYSLOG_IDENTIFIER,
            priority: obj.PRIORITY,
            message: obj.MESSAGE,
          })
        } catch {
          // Non-JSON line (e.g. journalctl header) — include as raw
          entries.push({ raw: trimmed })
        }
      }

      resolve({
        success: true,
        hostname,
        user,
        unit: unit || null,
        since: sinceResolved || null,
        count: entries.length,
        entries,
      })
    })
  })
}
