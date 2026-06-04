/**
 * Download to Remote tool
 * Fetches a URL on the MCP server (with domain allowlist check) and writes the
 * result directly to a path on a remote host via SSH in one step.
 * The file content never appears in Claude's context.
 */

import { z } from 'zod'
import { config } from '../lib/config.js'
import { handler as writeHandler } from './ssh_write_file.js'
import { safeFetch, validateFetchUrl } from '../lib/ssrf.js'

export const name = 'download_to_remote'

export const description =
  'Download a URL and save it directly to a path on a remote host over SSH. ' +
  'The domain must be in PROXY_ALLOWED_DOMAINS. ' +
  'File content is transferred server-side without appearing in Claude\'s context.'

export const schema = {
  url: z.string().describe('URL to download (domain must be in PROXY_ALLOWED_DOMAINS)'),
  hostname: z.string().describe('SSH hostname or alias from /root/.ssh/config'),
  remote_path: z.string().describe('Absolute destination path on the remote host'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user (defaults to SSH_DEFAULT_USER)'),
  mkdir_parents: z
    .boolean()
    .optional()
    .default(false)
    .describe('Create parent directories on remote if missing'),
  mode: z
    .string()
    .regex(/^0?[0-7]{3,4}$/)
    .optional()
    .describe('Octal file mode after write, e.g. "755" (optional)'),
}

export async function handler({ url, hostname, remote_path, user, mkdir_parents = false, mode }, allowedDomains) {
  if (config.dry_run) {
    return { success: true, dry_run: true, would_fetch: url, would_write: remote_path, hostname, user }
  }

  // Scheme + domain allowlist + private-IP check (same guard as fetch_external)
  const allowedList = (allowedDomains || '').split(',').map((d) => d.trim()).filter((d) => d)
  try {
    validateFetchUrl(url, allowedList)
  } catch (err) {
    return { success: false, error: err.message, url, allowed: allowedList }
  }

  // Fetch the URL server-side with manual, re-validated redirects
  let response
  try {
    response = await safeFetch(url, {}, allowedList)
  } catch (err) {
    return { success: false, step: 'fetch', url, error: err.message }
  }

  if (!response.ok) {
    return { success: false, step: 'fetch', url, status_code: response.status, error: `HTTP ${response.status}` }
  }

  // Buffer the response as base64 so ssh_write_file can write raw bytes
  let arrayBuffer
  try {
    arrayBuffer = await response.arrayBuffer()
  } catch (err) {
    return { success: false, step: 'fetch_body', url, error: err.message }
  }

  const b64 = Buffer.from(arrayBuffer).toString('base64')
  const byteCount = arrayBuffer.byteLength

  // Write to remote host
  const writeResult = await writeHandler({
    hostname,
    path: remote_path,
    content: b64,
    encoding: 'base64',
    user,
    mkdir_parents,
    mode,
  })

  if (!writeResult.success) {
    return {
      success: false,
      step: 'write',
      url,
      hostname,
      remote_path,
      error: writeResult.error || 'ssh_write_file failed',
      write_result: writeResult,
    }
  }

  return {
    success: true,
    url,
    hostname,
    remote_path,
    user,
    content_type: response.headers.get('content-type'),
    bytes_written: byteCount,
  }
}
