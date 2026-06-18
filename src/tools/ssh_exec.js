/**
 * SSH Execute tool
 * Runs shell commands on remote hosts via plain SSH.
 * Host/port/user/identity are resolved via ~/.ssh/config inside the container.
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { config, isCommandBlocked } from '../lib/config.js'
import { SSH_BINARY, SSH_BASE_OPTS, validateTarget, ensureKey } from '../lib/ssh.js'

/**
 * Encode a string as Base64-encoded UTF-16LE for PowerShell -EncodedCommand
 * @param {string} str
 * @returns {string}
 */
function toBase64Utf16Le(str) {
  const buf = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16LE(str.charCodeAt(i), i * 2);
  }
  return buf.toString('base64');
}

export const name = 'ssh_exec';

export const description =
  'Execute a shell command on a remote host over plain SSH. ' +
  'Hostname can be a SSH config alias, LAN IP, or DNS name.';

export const schema = {
  hostname: z.string().describe('SSH hostname or alias defined in /root/.ssh/config (e.g. "kojikk-server")'),
  command: z.string().describe('Shell command to execute on the remote device'),
  user: z
    .string()
    .optional()
    .default(process.env.SSH_DEFAULT_USER || 'root')
    .describe('SSH user to connect as (defaults to SSH_DEFAULT_USER env var, or "root")'),
  shell: z
    .enum(['cmd', 'powershell'])
    .optional()
    .default('cmd')
    .describe('Shell to use on Windows (cmd or powershell; default: cmd)'),
};

/**
 * @param {{ hostname: string, command: string, user: string, shell: string }} args
 */
export async function handler({ hostname, command, user, shell = 'cmd' }) {
  // ---
  // Safety checks
  // ---

  // Reject hostnames/users that could be interpreted as ssh options
  const targetError = validateTarget({ hostname, user })
  if (targetError) {
    return { success: false, error: targetError, hostname, user }
  }

  // Check for blocked commands
  const blockedCommands = config.ssh.blocked_commands || []
  for (const blocked of blockedCommands) {
    if (isCommandBlocked(command, blocked)) {
      return {
        success: false,
        blocked: true,
        reason: 'Command blocked by reacher config',
        matched_rule: blocked,
        hostname,
        user,
        command,
      }
    }
  }

  // Check for allowed directories
  const allowedDirs = config.ssh.allowed_dirs || []
  if (allowedDirs.length > 0) {
    // Extract paths from command (tokens starting with /, ~, or ./)
    const pathTokens = command.match(/(?:^|\s)(\/[\S]*|~[\S]*|\.\/[\S]*)/g) || []
    const paths = pathTokens.map(p => p.trim())

    for (const path of paths) {
      const isAllowed = allowedDirs.some(allowedDir => path.startsWith(allowedDir))
      if (!isAllowed) {
        return {
          success: false,
          blocked: true,
          reason: 'Path not in allowed directories',
          hostname,
          user,
          command,
        }
      }
    }
  }

  // Dry-run mode (after safety checks so blocked commands are still blocked)
  if (config.dry_run) {
    return {
      success: true,
      dry_run: true,
      would_execute: command,
      hostname,
      user,
    }
  }

  // Verify ssh binary + key exist and the key has 0600 perms
  if (!ensureKey()) {
    return {
      success: false,
      hostname,
      user,
      command,
      stdout: '',
      stderr: 'SSH binary or reacher key not found. Ensure openssh-client is installed and the key is mounted.',
      exitCode: 127,
      error: 'ssh: not available',
    }
  }

  // Build the remote command based on shell type
  let remoteCmd = command;
  if (shell === 'powershell') {
    // Encode the command as Base64 UTF-16LE for PowerShell
    const encoded = toBase64Utf16Le(command);
    remoteCmd = `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  }

  // Build SSH args as array to avoid local shell expansion
  const sshArgs = [
    ...SSH_BASE_OPTS,
    `${user}@${hostname}`,
    remoteCmd,
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(SSH_BINARY, sshArgs, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        hostname,
        user,
        command,
        shell,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        hostname,
        user,
        command,
        shell,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 1,
        error: error.message,
      });
    });
  });
}
