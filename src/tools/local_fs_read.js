/**
 * Local FS Read tool
 * Reads a file from the container's scratch volume (/data/scratch).
 */

import { z } from 'zod'
import fs from 'fs'
import path from 'path'

export const name = 'local_fs_read'

export const description =
  'Read a file from the container scratch volume (/data/scratch). ' +
  'Useful for caching downloaded content or sharing data between tool calls.'

const SCRATCH_ROOT = '/data/scratch'

/**
 * Resolve the realpath of the deepest existing ancestor of a path, so symlink
 * components are followed even when the leaf does not yet exist.
 */
function realpathOfExisting(p) {
  let current = p
  // Walk up until we hit a path that exists on disk
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return fs.realpathSync(current)
}

function safePath(relPath) {
  const resolved = path.resolve(SCRATCH_ROOT, relPath)
  if (!resolved.startsWith(SCRATCH_ROOT + path.sep) && resolved !== SCRATCH_ROOT) {
    throw new Error('Path escapes scratch root')
  }
  // Follow symlinks: the real, canonical location must still live under the
  // real scratch root. Blocks symlinks inside scratch that point outside it.
  const realRoot = fs.realpathSync(SCRATCH_ROOT)
  const realResolved = realpathOfExisting(resolved)
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
    throw new Error('Path escapes scratch root')
  }
  return resolved
}

export const schema = {
  path: z
    .string()
    .describe('Relative path within the scratch volume, e.g. "output/report.txt"'),
  encoding: z
    .enum(['utf8', 'base64'])
    .optional()
    .default('utf8')
    .describe('utf8 for text (default), base64 for binary'),
}

export async function handler({ path: relPath, encoding = 'utf8' }) {
  let absPath
  try {
    absPath = safePath(relPath)
  } catch (err) {
    return { success: false, error: err.message, path: relPath }
  }

  if (!fs.existsSync(absPath)) {
    return { success: false, path: relPath, error: 'File not found' }
  }

  try {
    const buf = fs.readFileSync(absPath)
    const content = encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8')
    return {
      success: true,
      path: relPath,
      abs_path: absPath,
      encoding,
      size: buf.length,
      content,
    }
  } catch (err) {
    return { success: false, path: relPath, error: err.message }
  }
}
