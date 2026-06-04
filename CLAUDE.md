# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Reacher** is a self-hosted MCP (Model Context Protocol) server that gives Claude access to:

- SSH execution and full sysadmin tooling on remote hosts over plain LAN SSH (files, processes, ports, systemd, journald, Docker, git, HTTP from inside the remote network)
- Authenticated HTTP proxying with per-domain token injection and SSRF guards
- GitHub search (PRs and commits)
- Persistent knowledge base (GitHub Gists)
- A local scratch volume and a sanitized audit log
- Headless browser control

Remote hosts are reached over plain SSH — host/port/user/identity are resolved from `~/.ssh/config` inside the container (no Tailscale required). The server runs as an Express.js HTTP service with token-based auth and communicates with Claude via the MCP protocol.

## Architecture

### Core Stack

- **Runtime**: Node.js 22+ (uses ES modules, no CommonJS)
- **Framework**: Express.js for HTTP + @modelcontextprotocol/sdk for MCP
- **Transport**: StreamableHTTPServerTransport (stateless - new transport per request)
- **Config**: dotenv for environment variables
- **Validation**: Zod for schema definitions

### Request Flow

1. Claude sends HTTP POST to `/mcp` with JSON-RPC body, authenticating via `Authorization: Bearer <MCP_SECRET>` (a `?token=` query param is still accepted for backward compatibility)
2. Express applies a rate limiter, then a constant-time token check — both run *before* the JSON body is parsed (and the body is size-limited)
3. MCP transport creates a new handler per request
4. Tool handler executes and returns result as JSON
5. Response streamed back to Claude

### Tool Pattern

Every tool in `src/tools/*.js` exports:

```javascript
export const name = 'tool_name'
export const description = '...'
export const schema = { param: z.string().describe('...') } // Zod shape
export async function handler(args, allowedDomains?, env) { ... }
```

Different tools receive different parameters:

- **ssh_exec** and the other SSH tools: `handler(args)` - no env
- **fetch_external, github_search**: `handler(args, allowedDomains, env)` - whitelist + full env
- **gist_kb, browser**: `handler(args, env)` - full env object

Each tool is registered in `src/mcp-server.js` with `server.tool(...)`.

Shared logic lives in `src/lib/`:

- **`ssh.js`** - centralized SSH binary path, base options (`StrictHostKeyChecking=accept-new`, `IdentitiesOnly`, key path), `shellQuote()` for safe argument quoting, `validateTarget()` (rejects option-injection hostnames/users), and `ensureKey()`. All SSH tools route through these.
- **`ssrf.js`** - `validateFetchUrl()` and `safeFetch()`: scheme + domain allowlist, private/loopback/link-local IP blocking, and manual redirect following that re-validates every hop. Used by `fetch_external`, `download_to_remote`, and `browser`.

## Development

### Common Commands

```bash
# Install dependencies
npm install

# Run with auto-reload (recommended for dev)
npm run dev

# Build Docker image
npm run docker:build

# Run Docker locally (single shot, connects to .env)
npm run docker:run

# Run Docker production (daemonized with restart)
npm run docker:run:prod
```

### Environment Variables

Create `.env` from `.env.example`. Key vars:

- **MCP_SECRET**: Token for /mcp endpoint auth (set to random string)
- **GITHUB_TOKEN**: For gist_kb and github_search tools (needs gist scope)
- **PROXY_ALLOWED_DOMAINS**: Comma-separated list for fetch_external (e.g. `api.github.com,api.linear.app`)
- **FETCH_EXTERNAL_TOKEN_MAP**: JSON mapping domain → env var name (e.g. `{"api.github.com":"GITHUB_TOKEN"}`)
- **SSH_DEFAULT_USER**: Default SSH user when none is given per-call (default `root`)
- **SSH_KEY_PATH**: Path to the SSH identity inside the container (default `/home/node/.ssh/reacher-key`)
- **SSH_BLOCKED_COMMANDS / SSH_ALLOWED_DIRS**: Optional command denylist / directory allowlist for ssh_exec
- **AUDIT_ENABLED / AUDIT_LOG_PATH**: Toggle and path for the sanitized audit log
- **DRY_RUN**: When truthy (`true/1/yes/on`), ssh_exec does not actually execute commands
- **PORT**: HTTP port (default 3000)
- **BROWSER_CDP_HOST/PORT**: Headless browser connection (defaults: 127.0.0.1:9222)

