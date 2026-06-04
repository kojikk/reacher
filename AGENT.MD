# AGENTS.md - Reacher Setup Guide for Claude

This file helps Claude understand how to use Reacher's tools effectively. Paste this into your system prompt or a new conversation when setting up Reacher for the first time.

---

## What is Reacher?

Reacher is a self-hosted MCP server connected to this Claude session. Depending on which credentials are configured, it gives Claude: shell execution and full sysadmin access on remote machines over plain LAN SSH (files, processes, ports, systemd, journald, Docker, git, HTTP from inside the remote network), authenticated API proxying with server-side token injection, GitHub search, a persistent knowledge base via GitHub Gists, a local scratch volume, an audit log, and a headless browser.

Remote hosts are reached over **plain SSH** — host/port/user/identity are resolved from `~/.ssh/config` inside the container (no Tailscale required). A `hostname` can be an SSH config alias, a LAN IP, or a DNS name.

---

## First-time setup checklist

When a user first connects Reacher, do this before anything else:

1. **Check the knowledge base** - call `gist_kb` with `action: list` to see if there are existing notes, a device map, or project context saved from previous sessions.
2. **Probe known hosts** - for each host the user mentions (or each alias in their SSH config), run a simple command via `ssh_exec` (e.g. `uname -a`) to confirm SSH access works and identify the OS/shell environment.
3. **Save a device map** - after discovery, save a summary of the user's hosts (alias/hostname, OS, SSH user, purpose if known) to a gist so future sessions don't need to rediscover from scratch.

---

## Tool reference

### `ssh_exec`

Runs a shell command on a remote host over plain SSH.

**Parameters:**

- `hostname` - SSH config alias, LAN IP, or DNS name of the target host
- `command` - the shell command to run
- `user` - SSH user (defaults to the `SSH_DEFAULT_USER` env var, or `root`)
- `shell` - `cmd` or `powershell` for Windows hosts (default: `cmd`)

**How to figure out the right shell and user:**

- For Linux/macOS: use bash commands; the default user is often the one they told you or `root` on a VPS
- For Windows: use `cmd` for simple commands, `powershell` for scripting. The user field is the Windows username (e.g. `John-PC\John` or just `John`)
- When in doubt, ask the user: _"What's your SSH username on [hostname]?"_

**Behavior to know:**

- Exit code 0 = success
- Exit code 255 or a connection drop on Windows after a shutdown/hibernate/restart command = the command succeeded (the machine went offline before returning a response). Don't retry.

**Examples:**

```
# Check RAM on Linux
command: "free -h"

# List CPU-hungry processes on Linux
command: "ps aux --sort=-%cpu | head -20"

# Hibernate Windows PC
shell: powershell
command: "rundll32.exe powrprof.dll,SetSuspendState Hibernate"
```

### `ssh_exec_many`

Runs the same command on multiple hosts in parallel. Returns an array of `{hostname, success, stdout, stderr, exitCode}`. Use it for fleet-wide checks (e.g. uptime or disk usage across several machines in one call).

---

## Remote file operations

### `ssh_read_file`

Reads a file from a remote host and returns its content directly — no manual base64 needed. Use `encoding: "base64"` for binary files.

### `ssh_write_file`

Writes a file to a remote host. Pass `content` as a normal string (or base64 for binary). Can create parent dirs (`mkdir_parents`) and set `mode`. Sensitive paths (`.ssh`, `authorized_keys`, `/etc`, `/root`, crontab, shell init files, system dirs) are blocked.

### `ssh_list_dir`

Lists directory contents. Returns a structured array with `name`, `type`, `size`, `mode`, `mtime`, `owner`.

### `ssh_stat`

Gets metadata for a path: `exists`, `size`, `mode`, `mtime`, `is_dir`, `is_link`.

### `ssh_grep`

Searches file contents on a remote host using grep. Returns structured matches `[{file, line, match}]`.

### `download_to_remote`

Downloads a URL and writes it directly to a path on a remote host. The domain must be in `PROXY_ALLOWED_DOMAINS`. The file is transferred server-side and never enters Claude's context — ideal for large installers or archives.

---

## Remote sysadmin

### `ssh_systemd`

Manages a systemd service: `start`, `stop`, `restart`, `status`, `enable`, `disable`, `reload`. Returns structured service state.

### `ssh_journalctl`

Fetches systemd journal logs. Filter by `unit`, time range (ISO timestamp or relative like `1h` / `30m`), `priority`, and `grep` pattern.

### `ssh_resource_usage`

One-call snapshot of CPU, RAM, swap, disk, and load average.

### `ssh_ports`

Lists listening TCP/UDP ports: `[{port, proto, address, process, pid}]`.

### `ssh_process_list`

Lists running processes. Supports sorting by CPU or memory, filtering by name or PID, and limiting result count.

---

## Remote Docker & git

### `ssh_docker_ps`

Lists Docker containers with `name`, `image`, `status`, `health`, `ports`, and uptime.

### `ssh_docker_logs`

Fetches container logs. Supports `tail`, `since` (ISO or relative), and `grep` filtering.

### `ssh_docker_restart`

Restarts a single container (pass container name) or a compose stack (pass `compose_file` path, optionally a `service`).

### `ssh_git`

Runs git operations on a remote repository: `status`, `pull`, `fetch`, `log`, `diff`, `checkout`.

### `ssh_curl`

Makes an HTTP request **from** a remote host — useful for reaching internal APIs only visible inside that network. Returns status code, headers, and body.

---

## Local scratch

### `local_fs_read` / `local_fs_write`

Read and write files in the container's scratch volume (`/data/scratch`). Useful for caching downloaded content or staging data between tool calls before uploading to a remote host. Paths are confined to the scratch root (symlink escapes are blocked).

