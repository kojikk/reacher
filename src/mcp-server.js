/**
 * MCP Server
 * Uses McpServer from the SDK for clean tool registration via server.tool()
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Import tools - each exports: name, description, schema (ZodRawShape), handler
import * as sshExec from './tools/ssh_exec.js'
import * as sshReadFile from './tools/ssh_read_file.js'
import * as sshWriteFile from './tools/ssh_write_file.js'
import * as fetchExternal from './tools/fetch_external.js'
import * as gistKb from './tools/gist_kb.js'
import * as browser from './tools/browser.js'
import * as githubSearch from './tools/github_search.js'

// Import audit logging
import { auditLog } from './lib/audit.js'

/**
 * Create and configure the MCP server with all tools registered.
 * @param {Object} env - process.env (or subset with required keys)
 * @returns {McpServer}
 */
export function createMCPServer(env) {
  const server = new McpServer({
    name: 'personal-mcp-server',
    version: '1.0.0',
  })

  // -------------------------------------------------------------------------
  // Core tools — always available
  // -------------------------------------------------------------------------

  server.tool(fetchExternal.name, fetchExternal.description, fetchExternal.schema, async args => {
    const result = await fetchExternal.handler(args, env.PROXY_ALLOWED_DOMAINS, env)
    await auditLog(fetchExternal.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(browser.name, browser.description, browser.schema, async args => {
    const result = await browser.handler(args, env)
    await auditLog(browser.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  // -------------------------------------------------------------------------
  // GitHub tools — require GITHUB_TOKEN
  // -------------------------------------------------------------------------

  if (env.GITHUB_TOKEN) {
    server.tool(gistKb.name, gistKb.description, gistKb.schema, async args => {
      const result = await gistKb.handler(args, env)
      await auditLog(gistKb.name, args, result)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    })

    server.tool(githubSearch.name, githubSearch.description, githubSearch.schema, async args => {
      const result = await githubSearch.handler(args, env.PROXY_ALLOWED_DOMAINS, env)
      await auditLog(githubSearch.name, args, result)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    })
  }

  // -------------------------------------------------------------------------
  // SSH tool — uses plain ssh over LAN (no Tailscale required).
  // Host/port/user resolved via ~/.ssh/config inside the container.
  // -------------------------------------------------------------------------

  server.tool(sshExec.name, sshExec.description, sshExec.schema, async args => {
    const result = await sshExec.handler(args)
    await auditLog(sshExec.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshReadFile.name, sshReadFile.description, sshReadFile.schema, async args => {
    const result = await sshReadFile.handler(args)
    await auditLog(sshReadFile.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshWriteFile.name, sshWriteFile.description, sshWriteFile.schema, async args => {
    const result = await sshWriteFile.handler(args)
    await auditLog(sshWriteFile.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  return server
}
