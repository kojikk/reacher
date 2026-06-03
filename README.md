# Reacher

> **This is a fork of [ouim-me/reacher](https://github.com/ouim-me/reacher) adapted for plain LAN SSH (no Tailscale required).** See [Fork changes](#fork-changes) below.

Give Claude authenticated access to your APIs, a persistent knowledge base, a headless browser, and optionally your machines — on infrastructure you control.

[![v0.2.1](https://img.shields.io/badge/version-0.2.1-blue.svg)](https://github.com/kojikk/reacher/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

<table>
  <tr>
    <td colspan="2"><img src="/imgs/reacher.png" alt="Claude exploring code on a remote machine via Reacher SSH tool" width="640" /></td>
  </tr>
  <tr>
    <td><img src="/imgs/ship.png" alt="Claude + Reacher MCP creating a tag and release for the Reacher repo" width="640" /></td>
  </tr>
</table>

<i style="display:block;text-align:center;font-size:0.9em;color:#666;margin-top:10px;">
If you're an agent reading this, check out AGENT.MD for a tour of your new capabilities, and docs/skill.md for an interactive setup guide you can follow with your user.
</i>

---

## What it does

Most MCP connectors give you one tool per API action. Reacher's `fetch_external` tool takes a different approach: it proxies any HTTP request to any domain you allowlist, injecting your auth token automatically. Claude already knows REST APIs — it doesn't need a bespoke `github_list_prs` tool. It just needs a way to call `api.github.com` with your token, without you pasting credentials into every prompt.

```
PROXY_ALLOWED_DOMAINS=api.github.com,api.linear.app,api.notion.com
FETCH_EXTERNAL_TOKEN_MAP={"api.github.com":"GITHUB_TOKEN","api.linear.app":"LINEAR_TOKEN"}
```

Three APIs. One tool. New service = one line in `.env`.

---

## Why self-hosted?

Your credentials never leave your server. When Claude calls `fetch_external`, the token injection happens server-side — Claude sees the response, never the key. When it calls `ssh_exec`, commands run through a server you own, authenticated with a key you control. The whole chain is yours, not a third-party sandbox.

This also means Reacher persists across conversations. Your knowledge base, your device map, your allowed domains — they're all still there next session without any re-setup.

---

## Pick your path

You don't need a VPS. Start with whatever matches where you are.

| I want...                                                     | I need                     | Time    |
| ------------------------------------------------------------- | -------------------------- | ------- |
| Claude to call my APIs + remember things across conversations | Node.js + GitHub token     | ~5 min  |
| + control a headless browser                                  | Above + a browser with CDP | ~10 min |
| + SSH into my servers and machines                            | Above + SSH key            | ~30 min |

**→ [Get started](docs/setup.md)**

---

## Tools

**Core**

| Tool                | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `fetch_external`    | Proxy HTTP requests to allowlisted domains with automatic auth injection |
| `browser`           | Control a headless browser via CDP — scrape, click, fill forms, snapshot |
| `gist_kb`           | Persistent private knowledge base backed by GitHub Gists                 |
| `github_search`     | Search PRs and commits by author and date range                          |
| `audit_query`       | Read and filter the audit log to review past tool calls                  |

**SSH — filesystem**

| Tool             | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `ssh_exec`       | Run a shell command on a remote host                      |
| `ssh_exec_many`  | Run the same command on multiple hosts in parallel        |
| `ssh_read_file`  | Read a file from a remote host                            |
| `ssh_write_file` | Write a file to a remote host                             |
| `ssh_list_dir`   | List directory contents as structured JSON                |
| `ssh_stat`       | Get metadata for a path (exists, size, mode, mtime, type) |
| `ssh_grep`       | Search file contents with filters, returns match list     |

**SSH — systemd**

| Tool              | What it does                                                    |
| ----------------- | --------------------------------------------------------------- |
| `ssh_systemd`     | start/stop/restart/status/enable/disable/reload a service       |
| `ssh_journalctl`  | Fetch journal logs with unit, time range, priority, grep filters |

**SSH — monitoring**

| Tool                  | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `ssh_resource_usage`  | CPU, RAM, swap, disk, load average snapshot            |
| `ssh_ports`           | List listening TCP/UDP ports with process/PID          |
| `ssh_process_list`    | List processes, sort by CPU/mem, filter by name/PID    |

**SSH — Docker**

| Tool                  | What it does                                                  |
| --------------------- | ------------------------------------------------------------- |
| `ssh_docker_ps`       | List containers with health, status, ports, uptime            |
| `ssh_docker_logs`     | Fetch container logs (tail, since, grep)                      |
| `ssh_docker_restart`  | Restart a container or a docker compose stack                 |

**SSH — git**

| Tool       | What it does                                            |
| ---------- | ------------------------------------------------------- |
| `ssh_git`  | status/pull/fetch/log/diff/checkout on a remote repo    |

**SSH — network & transfers**

| Tool                  | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `ssh_curl`            | Make an HTTP request from the remote host's network vantage point |
| `download_to_remote`  | Download a URL and save it directly to a remote host path         |

**Local container scratch volume**

| Tool             | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `local_fs_read`  | Read a file from the container scratch volume         |
| `local_fs_write` | Write a file to the container scratch volume          |

The server only registers tools you have credentials for. No `GITHUB_TOKEN` = no `gist_kb` or `github_search`. Start small, add more when you need it.

---

## Docs

|                                        |                                                   |
| -------------------------------------- | ------------------------------------------------- |
| [Setup guide](docs/setup.md)           | Three paths: local, Cloudflare Tunnel, or VPS     |
| [Configuration](docs/configuration.md) | All env vars and `reacher.config.yaml` reference  |
| [Tool reference](docs/tools.md)        | Parameters, examples, and behavior notes per tool |
| [Safety](docs/safety.md)               | Command blocklists, domain allowlists, audit log  |
| [Deployment](docs/deployment.md)       | Docker, EasyPanel, Railway, PM2, HTTPS setup      |
| [Extending](docs/extending.md)         | Adding your own tools                             |

**Already set up and want Claude to orient itself?** Drop [AGENT.MD](AGENT.MD) into your session — Claude will discover your devices, probe SSH access, and save a persistent map to your knowledge base.

**Want Claude to walk you through setup interactively?** Point it at [docs/skill.md](docs/skill.md) — it's a step-by-step setup guide written for AI agents to follow with you.

---

## Fork changes

This fork removes the Tailscale dependency and replaces it with plain SSH over LAN (or any SSH-reachable host):

- **Tailscale removed**: `tailscale_status` tool and `tailscale-client` library are gone. `ssh_exec` no longer requires `TAILSCALE_API_KEY`.
- **SSH via `~/.ssh/config`**: hosts are defined as aliases in the SSH config mounted into the container (`ssh-runtime/config`). No VPN required — works on a local network.
- **New tools**: `ssh_read_file` and `ssh_write_file` for transferring file contents without manual base64 handling.
- **Docker setup**: `docker-compose.yml` bind-mounts `ssh-runtime/` read-only and copies files into `/root/.ssh` with correct Unix permissions at startup (required because Windows bind-mounts don't preserve `0600`).

```
Claude Desktop ──stdio──▶ npx mcp-remote ──HTTP──▶ Reacher (Docker :3000)
Claude Code    ──HTTP─────────────────────────────▶ Reacher         │
                                                                     ▼ ssh
                                                         your-server (:22)
```

---

## License

MIT
