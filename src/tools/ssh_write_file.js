/**
 * SSH Write File tool
 * Writes a file to a remote host via SSH. Accepts plain string content (UTF-8)
 * or base64 for binary. Internally pipes base64 over ssh stdin and decodes on
 * the remote side, so arbitrary bytes and special characters are safe.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, shellQuote, validateTarget, ensureKey } from '../lib/ssh.js'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

// Paths that grant persistence/backdoors if attacker-writable. Writing here is
// refused regardless of allowed_dirs — defense in depth for a powerful tool.
const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/,           // ~/.ssh/authorized_keys, known_hosts, keys
  /(^|\/)authorized_keys$/,
  /^\/etc(\/|$)/,                // system config, /etc/passwd, sudoers, cron
  /^\/root(\/|$)/,               // root's home
  /(^|\/)crontab$/,
  /^\/var\/spool\/cron(\/|$)/,
  /^\/usr(\/|$)/,                // system binaries
  /^\/bin(\/|$)/,
  /^\/sbin(\/|$)/,
  /^\/boot(\/|$)/,
  /(^|\/)\.bashrc$|(^|\/)\.bash_profile$|(^|\/)\.profile$/, // shell init -> code exec on login
]

export const name = 'ssh_write_file'

export const description =
  'Write a file to a remote host over SSH. Pass content as a normal string ' +
  '(or base64 for binary). Optionally create parent dirs and set mode.'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  path: z.string().describe('Absolute destination path on the remote host'),
  content: z.string().describe('File content (utf8 string, or base64 if encoding="base64")'),
  encoding: z
    .enum(['utf8', 'base64'])
    .optional()
    .default('utf8')
    .describe('How to interpret `content` (default utf8)'),
  mode: z
    .string()
    .regex(/^0?[0-7]{3,4}$/)
    .optional()
    .describe('Octal file mode after write, e.g. "0644" or "755" (optional)'),
  mkdir_parents: z
    .boolean()
    .optional()
    .default(false)
    .describe('Create parent directories if missing (mkdir -p)'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
}

/**
 * @param {{
 *   hostname: string, path: string, content: string,
 *   encoding?: 'utf8'|'base64', mode?: string, mkdir_parents?: boolean, user?: string,
 * }} args
 */
export async function handler({
  hostname, path, content, encoding = 'utf8', mode, mkdir_parents = false, user,
}) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  // Safety: refuse writes to sensitive system/credential paths (backdoor vectors)
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(path)) {
      return { success: false, blocked: true, reason: 'Write to sensitive path is not allowed', hostname, path }
    }
  }

  // Safety: respect ssh_exec's blocked_commands list for the path itself
  const blocked = config.ssh.blocked_commands || []
  for (const rule of blocked) {
    if (path.toLowerCase().includes(rule.toLowerCase())) {
      return { success: false, blocked: true, reason: 'Path matches blocked rule', matched_rule: rule, hostname, path }
    }
  }

  // Safety: enforce allowed_dirs prefix-match
  const allowed = config.ssh.allowed_dirs || []
  if (allowed.length > 0 && !allowed.some((d) => path.startsWith(d))) {
    return { success: false, blocked: true, reason: 'Path not in SSH_ALLOWED_DIRS', hostname, path }
  }

  // Build the raw byte payload
  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
  if (bytes.length > DEFAULT_MAX_BYTES) {
    return { success: false, hostname, path, error: `Content size ${bytes.length} exceeds ${DEFAULT_MAX_BYTES}` }
  }
  const b64 = bytes.toString('base64')

  if (config.dry_run) {
    return { success: true, dry_run: true, would_write: path, hostname, user, bytes: bytes.length }
  }

  if (!ensureKey()) {
    return { success: false, hostname, path, error: 'SSH binary or reacher key not found' }
  }

  const quotedPath = shellQuote(path)
  const mkdir = mkdir_parents ? `mkdir -p "$(dirname ${quotedPath})" && ` : ''
  const chmod = mode ? ` && chmod ${mode} ${quotedPath}` : ''

  // base64 -d reads our base64 from stdin and writes raw bytes to the file.
  // `set -e` ensures any sub-step (mkdir, base64, chmod) failure surfaces.
  const remoteCmd = `set -e; ${mkdir}base64 -d > ${quotedPath}${chmod}`

  const sshArgs = [
    ...SSH_BASE_OPTS,
    `${user}@${hostname}`,
    remoteCmd,
  ]

  return new Promise((resolve) => {
    let stderr = ''
    let stdout = ''

    const proc = spawn(SSH_BINARY, sshArgs, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })

    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, path, error: err.message, stderr: stderr.trim() })
    })

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        hostname,
        path,
        user,
        bytes_written: bytes.length,
        mode: mode || null,
        exitCode: code ?? 1,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      })
    })

    proc.stdin.write(b64)
    proc.stdin.end()
  })
}
