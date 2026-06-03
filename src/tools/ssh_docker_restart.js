/**
 * SSH Docker Restart tool
 * Restart a Docker container or a docker compose stack on a remote host.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_docker_restart'

export const description =
  'Restart a Docker container or a docker compose stack on a remote host. ' +
  'For a single container pass container name. ' +
  'For a compose stack pass compose_file path (and optionally service name).'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  container: z
    .string()
    .optional()
    .describe('Container name or ID to restart (used when compose_file is not set)'),
  compose_file: z
    .string()
    .optional()
    .describe('Absolute path to docker-compose.yml on the remote host for compose restart'),
  service: z
    .string()
    .optional()
    .describe('Specific compose service to restart (omit to restart all services in the stack)'),
}

export async function handler({ hostname, user, container, compose_file, service }) {
  if (!container && !compose_file) {
    return { success: false, error: 'Provide either container or compose_file' }
  }

  if (config.dry_run) {
    const what = compose_file
      ? `docker compose -f ${compose_file} restart ${service || ''}`
      : `docker restart ${container}`
    return { success: true, dry_run: true, would_run: what.trim(), hostname, user }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  let remoteCmd
  if (compose_file) {
    const quotedFile = `'${compose_file.replace(/'/g, `'\\''`)}'`
    const svcArg = service ? ` '${service}'` : ''
    remoteCmd = `docker compose -f ${quotedFile} restart${svcArg} 2>&1`
  } else {
    remoteCmd = `docker restart '${container}' 2>&1`
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

    const proc = spawn('/usr/bin/ssh', sshArgs, { timeout: 60_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, error: err.message })
    })

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        hostname,
        user,
        compose_file: compose_file || null,
        container: container || null,
        service: service || null,
        exitCode: code ?? 1,
        stdout: stdout.trim() || undefined,
        stderr: stderr.trim() || undefined,
      })
    })
  })
}