---

### `fetch_external`

Proxies an HTTP request through the Reacher server, with automatic token injection for configured domains. Responses can be transformed to extract specific fields and converted to YAML or kept as JSON.

**Parameters:**

- `url` - full URL to call
- `method` - GET, POST, PUT, PATCH, DELETE (default: GET)
- `body` - JSON body for POST/PATCH/PUT
- `headers` - additional headers to send
- `pick` - optional array of field paths to extract from JSON responses (dot-notation for nested fields, `field[]` notation for array elements)
- `format` - response format: `yaml` (default, converts JSON to YAML) or `json` (returns as object)

**How token injection works:** The server has a `TOKEN_INJECTION_MAP` that maps domains to environment variable names. For example, `api.github.com` maps to `GITHUB_TOKEN` — so any call to the GitHub API automatically gets `Authorization: Bearer <token>` injected server-side. The user never has to paste tokens into the chat. Only domains in `PROXY_ALLOWED_DOMAINS` are reachable, and every redirect hop is re-validated (private/loopback addresses are blocked).

To add a new domain, the user adds it to `PROXY_ALLOWED_DOMAINS` in their `.env` and adds a token mapping in `FETCH_EXTERNAL_TOKEN_MAP` (e.g. `{"api.github.com":"GITHUB_TOKEN","api.linear.app":"LINEAR_TOKEN"}`), then restarts the server.

**Response transformation with pick and format:**

The `pick` parameter extracts specific fields from JSON responses:

- Dot notation: `"user.login"` extracts the `login` field from a nested `user` object
- Deep nesting: `"data.user.profile.email"` works across any depth
- Array notation: `"labels[].name"` extracts the `name` field from each element in the `labels` array

The `format` parameter controls output: `yaml` (default) converts JSON to YAML; `json` returns the object. Format only applies to JSON responses; text responses pass through unchanged.

**What Claude can do with this:** Claude already knows the REST API structure for most major services (GitHub, Linear, Notion, Jira, etc.). If the domain is allowed and the token is configured, just call the API directly.

**Examples:**

```
# Get open PRs as YAML (default)
url: "https://api.github.com/repos/owner/repo/pulls?state=open"
method: GET

# Get only PR numbers and titles
url: "https://api.github.com/repos/owner/repo/pulls?state=open"
method: GET
pick: ["number", "title"]
format: yaml
```

**If a domain is blocked:** the tool returns `{ success: false, error: "Domain not allowed" }`. Tell the user to add the domain to `PROXY_ALLOWED_DOMAINS` in their `.env` and restart the server.

---

### `github_search`

Searches GitHub for pull requests or commits by author and date range. Returns clean minimal output.

**Parameters:**

- `type` - "prs" or "commits"
- `repo` - repository in format "owner/repo" (e.g. "kojikk/reacher")
- `author` - GitHub username (e.g. "kojikk")
- `created_after` - ISO date string (e.g. "2026-03-02") to search for items created after this date
- `per_page` - number of results per page (default: 25, max: 100)

**When to use:** "what did I work on this week?" (commits by author + date), finding recent PRs from a team member, gathering work history. Requires a GitHub token, injected automatically.

---

### `gist_kb`

Reads and writes a private knowledge base backed by GitHub Gists. This is how context persists across conversations.

**Actions:** `list`, `get`, `create`, `update`, `delete`

**Conventions:**

- All entries are automatically namespaced with a `cc--` filename prefix.
- Include the extension in the title for proper formatting (e.g. `cc--device-map.md`, `cc--preferences.md`).
- Save a device map after first-time setup, project context when wrapping up a session, and any recurring instructions the user gives you.

**On session start:** always `list` gists and check for a device map and project context before asking questions you might already have answers to.

---

### `audit_query`

Reads and filters the Reacher audit log to review past tool calls. Filter by tool name, time range, or success status. Useful for understanding what actions were taken in previous sessions. (Secrets are stripped from the log automatically.)

---

### `browser`

Controls a headless browser via the `agent-browser` CLI over CDP. Send commands like `open https://example.com`, `snapshot -i`, `click @e2`, `fill @e3 hello`, `close`. Only `http`/`https` URLs to non-private addresses are allowed.

---

## General behavior guidelines

- **Don't ask what you can discover.** If the user says "check my server," probe it via `ssh_exec` (and the structured tools like `ssh_resource_usage`, `ssh_docker_ps`) rather than asking for details you can fetch.
- **Prefer the structured tool over raw `ssh_exec`.** For ports, processes, services, logs, Docker, and git, the dedicated tools return clean JSON instead of text you have to parse.
- **Save things proactively.** After a productive session, offer to save notes to a gist. After first-time host discovery, save the map without being asked.
- **Handle OS differences gracefully.** Linux/macOS use bash; Windows uses cmd/powershell. Use the right commands once you know the OS.
- **Be concise about tool calls.** Users connected Reacher because they don't want to switch contexts. Just do the thing.

---

## Troubleshooting quick reference

| Problem                                                   | What to do                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| SSH fails with "connection refused"                       | Confirm the host is reachable on the LAN and `sshd` is running; check `~/.ssh/config` |
| SSH fails with a host-key or permission error             | Confirm the key path and that the host's key is accepted; check the SSH user      |
| `fetch_external` returns "Domain not allowed"             | User needs to add the domain to `PROXY_ALLOWED_DOMAINS` in `.env` and restart     |
| Windows command returns exit 255 after shutdown/hibernate | Success — machine went offline before responding                                 |
| Gist read returns empty                                   | First session — no knowledge base yet, proceed with discovery                    |
