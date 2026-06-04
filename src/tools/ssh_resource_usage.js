/**
 * SSH Resource Usage tool
 * Returns a CPU/RAM/swap/disk/load snapshot from a remote host.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, validateTarget, ensureKey } from '../lib/ssh.js'

export const name = 'ssh_resource_usage'

export const description =
  'Get a CPU, RAM, swap, disk, and load average snapshot from a remote host in one call.'

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

  // Collect everything in one SSH round-trip
  const remoteCmd = [
    // Load averages + CPU count
    `echo "LOAD:$(cat /proc/loadavg)"`,
    `echo "CPUS:$(nproc)"`,
    // Memory: MemTotal, MemAvailable, SwapTotal, SwapFree (kB)
    `grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo | awk '{print "MEM_"$1" "$2}'`,
    // Disk usage for all real filesystems
    `df -P -x tmpfs -x devtmpfs -x overlay --block-size=1 2>/dev/null | awk 'NR>1 {print "DISK:"$6":"$2":"$3":"$4}'`,
    // CPU steal/idle from /proc/stat (first line)
    `awk '/^cpu / {idle=$5; total=0; for(i=2;i<=NF;i++) total+=$i; printf "CPU_IDLE:%s\\nCPU_TOTAL:%s\\n", idle, total}' /proc/stat`,
  ].join('; ')

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

      const mem = {}
      const disks = []
      let load1, load5, load15, cpus, cpuIdle, cpuTotal

      for (const line of stdout.split('\n')) {
        const t = line.trim()
        if (t.startsWith('LOAD:')) {
          const parts = t.slice(5).split(' ')
          ;[load1, load5, load15] = parts
        } else if (t.startsWith('CPUS:')) {
          cpus = parseInt(t.slice(5), 10)
        } else if (t.startsWith('MEM_')) {
          const [key, val] = t.slice(4).split(' ')
          mem[key.replace(':', '')] = parseInt(val, 10) * 1024 // kB → bytes
        } else if (t.startsWith('DISK:')) {
          const parts = t.split(':')
          // DISK:mountpoint:total:used:avail
          if (parts.length >= 5) {
            disks.push({
              mount: parts[1],
              total: parseInt(parts[2], 10),
              used: parseInt(parts[3], 10),
              available: parseInt(parts[4], 10),
              used_pct: Math.round((parseInt(parts[3], 10) / parseInt(parts[2], 10)) * 100),
            })
          }
        } else if (t.startsWith('CPU_IDLE:')) {
          cpuIdle = parseInt(t.slice(9), 10)
        } else if (t.startsWith('CPU_TOTAL:')) {
          cpuTotal = parseInt(t.slice(10), 10)
        }
      }

      const cpuUsedPct = cpuTotal ? Math.round(((cpuTotal - cpuIdle) / cpuTotal) * 100) : null
      const memTotal = mem['MemTotal:'] ?? mem.MemTotal
      const memAvail = mem['MemAvailable:'] ?? mem.MemAvailable

      resolve({
        success: true,
        hostname,
        user,
        cpu: {
          count: cpus,
          used_pct: cpuUsedPct,
          load: { '1m': parseFloat(load1), '5m': parseFloat(load5), '15m': parseFloat(load15) },
        },
        memory: {
          total: memTotal,
          available: memAvail,
          used: memTotal != null && memAvail != null ? memTotal - memAvail : null,
          used_pct: memTotal && memAvail ? Math.round(((memTotal - memAvail) / memTotal) * 100) : null,
        },
        swap: {
          total: mem['SwapTotal:'] ?? mem.SwapTotal,
          free: mem['SwapFree:'] ?? mem.SwapFree,
        },
        disks,
      })
    })
  })
}
