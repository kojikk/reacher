/**
 * SSH Read File tool
 * Reads a file from a remote host via SSH. Returns the content as a string —
 * UTF-8 for text, base64 for binary. Internally uses `base64` on the remote
 * side to safely transport arbitrary bytes through ssh's stdout.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, shellQuote, validateTarget, ensureKey } from '../lib/ssh.js'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export const name = 'ssh_read_file'

export const description =
  'Read a file from a remote host over SSH. Returns the content directly — ' +
  'no manual base64 encoding needed. Use encoding="base64" for binary files.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config (e.g. "kojikk-server")'),
  path: z.string().describe('Absolute path of the file to read on the remote host'),
  encoding: z
    .enum(['utf8', 'base64'])
    .optional()
    .default('utf8')
    .describe('utf8 for text files (default), base64 for binary'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  max_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_MAX_BYTES)
    .describe(`Maximum file size in bytes (default ${DEFAULT_MAX_BYTES})`),
}

/**
 * @param {{ hostname: string, path: string, encoding: 'utf8'|'base64', user: string, max_bytes: number }} args
 */
export async function handler({ hostname, path, encoding = 'utf8', user, max_bytes = DEFAULT_MAX_BYTES }) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  if (config.dry_run) {
    return { success: true, dry_run: true, would_read: path, hostname, user, encoding }
  }

  if (!ensureKey()) {
    return {
      success: false,
      hostname,
      path,
      error: 'SSH binary or reacher key not found',
    }
  }

  // Single-quote the path; escape any single quotes inside it.
  const quotedPath = shellQuote(path)

  // `stat -c %s` gives us the size to enforce max_bytes before transferring.
  // `base64 -w0` is GNU coreutils single-line base64; works on Linux servers.
  // We chain them so a single ssh round-trip returns: <size>\n<base64>
  const remoteCmd = `set -e; sz=$(stat -c %s ${quotedPath}); echo "$sz"; if [ "$sz" -le ${max_bytes} ]; then base64 -w0 ${quotedPath}; fi`

  const sshArgs = [
    ...SSH_BASE_OPTS,
    `${user}@${hostname}`,
    remoteCmd,
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(SSH_BINARY, sshArgs, {
      timeout: 60_000,
      maxBuffer: max_bytes * 2 + 1024, // base64 is ~4/3 of original; double-it for safety
    })

    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, path, error: err.message, stderr: stderr.trim() })
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({
          success: false, hostname, path, exitCode: code ?? 1,
          stderr: stderr.trim(), error: 'ssh exited non-zero',
        })
      }

      // First line is the size; the rest is base64 (or empty if oversized).
      const nl = stdout.indexOf('\n')
      const sizeStr = nl >= 0 ? stdout.slice(0, nl).trim() : stdout.trim()
      const b64 = nl >= 0 ? stdout.slice(nl + 1).trim() : ''
      const size = parseInt(sizeStr, 10)

      if (Number.isNaN(size)) {
        return resolve({
          success: false, hostname, path,
          error: 'Could not parse remote file size', stdout_head: stdout.slice(0, 200),
        })
      }

      if (size > max_bytes) {
        return resolve({
          success: false, hostname, path, size,
          error: `File size ${size} exceeds max_bytes ${max_bytes}`,
        })
      }

      const buf = Buffer.from(b64, 'base64')
      const content = encoding === 'base64' ? b64 : buf.toString('utf8')

      resolve({
        success: true,
        hostname,
        path,
        user,
        encoding,
        size,
        content,
      })
    })
  })
}
