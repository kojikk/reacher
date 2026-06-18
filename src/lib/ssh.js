/**
 * Shared SSH helpers
 * Centralizes the key path, base ssh options, shell-argument quoting, and
 * target validation so every ssh_* tool builds remote commands the same safe way.
 */

import fs from 'fs'
import os from 'os'

const isWindows = os.platform() === 'win32'

// The container runs as the unprivileged `node` user (see Dockerfile), so the
// dedicated key lives under that user's home. Overridable for other layouts.
const DEFAULT_KEY_PATH = isWindows
  ? String.raw`C:\Projects\reacher\ssh-runtime\reacher-key`
  : '/home/node/.ssh/reacher-key'

export const SSH_KEY_PATH = process.env.SSH_KEY_PATH || DEFAULT_KEY_PATH

// On Windows use the built-in OpenSSH client; on Linux use the system ssh.
const DEFAULT_SSH_BINARY = isWindows
  ? String.raw`C:\Windows\System32\OpenSSH\ssh.exe`
  : '/usr/bin/ssh'

export const SSH_BINARY = process.env.SSH_BINARY || DEFAULT_SSH_BINARY

// Persist pinned host keys next to the identity key.
export const SSH_KNOWN_HOSTS_PATH =
  process.env.SSH_KNOWN_HOSTS_PATH ||
  SSH_KEY_PATH.replace(/[^/\\]*$/, 'known_hosts')

// Optional path to a custom ssh config file (e.g. ssh-runtime/config on bare Node).
const SSH_CONFIG_FILE = process.env.SSH_CONFIG_FILE || null

// StrictHostKeyChecking=accept-new pins a host's key on first use and then
// rejects mismatches (MITM protection) without an interactive prompt.
// IdentitiesOnly=yes forces use of only the specified key.
export const SSH_BASE_OPTS = [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'IdentitiesOnly=yes',
  '-o', `UserKnownHostsFile=${SSH_KNOWN_HOSTS_PATH}`,
  '-i', SSH_KEY_PATH,
  ...(SSH_CONFIG_FILE ? ['-F', SSH_CONFIG_FILE] : []),
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
  // chmodSync is a no-op on Windows; ACLs are set by ssh-keygen at key creation time.
  if (!isWindows) fs.chmodSync(SSH_KEY_PATH, 0o600)
  return true
}
