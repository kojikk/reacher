#!/usr/bin/env node

/**
 * Personal MCP Server
 * Entry point - Express + Streamable HTTP transport
 */

import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMCPServer } from './src/mcp-server.js'
import { config } from './src/lib/config.js'

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of a candidate token against the secret.
 * Avoids a timing side channel and length-leak (hashing equalizes length).
 */
function tokenMatches(candidate, secret) {
  if (typeof candidate !== 'string' || typeof secret !== 'string') return false
  const a = crypto.createHash('sha256').update(candidate).digest()
  const b = crypto.createHash('sha256').update(secret).digest()
  return crypto.timingSafeEqual(a, b)
}

/**
 * Extract the bearer token from the Authorization header (preferred) or, for
 * backward compatibility with existing connector configs, the `token` query param.
 */
function extractToken(req) {
  const auth = req.headers['authorization']
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }
  return typeof req.query.token === 'string' ? req.query.token : undefined
}

/**
 * Minimal in-memory fixed-window rate limiter keyed by client IP. Avoids adding
 * a dependency. Intended as a brute-force speed bump, not a DDoS defense.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map()
  return function rateLimit(req, res, next) {
    const now = Date.now()
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const entry = hits.get(ip)
    if (!entry || now > entry.reset) {
      hits.set(ip, { count: 1, reset: now + windowMs })
      return next()
    }
    entry.count += 1
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests' })
    }
    next()
  }
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function validateEnv() {
  // Only MCP_SECRET is strictly required — everything else gates individual tools
  const required = ['MCP_SECRET']
  const missing = required.filter(key => !process.env[key])

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:')
    missing.forEach(key => console.error(`   - ${key}`))
    console.error('\nPlease set them in .env or as environment variables')
    process.exit(1)
  }

  // Inform which feature sets are active
  if (!process.env.GITHUB_TOKEN) {
    console.warn('⚠️  GITHUB_TOKEN not set — gist_kb and github_search will be unavailable')
  }
  if (!process.env.PROXY_ALLOWED_DOMAINS) {
    console.warn('⚠️  PROXY_ALLOWED_DOMAINS not set — fetch_external will block all requests')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  validateEnv()

  const port = parseInt(process.env.PORT || '3000', 10)

  // MCP server is created once - tool registrations are stateless closures
  const mcpServer = createMCPServer(process.env)

  const app = express()
  // Trust the reverse proxy so req.ip reflects the real client for rate limiting
  app.set('trust proxy', true)

  // Rate-limit before any auth/body parsing to blunt brute-force attempts
  const rateLimit = createRateLimiter({ windowMs: 60_000, max: 60 })

  // Health check is unauthenticated and must not require a body
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      dry_run: config.dry_run,
    })
  })

  // Authenticate (rate-limit → token check) BEFORE parsing the request body so
  // unauthenticated callers can't reach the JSON parser or be brute-forced cheaply.
  const authenticate = (req, res, next) => {
    const token = extractToken(req)
    if (!token || !tokenMatches(token, process.env.MCP_SECRET)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  }

  // MCP endpoint - a fresh transport is created per request (stateless / no sessions)
  app.post('/mcp', rateLimit, authenticate, express.json({ limit: '1mb' }), async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    res.on('close', () => transport.close())

    await mcpServer.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  const httpServer = app.listen(port, () => {
    console.log(`✅ MCP Server started on http://localhost:${port}`)
    console.log(`   POST http://localhost:${port}/mcp`)
    console.log(`   GET  http://localhost:${port}/health`)

    const activeTools = ['fetch_external', 'browser', 'ssh_exec', 'ssh_read_file', 'ssh_write_file']
    if (process.env.GITHUB_TOKEN) activeTools.push('gist_kb', 'github_search')
    console.log(`📋 Active tools: ${activeTools.join(', ')}`)
    console.log(`ℹ️  browser requires: agent-browser (npm i -g agent-browser) + CDP browser on ws://${process.env.BROWSER_CDP_HOST || '127.0.0.1'}:${process.env.BROWSER_CDP_PORT || '9222'}`)

    if (config.dry_run) {
      console.log(`⚠️  DRY RUN MODE - ssh_exec will not execute commands`)
    }
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...')
    httpServer.close(() => {
      console.log('✅ Server closed')
      process.exit(0)
    })
  })
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
