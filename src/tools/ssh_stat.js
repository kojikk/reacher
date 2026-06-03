/**
 * SSH Stat tool
 * Returns metadata for a single path on a remote host.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_stat'

export const description =
  'Get metadata for a path on a remote host over SSH: ' +
  'exists, size, mode, mtime, is_dir, is_link.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  path: z.string().describe('Absolute path to stat on the remote host'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
}

export async function handler({ hostname, path, user }) {
  if (config.dry_run) {
    return { success: true, dry_run: true, would_stat: path, hostname, user }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, path, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  const quotedPath = `'${path.replace(/'/g, `'\\''`)}'`
  // Output: F(type) s(size) a(mode_octal) Y(mtime_epoch) U(owner) f(filename)
  const remoteCmd = `stat -c '%F\t%s\t%a\t%Y\t%U\t%f' ${quotedPath} 2>&1; echo "__EXIT__$?"`

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
      resolve({ success: false, hostname, path, error: err.message })
    })

    proc.on('close', (sshCode) => {
      if (sshCode !== 0) {
        return resolve({ success: false, hostname, path, exitCode: sshCode ?? 1, stderr: stderr.trim() })
      }

      // Check if stat itself failed (file not found etc.)
      const exitMatch = stdout.match(/__EXIT__(\d+)/)
      const statCode = exitMatch ? parseInt(exitMatch[1], 10) : 0
      const output = stdout.replace(/__EXIT__\d+/, '').trim()

      if (statCode !== 0) {
        return resolve({ success: true, hostname, path, exists: false, error: output })
      }

      const parts = output.split('\t')
      if (parts.length < 5) {
        return resolve({ success: false, hostname, path, error: 'Unexpected stat output', raw: output })
      }

      const [typeStr, sizeStr, mode, mtimeStr, owner] = parts

      resolve({
        success: true,
        hostname,
        path,
        user,
        exists: true,
        size: parseInt(sizeStr, 10),
        mode,
        mtime: parseInt(mtimeStr, 10),
        owner,
        is_dir: typeStr === 'directory',
        is_link: typeStr === 'symbolic link',
        type: typeStr === 'directory' ? 'dir' : typeStr === 'symbolic link' ? 'symlink' : 'file',
      })
    })
  })
}
