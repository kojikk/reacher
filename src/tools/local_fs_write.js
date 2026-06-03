/**
 * Local FS Write tool
 * Writes a file to the container's scratch volume (/data/scratch).
 */

import { z } from 'zod'
import fs from 'fs'
import path from 'path'

export const name = 'local_fs_write'

export const description =
  'Write a file to the container scratch volume (/data/scratch). ' +
  'Useful for staging content before uploading to a remote host or sharing between tool calls.'

const SCRATCH_ROOT = '/data/scratch'
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

function safePath(relPath) {
  const resolved = path.resolve(SCRATCH_ROOT, relPath)
  if (!resolved.startsWith(SCRATCH_ROOT + path.sep) && resolved !== SCRATCH_ROOT) {
    throw new Error('Path escapes scratch root')
  }
  return resolved
}

export const schema = {
  path: z
    .string()
    .describe('Relative path within the scratch volume, e.g. "output/report.txt"'),
  content: z
    .string()
    .describe('File content — plain string for utf8, base64 string for binary'),
  encoding: z
    .enum(['utf8', 'base64'])
    .optional()
    .default('utf8')
    .describe('How to interpret content (default utf8)'),
  mkdir_parents: z
    .boolean()
    .optional()
    .default(true)
    .describe('Create parent directories if missing (default true)'),
}

export async function handler({ path: relPath, content, encoding = 'utf8', mkdir_parents = true }) {
  let absPath
  try {
    absPath = safePath(relPath)
  } catch (err) {
    return { success: false, error: err.message, path: relPath }
  }

  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
  if (bytes.length > MAX_BYTES) {
    return { success: false, path: relPath, error: `Content size ${bytes.length} exceeds limit ${MAX_BYTES}` }
  }

  try {
    if (mkdir_parents) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true })
    }
    fs.writeFileSync(absPath, bytes)
    return {
      success: true,
      path: relPath,
      abs_path: absPath,
      bytes_written: bytes.length,
    }
  } catch (err) {
    return { success: false, path: relPath, error: err.message }
  }
}
