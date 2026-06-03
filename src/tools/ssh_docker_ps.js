/**
 * SSH Docker PS tool
 * Lists Docker containers on a remote host with health/status/ports/uptime.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_docker_ps'

export const description =
  'List Docker containers on a remote host. ' +
  'Returns structured array with name, image, status, health, ports, and uptime.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  all: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include stopped containers (default: running only)'),
}

export async function handler({ hostname, user, all = false }) {
  if (config.dry_run) {
    return { success: true, dry_run: true, hostname, user }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  const allFlag = all ? '-a' : ''
  // Use Go template to get tab-separated output
  const format = '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}\t{{.RunningFor}}'
  const remoteCmd = `docker ps ${allFlag} --format '${format}' 2>&1`

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
        return resolve({ success: false, hostname, exitCode: code ?? 1, stderr: stderr.trim(), stdout: stdout.trim() })
      }

      const containers = []
      for (const line of stdout.split('\n')) {
        const t = line.trim()
        if (!t) continue
        const [id, name, image, status, state, ports, uptime] = t.split('\t')
        containers.push({
          id: id?.slice(0, 12),
          name,
          image,
          status,
          state,
          ports: ports || null,
          uptime,
        })
      }

      resolve({ success: true, hostname, user, count: containers.length, containers })
    })
  })
}
