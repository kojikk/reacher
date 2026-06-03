/**
 * SSH Exec Many tool
 * Runs the same shell command on multiple hosts in parallel.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_exec_many'

export const description =
  'Run the same shell command on multiple hosts in parallel over SSH. ' +
  'Returns an array of results: [{hostname, success, stdout, stderr, exitCode}].'

export const schema = {
  hostnames: z
    .array(z.string())
    .min(1)
    .describe('List of SSH hostnames or aliases from /root/.ssh/config'),
  command: z.string().describe('Shell command to execute on each remote host'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
}

function runOne(hostname, command, user) {
  return new Promise((resolve) => {
    if (!fs.existsSync('/usr/bin/ssh')) {
      return resolve({ hostname, success: false, error: 'SSH binary not found', stdout: '', stderr: '', exitCode: 127 })
    }

    const sshArgs = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'IdentitiesOnly=yes',
      '-i', '/root/.ssh/reacher-key',
      `${user}@${hostname}`,
      command,
    ]

    let stdout = ''
    let stderr = ''

    const proc = spawn('/usr/bin/ssh', sshArgs, { timeout: 30_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ hostname, success: false, error: err.message, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 1 })
    })

    proc.on('close', (code) => {
      resolve({
        hostname,
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      })
    })
  })
}

export async function handler({ hostnames, command, user }) {
  if (config.dry_run) {
    return {
      success: true,
      dry_run: true,
      would_execute: command,
      hostnames,
      user,
    }
  }

  // Safety check: blocked commands
  const blockedCommands = config.ssh?.blocked_commands || []
  for (const blocked of blockedCommands) {
    if (command.toLowerCase().includes(blocked.toLowerCase())) {
      return {
        success: false,
        blocked: true,
        reason: 'Command blocked by reacher config',
        matched_rule: blocked,
        command,
      }
    }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  const results = await Promise.all(hostnames.map((h) => runOne(h, command, user)))

  return {
    success: results.every((r) => r.success),
    command,
    user,
    results,
  }
}
