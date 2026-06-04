/**
 * SSH Grep tool
 * Runs grep -rn on a remote host, returning structured matches.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, shellQuote, validateTarget, ensureKey } from '../lib/ssh.js'

export const name = 'ssh_grep'

export const description =
  'Search file contents on a remote host using grep. ' +
  'Returns structured matches: [{file, line, match}].'

export const schema = {
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  pattern: z.string().describe('Regex or literal pattern to search for'),
  path: z.string().describe('Directory or file path to search in'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  include: z
    .string()
    .optional()
    .describe('Glob pattern to restrict file types, e.g. "*.js" or "*.{ts,tsx}"'),
  ignore_case: z
    .boolean()
    .optional()
    .default(false)
    .describe('Case-insensitive search'),
  max_matches: z
    .number()
    .int()
    .positive()
    .optional()
    .default(200)
    .describe('Maximum number of matches to return (default 200)'),
}

export async function handler({ hostname, pattern, path, user, include, ignore_case = false, max_matches = 200 }) {
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  if (config.dry_run) {
    return { success: true, dry_run: true, would_grep: pattern, path, hostname, user }
  }

  if (!ensureKey()) {
    return { success: false, hostname, path, error: 'SSH binary or reacher key not found' }
  }

  const quotedPath = shellQuote(path)
  const quotedPattern = shellQuote(pattern)

  const flags = ['-rn', '--line-buffered']
  if (ignore_case) flags.push('-i')
  if (include) flags.push(`--include=${shellQuote(include)}`)

  const remoteCmd = `grep ${flags.join(' ')} ${quotedPattern} ${quotedPath} 2>/dev/null | head -n ${max_matches}`

  const sshArgs = [
    ...SSH_BASE_OPTS,
    `${user}@${hostname}`,
    remoteCmd,
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(SSH_BINARY, sshArgs, { timeout: 30_000 })
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, hostname, path, error: err.message })
    })

    proc.on('close', (code) => {
      // grep exits 1 when no matches — that's not an error
      if (code !== 0 && code !== 1) {
        return resolve({ success: false, hostname, path, exitCode: code ?? 1, stderr: stderr.trim() })
      }

      const matches = []
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // Format: file:linenum:content
        const colonIdx = trimmed.indexOf(':')
        if (colonIdx === -1) continue
        const rest = trimmed.slice(colonIdx + 1)
        const colonIdx2 = rest.indexOf(':')
        if (colonIdx2 === -1) continue
        matches.push({
          file: trimmed.slice(0, colonIdx),
          line: parseInt(rest.slice(0, colonIdx2), 10),
          match: rest.slice(colonIdx2 + 1),
        })
      }

      resolve({
        success: true,
        hostname,
        path,
        pattern,
        user,
        count: matches.length,
        truncated: matches.length >= max_matches,
        matches,
      })
    })
  })
}
