/**
 * Audit Logging System
 * Logs all MCP tool calls with sanitization of sensitive data
 */

import fs from 'node:fs/promises'
import { config } from './config.js'

const SENSITIVE_KEYS = [
  'token',
  'password',
  'passwd',
  'secret',
  'key',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'bearer',
  'credential',
  'pat',
]

const REDACTED = '[REDACTED]'

// Patterns that look like secrets even when the key name is innocuous.
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,           // Authorization: Bearer …
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,              // Slack tokens
  /\b(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, // JWTs
  /\b(?:sk|pk)-[A-Za-z0-9]{20,}/g,                // OpenAI/Stripe-style keys
]

/**
 * Mask secret-looking substrings inside a string value.
 * @param {string} str
 * @returns {string}
 */
function maskSecretsInString(str) {
  let out = str
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

/**
 * Decide whether a key name indicates a sensitive value.
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const lower = key.toLowerCase()
  return SENSITIVE_KEYS.some(sk => lower.includes(sk))
}

/**
 * Recursively sanitize a value: drop sensitive keys, mask secret-looking
 * strings, and walk nested objects/arrays. Guards against cycles.
 * @param {any} value
 * @param {WeakSet<object>} [seen]
 * @returns {any}
 */
function sanitize(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return maskSecretsInString(value)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, seen))
  }

  const out = {}
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED
    } else {
      out[key] = sanitize(val, seen)
    }
  }
  return out
}

/**
 * Audit log a tool execution
 * @param {string} toolName - Name of the tool
 * @param {Object} input - Input arguments to the tool
 * @param {Object} result - Result from the tool execution
 */
export async function auditLog(toolName, input, result) {
  // Check if auditing is enabled
  if (!config.audit?.enabled) {
    return
  }

  // Recursively strip sensitive keys and mask secret-looking values
  const cleanInput = sanitize(input)

  // Build the log entry
  const logEntry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    input: cleanInput,
    success: result?.success ?? true,
  }

  // Write to log file with restrictive permissions (owner read/write only)
  const logPath = config.audit.log_path
  try {
    await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n', { mode: 0o600 })
    // appendFile only applies mode when creating the file; enforce on existing too
    await fs.chmod(logPath, 0o600).catch(() => {})
  } catch (err) {
    // Swallow errors - don't crash the server
    console.error('Audit log write error:', err.message)
  }
}