### Adding a New Tool

1. Create `src/tools/my_tool.js` with the standard export pattern
2. Import and register in `src/mcp-server.js` with `server.tool(...)`
3. Update documentation (README.md, AGENT.MD) to list the new tool
4. No tests needed unless tool integrates with external APIs

### Authentication & Token Injection

The **fetch_external** and **github_search** tools use a token injection pattern:

- `FETCH_EXTERNAL_TOKEN_MAP` maps domain → env var name
- Handler reads this map and automatically injects `Authorization: Bearer <token>` header
- No hardcoding of tokens; they stay server-side

Example: If `FETCH_EXTERNAL_TOKEN_MAP={"api.github.com":"GITHUB_TOKEN"}` and `GITHUB_TOKEN=ghp_xxx`, any call to `api.github.com` gets the token injected automatically.

### Domain Whitelisting & SSRF Guards

**fetch_external**, **download_to_remote**, **browser**, and **github_search** require the target domain to be in `PROXY_ALLOWED_DOMAINS`. The shared `validateFetchUrl()` in `src/lib/ssrf.js` enforces this and also rejects non-http(s) schemes and private/loopback/link-local addresses:

```javascript
import { validateFetchUrl, safeFetch } from '../lib/ssrf.js'

const { hostname } = validateFetchUrl(url, allowedList) // throws if scheme/host disallowed
const response = await safeFetch(url, options, allowedList, buildHeaders) // re-validates every redirect hop
```

`safeFetch` follows redirects manually and re-checks each hop against the allowlist, and injects auth headers only for the host that owns them — so a redirect can't bounce a request (with credentials) to an internal address.

## Deployment

### Docker (Recommended)

```bash
# Build and run in one command
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  --name reacher \
  $(docker build -q .)
```

### Bare Node

```bash
npm install
node index.js
```

The server exposes:

- **POST /mcp** - MCP protocol endpoint (requires `?token=MCP_SECRET`)
- **GET /health** - Health check (no auth required)

### Connecting to Claude.ai

1. Go to **Claude.ai** > **Settings** > **Integrations**
2. Click **Add custom connector**
3. Enter server URL: `https://yourdomain.com/mcp?token=YOUR_MCP_SECRET`
4. Authenticate

## Key Design Decisions

1. **Stateless Transports**: New MCP transport created per request. No session state stored on server.
2. **Token Injection**: Tokens stay server-side; Claude never sees them. Configured via `FETCH_EXTERNAL_TOKEN_MAP`, injected per-host so redirects can't leak them.
3. **Domain Whitelisting & SSRF Guards**: Outbound HTTP tools enforce strict domain allowlists and block private addresses, re-validating every redirect hop (`src/lib/ssrf.js`).
4. **SSH Injection Safety**: All SSH tools shell-quote and validate arguments through `src/lib/ssh.js`; `ssh_write_file` also denies writes to sensitive paths.
5. **ES Modules Only**: No CommonJS. `"type": "module"` in package.json.
6. **Zod Schemas**: All tool parameters validated using Zod. Descriptions appear in Claude's tool documentation.
7. **Handler Signature Variance**: Different tools receive different env parameters to minimize exposure (least privilege principle).
8. **Hardened Container**: The Docker image runs as a non-root user with dropped capabilities, `no-new-privileges`, read-only source mounts, and dependencies pinned and installed with `--ignore-scripts`.

## Important Notes

- The server requires `MCP_SECRET` to be set; requests without the correct token are rejected with 401.
- `ssh_exec` connects over plain SSH: the target host must be reachable on the network with `sshd` running, and the host/user/key must be resolvable (via `~/.ssh/config` and the identity at `SSH_KEY_PATH`). Unknown host keys are accepted on first use (`StrictHostKeyChecking=accept-new`).
- GitHub token needs `gist` scope for `gist_kb` tool and any other API scopes needed by `fetch_external`/`github_search`.
- Browser tool requires `agent-browser` CLI to be installed globally and a CDP-compatible browser running (e.g. Lightpanda).

## Documentation Files

- **README.md**: High-level overview, tools table, prerequisites, setup, deployment options
- **AGENT.MD**: Claude-specific guide on how to use each tool, first-time setup checklist, troubleshooting
- **docs/**: setup, configuration, deployment, safety, extending, and the full tools reference
