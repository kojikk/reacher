/**
 * SSH List Directory tool
 * Lists directory contents on a remote host, returning structured JSON.
 */

import { z } from 'zod'
import fs from 'fs'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'

export const name = 'ssh_list_dir'

export const description =
  'List directory contents on a remote host over SSH. ' +
  'Returns structured JSON array with name, type, size, mode, mtime, owner.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  path: z.string().describe('Absolute path of the directory to list'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
}

export async function handler({ hostname, path, user }) {
  if (config.dry_run) {
    return { success: true, dry_run: true, would_list: path, hostname, user }
  }

  if (!fs.existsSync('/usr/bin/ssh')) {
    return { success: false, hostname, path, error: 'SSH binary not found at /usr/bin/ssh' }
  }

  fs.chmodSync('/root/.ssh/reacher-key', 0o600)

  // stat -c format: type_char size mode_octal mtime_epoch owner filename
  // find -maxdepth 1 skips subdirs; -mindepth 1 skips the dir itself
  const quotedPath = `'${path.replace(/'/g, `'\\''`)}'`
  const remoteCmd =
    `find ${quotedPath} -maxdepth 1 -mindepth 1 ` +
    `-exec stat -c '%F\t%s\t%a\t%Y\t%U\t%n' {} \\; 2>&1`

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

    const proc = spawn('/usr/bin/ssh', sshArgs, { timeout: 30_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, path, error: err.message })
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, hostname, path, exitCode: code ?? 1, stderr: stderr.trim() })
      }

      const entries = []
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split('\t')
        if (parts.length < 6) continue
        const [typeStr, sizeStr, mode, mtimeStr, owner, fullPath] = parts
        const nameOnly = fullPath.replace(/.*\//, '')
        entries.push({
          name: nameOnly,
          type: typeStr === 'directory' ? 'dir' : typeStr === 'symbolic link' ? 'symlink' : 'file',
          size: parseInt(sizeStr, 10),
          mode,
          mtime: parseInt(mtimeStr, 10),
          owner,
        })
      }

      resolve({ success: true, hostname, path, user, entries })
    })
  })
}
