/**
 * SSH Ports tool
 * Lists listening TCP/UDP ports on a remote host.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, validateTarget, ensureKey } from '../lib/ssh.js'

export const name = 'ssh_ports'

export const description =
  'List all listening TCP/UDP ports on a remote host. ' +
  'Returns structured array: [{port, proto, address, process, pid}].'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
}

export async function handler({ hostname, user }) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  if (config.dry_run) {
    return { success: true, dry_run: true, hostname, user }
  }

  if (!ensureKey()) {
    return { success: false, hostname, error: 'SSH binary or reacher key not found' }
  }

  // ss -tlnp: TCP listening, numeric, with process names
  // ss -ulnp: UDP listening
  // Output columns: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
  const remoteCmd = `ss -tlnp 2>/dev/null; echo '---UDP---'; ss -ulnp 2>/dev/null`

  const sshArgs = [
    ...SSH_BASE_OPTS,
    `${user}@${hostname}`,
    remoteCmd,
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(SSH_BINARY, sshArgs, { timeout: 15_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, error: err.message })
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, hostname, exitCode: code ?? 1, stderr: stderr.trim() })
      }

      const ports = []
      let proto = 'tcp'

      for (const line of stdout.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('Netid') || t.startsWith('State')) continue
        if (t === '---UDP---') { proto = 'udp'; continue }

        // ss columns: Netid State Recv-Q Send-Q Local:Port Peer:Port Process
        const cols = t.split(/\s+/)
        if (cols.length < 5) continue

        // When proto prefix present (tcp/udp) it's col[0], otherwise we use current proto
        let localAddr, processInfo
        const hasProto = cols[0] === 'tcp' || cols[0] === 'udp' || cols[0] === 'tcp6' || cols[0] === 'udp6'
        if (hasProto) {
          proto = cols[0].replace('6', '')
          localAddr = cols[4]
          processInfo = cols.slice(6).join(' ')
        } else {
          localAddr = cols[3]
          processInfo = cols.slice(5).join(' ')
        }

        // Parse address:port — handle IPv6 [::]:port and 0.0.0.0:port
        const lastColon = localAddr.lastIndexOf(':')
        const addr = localAddr.slice(0, lastColon)
        const port = parseInt(localAddr.slice(lastColon + 1), 10)
        if (isNaN(port)) continue

        // Extract process name and PID from users:(("nginx",pid=123,...))
        const pidMatch = processInfo.match(/pid=(\d+)/)
        const nameMatch = processInfo.match(/"([^"]+)"/)

        ports.push({
          port,
          proto,
          address: addr,
          process: nameMatch ? nameMatch[1] : null,
          pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
        })
      }

      resolve({ success: true, hostname, user, count: ports.length, ports })
    })
  })
}
