/**
 * MCP Server
 * Uses McpServer from the SDK for clean tool registration via server.tool()
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Import tools - each exports: name, description, schema (ZodRawShape), handler
import * as sshExec from './tools/ssh_exec.js'
import * as sshExecMany from './tools/ssh_exec_many.js'
import * as sshReadFile from './tools/ssh_read_file.js'
import * as sshWriteFile from './tools/ssh_write_file.js'
import * as sshListDir from './tools/ssh_list_dir.js'
import * as sshStat from './tools/ssh_stat.js'
import * as sshGrep from './tools/ssh_grep.js'
import * as sshSystemd from './tools/ssh_systemd.js'
import * as sshJournalctl from './tools/ssh_journalctl.js'
import * as sshResourceUsage from './tools/ssh_resource_usage.js'
import * as sshPorts from './tools/ssh_ports.js'
import * as sshProcessList from './tools/ssh_process_list.js'
import * as sshDockerPs from './tools/ssh_docker_ps.js'
import * as sshDockerLogs from './tools/ssh_docker_logs.js'
import * as sshDockerRestart from './tools/ssh_docker_restart.js'
import * as sshGit from './tools/ssh_git.js'
import * as sshCurl from './tools/ssh_curl.js'
import * as downloadToRemote from './tools/download_to_remote.js'
import * as localFsRead from './tools/local_fs_read.js'
import * as localFsWrite from './tools/local_fs_write.js'
import * as fetchExternal from './tools/fetch_external.js'
import * as gistKb from './tools/gist_kb.js'
import * as browser from './tools/browser.js'
import * as githubSearch from './tools/github_search.js'
import * as auditQuery from './tools/audit_query.js'

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

  server.tool(auditQuery.name, auditQuery.description, auditQuery.schema, async args => {
    const result = await auditQuery.handler(args)
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
  // SSH tools — plain SSH over LAN (no Tailscale required)
  // -------------------------------------------------------------------------

  server.tool(sshExec.name, sshExec.description, sshExec.schema, async args => {
    const result = await sshExec.handler(args)
    await auditLog(sshExec.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshExecMany.name, sshExecMany.description, sshExecMany.schema, async args => {
    const result = await sshExecMany.handler(args)
    await auditLog(sshExecMany.name, args, result)
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

  server.tool(sshListDir.name, sshListDir.description, sshListDir.schema, async args => {
    const result = await sshListDir.handler(args)
    await auditLog(sshListDir.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshStat.name, sshStat.description, sshStat.schema, async args => {
    const result = await sshStat.handler(args)
    await auditLog(sshStat.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshGrep.name, sshGrep.description, sshGrep.schema, async args => {
    const result = await sshGrep.handler(args)
    await auditLog(sshGrep.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshSystemd.name, sshSystemd.description, sshSystemd.schema, async args => {
    const result = await sshSystemd.handler(args)
    await auditLog(sshSystemd.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshJournalctl.name, sshJournalctl.description, sshJournalctl.schema, async args => {
    const result = await sshJournalctl.handler(args)
    await auditLog(sshJournalctl.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshResourceUsage.name, sshResourceUsage.description, sshResourceUsage.schema, async args => {
    const result = await sshResourceUsage.handler(args)
    await auditLog(sshResourceUsage.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshPorts.name, sshPorts.description, sshPorts.schema, async args => {
    const result = await sshPorts.handler(args)
    await auditLog(sshPorts.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshProcessList.name, sshProcessList.description, sshProcessList.schema, async args => {
    const result = await sshProcessList.handler(args)
    await auditLog(sshProcessList.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshDockerPs.name, sshDockerPs.description, sshDockerPs.schema, async args => {
    const result = await sshDockerPs.handler(args)
    await auditLog(sshDockerPs.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshDockerLogs.name, sshDockerLogs.description, sshDockerLogs.schema, async args => {
    const result = await sshDockerLogs.handler(args)
    await auditLog(sshDockerLogs.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshDockerRestart.name, sshDockerRestart.description, sshDockerRestart.schema, async args => {
    const result = await sshDockerRestart.handler(args)
    await auditLog(sshDockerRestart.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshGit.name, sshGit.description, sshGit.schema, async args => {
    const result = await sshGit.handler(args)
    await auditLog(sshGit.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(sshCurl.name, sshCurl.description, sshCurl.schema, async args => {
    const result = await sshCurl.handler(args)
    await auditLog(sshCurl.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(downloadToRemote.name, downloadToRemote.description, downloadToRemote.schema, async args => {
    const result = await downloadToRemote.handler(args, env.PROXY_ALLOWED_DOMAINS)
    await auditLog(downloadToRemote.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  // -------------------------------------------------------------------------
  // Local FS — scratch volume (/data/scratch bind-mounted in docker-compose)
  // -------------------------------------------------------------------------

  server.tool(localFsRead.name, localFsRead.description, localFsRead.schema, async args => {
    const result = await localFsRead.handler(args)
    await auditLog(localFsRead.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.tool(localFsWrite.name, localFsWrite.description, localFsWrite.schema, async args => {
    const result = await localFsWrite.handler(args)
    await auditLog(localFsWrite.name, args, result)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  return server
}
