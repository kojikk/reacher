/**
 * Config system
 * Loads configuration from reacher.config.yaml with full .env fallback
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..', '..')

// Load YAML config
let yamlConfig = {}
const yamlPath = path.join(projectRoot, 'reacher.config.yaml')
try {
  const content = fs.readFileSync(yamlPath, 'utf-8')
  yamlConfig = yaml.load(content) || {}
} catch {
  // No YAML file found, use empty object (graceful fallback)
}

const envVars = process.env

/**
 * Normalize a boolean-ish env string. Accepts true/1/yes/on (any case) as true
 * and false/0/no/off as false. Returns undefined for unset/unrecognized values
 * so callers can fall back to a default.
 * @param {string|undefined} value
 * @returns {boolean|undefined}
 */
function parseBoolEnv(value) {
  if (value == null) return undefined
  const v = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(v)) return true
  if (['false', '0', 'no', 'off'].includes(v)) return false
  return undefined
}

/**
 * Check whether a command string matches a blocked-command rule.
 * Single-word rules (no whitespace) use whole-word matching so that e.g. the
 * rule "dd" does not fire on "caddy", "address", etc.
 * Multi-word rules (e.g. "rm -rf /") fall back to substring matching.
 * @param {string} command
 * @param {string} blocked
 * @returns {boolean}
 */
export function isCommandBlocked(command, blocked) {
  const blk = blocked.toLowerCase().trim()
  if (!blk) return false
  const escaped = blk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (/\s/.test(blk)) {
    return command.toLowerCase().includes(blk)
  }
  return new RegExp('\\b' + escaped + '\\b', 'i').test(command)
}

// Build the final config object with .env always winning over YAML
export const config = {
  ssh: {
    blocked_commands:
      yamlConfig.ssh?.blocked_commands ||
      (envVars.SSH_BLOCKED_COMMANDS || '').split(',').filter(c => c.trim()),
    allowed_dirs:
      yamlConfig.ssh?.allowed_dirs ||
      (envVars.SSH_ALLOWED_DIRS || '').split(',').filter(d => d.trim()),
  },
  audit: {
    enabled: parseBoolEnv(envVars.AUDIT_ENABLED) ?? yamlConfig.audit?.enabled ?? true,
    log_path:
      envVars.AUDIT_LOG_PATH || yamlConfig.audit?.log_path || './reacher-audit.log',
  },
  dry_run: parseBoolEnv(envVars.DRY_RUN) ?? yamlConfig.dry_run ?? false,
}
