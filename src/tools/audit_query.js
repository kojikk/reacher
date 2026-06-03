/**
 * Audit Query tool
 * Read and filter the reacher-audit.log to review past tool calls.
 */

import { z } from 'zod'
import fs from 'fs'
import { config } from '../lib/config.js'

export const name = 'audit_query'

export const description =
  'Read and filter the Reacher audit log to review past tool calls. ' +
  'Filter by tool name, time range, or success status. ' +
  'Useful for understanding what actions were taken in previous sessions.'

export const schema = {
  tool: z
    .string()
    .optional()
    .describe('Filter entries by tool name, e.g. "ssh_exec"'),
  since: z
    .string()
    .optional()
    .describe('ISO timestamp — return entries at or after this time, e.g. "2024-01-15T10:00:00Z"'),
  success: z
    .boolean()
    .optional()
    .describe('Filter by success status (true/false); omit for all entries'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe('Maximum number of entries to return, most recent first (default 50)'),
}

export async function handler({ tool, since, success, limit = 50 }) {
  const logPath = config.audit?.log_path || './reacher-audit.log'

  if (!fs.existsSync(logPath)) {
    return { success: true, count: 0, entries: [], note: `Audit log not found at ${logPath}` }
  }

  let raw
  try {
    raw = fs.readFileSync(logPath, 'utf8')
  } catch (err) {
    return { success: false, error: `Failed to read audit log: ${err.message}` }
  }

  const sinceTime = since ? new Date(since).getTime() : null

  const entries = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let entry
    try {
      entry = JSON.parse(t)
    } catch {
      continue
    }

    if (tool && entry.tool !== tool) continue
    if (sinceTime && new Date(entry.timestamp).getTime() < sinceTime) continue
    if (success !== undefined && success !== null && entry.success !== success) continue

    entries.push(entry)
  }

  // Most recent first, then limit
  entries.reverse()
  const limited = entries.slice(0, limit)

  return {
    success: true,
    total_matching: entries.length,
    count: limited.length,
    truncated: entries.length > limit,
    entries: limited,
  }
}
