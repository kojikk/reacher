/**
 * Shared SSH helpers
 * Centralizes the key path, base ssh options, shell-argument quoting, and
 * target validation so every ssh_* tool builds remote commands the same safe way.
 */

import fs from 'fs'

// The container runs as the unprivileged `node` user (see Dockerfile), so the
// dedicated key lives under that user's home. Overridable for other layouts.
export const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/home/node/.ssh/reacher-key'

export const SSH_BINARY = '/usr/bin/ssh'

// StrictHostKeyChecking=accept-new pins a host's key on first use and then
// rejects mismatches (MITM protection) without an interactive prompt.
// IdentitiesOnly=yes forces use of only the specified key.
export const SSH_BASE_OPTS = [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'IdentitiesOnly=yes',
  '-i', SSH_KEY_PATH,
]

/**
 * Wrap an arbitrary string as a single shell token, safe for interpolation
 * into a remote command line. Escapes embedded single quotes using the
 * standard '\'' idiom. This is the security boundary against command injection.
 * @param {string} str
 * @returns {string}
 */
export function shellQuote(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`
}

/**
 * Validate an SSH hostname/user pair before passing to `ssh`.
 * Even though we spawn without a shell, values beginning with '-' could be
 * interpreted by ssh as options (argument injection, e.g. -oProxyCommand=...),
 * so we restrict to a conservative character set and forbid leading dashes.
 * @param {{ hostname?: string, user?: string }} target
 * @returns {string|null} error message, or null if valid
 */
export function validateTarget({ hostname, user }) {
  const safe = /^[A-Za-z0-9._@-]+$/
  if (hostname != null) {
    if (typeof hostname !== 'string' || !safe.test(hostname) || hostname.startsWith('-')) {
      return `Invalid hostname: ${hostname}`
    }
  }
  if (user != null) {
    if (typeof user !== 'string' || !safe.test(user) || user.startsWith('-')) {
      return `Invalid user: ${user}`
    }
  }
  return null
}

/**
 * Ensure the private key has the 0600 perms ssh requires. Returns true if the
 * key exists, false otherwise (callers surface a clear error when missing).
 * @returns {boolean}
 */
export function ensureKey() {
  if (!fs.existsSync(SSH_BINARY)) return false
  if (!fs.existsSync(SSH_KEY_PATH)) return false
  fs.chmodSync(SSH_KEY_PATH, 0o600)
  return true
}
