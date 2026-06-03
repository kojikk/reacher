/**
 * SSH Process List tool
 * Lists running processes on a remote host with optional sorting and filtering.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_process_list'

export const description =
  'List running processes on a remote host. Supports sorting by CPU or memory usage, ' +
  'filtering by process name or PID, and limiting result count.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  sort_by: z
    .enum(['cpu', 'mem', 'pid'])
    .optional()
    .default('cpu')
    .describe('Sort processes by cpu, mem, or pid (default: cpu)'),
  filter_name: z
    .string()
    .optional()
    .describe('Filter processes whose command contains this string'),
  filter_pid: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Show only the process with this PID'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe('Maximum number of processes to return (default 50)'),
}

export async function handler({ hostname, user, sort_by = 'cpu', filter_name, filter_pid, limit = 50 }) {
  if (config.dry_run) {
    return { success: true, dry_run: true, hostname, user }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  const sortFlag = sort_by === 'mem' ? '--sort=-%mem' : sort_by === 'pid' ? '--sort=pid' : '--sort=-%cpu'
  // ps output: pid ppid user %cpu %mem vsz rss stat command
  let remoteCmd = `ps axo pid,ppid,user,%cpu,%mem,vsz,rss,stat,command ${sortFlag} --no-headers 2>/dev/null | head -n ${limit + 1}`

  if (filter_pid) {
    remoteCmd = `ps -p ${filter_pid} -o pid,ppid,user,%cpu,%mem,vsz,rss,stat,command --no-headers 2>/dev/null`
  }

  const sshArgs = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'IdentitiesOnly=yes',
    '-i', '/root/.ssh/reacher-key',
    `${user}@${hostname}`,
    remoteCmd,
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn('/usr/bin/ssh', sshArgs, { timeout: 15_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, error: err.message })
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, hostname, exitCode: code ?? 1, stderr: stderr.trim() })
      }

      const processes = []
      for (const line of stdout.split('\n')) {
        const t = line.trim()
        if (!t) continue
        const cols = t.split(/\s+/)
        if (cols.length < 9) continue
        const [pid, ppid, procUser, cpu, mem, vsz, rss, stat, ...cmdParts] = cols
        const command = cmdParts.join(' ')
        if (filter_name && !command.includes(filter_name)) continue
        processes.push({
          pid: parseInt(pid, 10),
          ppid: parseInt(ppid, 10),
          user: procUser,
          cpu_pct: parseFloat(cpu),
          mem_pct: parseFloat(mem),
          vsz_kb: parseInt(vsz, 10),
          rss_kb: parseInt(rss, 10),
          stat,
          command,
        })
      }

      resolve({ success: true, hostname, user, sort_by, count: processes.length, processes })
    })
  })
}
