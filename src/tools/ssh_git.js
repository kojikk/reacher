/**
 * SSH Git tool
 * Run git operations on a remote repository without manual cd + git.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_git'

export const description =
  'Run git operations on a remote repository over SSH. ' +
  'Supported actions: status, pull, fetch, log, diff, checkout.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  repo_path: z.string().describe('Absolute path to the git repository on the remote host'),
  action: z
    .enum(['status', 'pull', 'fetch', 'log', 'diff', 'checkout'])
    .describe('Git action to perform'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  // action-specific optional args
  branch: z
    .string()
    .optional()
    .describe('Branch name for checkout or pull'),
  log_count: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe('Number of commits to show for log (default 20)'),
  diff_ref: z
    .string()
    .optional()
    .describe('Ref/commit for diff (e.g. "HEAD~1", "main..feature")'),
}

export async function handler({ hostname, repo_path, action, user, branch, log_count = 20, diff_ref }) {
  if (config.dry_run) {
    return { success: true, dry_run: true, hostname, user, repo_path, action }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  const quotedRepo = `'${repo_path.replace(/'/g, `'\\''`)}'`

  let gitCmd
  switch (action) {
    case 'status':
      gitCmd = `git -C ${quotedRepo} status --short --branch`
      break
    case 'pull':
      gitCmd = branch
        ? `git -C ${quotedRepo} pull origin '${branch}'`
        : `git -C ${quotedRepo} pull`
      break
    case 'fetch':
      gitCmd = `git -C ${quotedRepo} fetch --all --prune`
      break
    case 'log':
      gitCmd = `git -C ${quotedRepo} log --oneline -n ${log_count} --decorate`
      break
    case 'diff':
      gitCmd = diff_ref
        ? `git -C ${quotedRepo} diff '${diff_ref}'`
        : `git -C ${quotedRepo} diff`
      break
    case 'checkout':
      if (!branch) return { success: false, error: 'branch is required for checkout' }
      gitCmd = `git -C ${quotedRepo} checkout '${branch}'`
      break
    default:
      return { success: false, error: `Unknown action: ${action}` }
  }

  const remoteCmd = `${gitCmd} 2>&1`

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
      resolve({ success: false, hostname, repo_path, action, error: err.message })
    })

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        hostname,
        user,
        repo_path,
        action,
        exitCode: code ?? 1,
        output: stdout.trim(),
        stderr: stderr.trim() || undefined,
      })
    })
  })
}
