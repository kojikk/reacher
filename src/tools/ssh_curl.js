/**
 * SSH Curl tool
 * Make an HTTP request from the remote host (different network vantage point).
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_curl'

export const description =
  'Make an HTTP request from a remote host via SSH. ' +
  'Useful for reaching internal APIs or services only visible from that network. ' +
  'Returns status code, headers, and response body.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  url: z.string().describe('URL to fetch from the remote host'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    .optional()
    .default('GET')
    .describe('HTTP method (default GET)'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Request headers as key-value pairs'),
  body: z
    .string()
    .optional()
    .describe('Request body (for POST/PUT/PATCH)'),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .default(15)
    .describe('curl timeout in seconds (default 15)'),
  follow_redirects: z
    .boolean()
    .optional()
    .default(true)
    .describe('Follow HTTP redirects (default true)'),
}

export async function handler({ hostname, url, user, method = 'GET', headers = {}, body, timeout = 15, follow_redirects = true }) {
  if (config.dry_run) {
    return { success: true, dry_run: true, would_fetch: url, hostname, user }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  // Build curl args
  const curlArgs = [
    `--silent`,
    `--max-time ${timeout}`,
    `--write-out '\\n__STATUS__%{http_code}__TOTAL_TIME__%{time_total}'`,
    `-X ${method}`,
  ]

  if (follow_redirects) curlArgs.push('-L')

  for (const [k, v] of Object.entries(headers)) {
    curlArgs.push(`-H '${k}: ${v.replace(/'/g, `'\\''`)}'`)
  }

  if (body) {
    curlArgs.push(`--data '${body.replace(/'/g, `'\\''`)}'`)
  }

  curlArgs.push(`'${url.replace(/'/g, `'\\''`)}'`)

  const remoteCmd = `curl ${curlArgs.join(' ')} 2>&1`

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

    const proc = spawn('/usr/bin/ssh', sshArgs, { timeout: (timeout + 10) * 1000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, url, error: err.message })
    })

    proc.on('close', (code) => {
      if (code !== 0 && !stdout.includes('__STATUS__')) {
        return resolve({ success: false, hostname, url, exitCode: code ?? 1, stderr: stderr.trim() })
      }

      // Parse __STATUS__ marker written by --write-out
      const statusMatch = stdout.match(/__STATUS__(\d+)__TOTAL_TIME__([\d.]+)/)
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null
      const totalTime = statusMatch ? parseFloat(statusMatch[2]) : null
      const body_out = stdout.replace(/__STATUS__.*$/, '').trim()

      resolve({
        success: code === 0,
        hostname,
        url,
        method,
        status_code: statusCode,
        total_time_s: totalTime,
        body: body_out,
        stderr: stderr.trim() || undefined,
      })
    })
  })
}
