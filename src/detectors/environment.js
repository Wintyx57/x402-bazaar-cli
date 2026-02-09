import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

/**
 * Detect which AI client / IDE the user is running.
 * Returns: { name, configPath, detected }
 */
export function detectEnvironment() {
  const os = platform();
  const home = homedir();
  const results = [];

  // --- Claude Desktop ---
  const claudeDesktopPaths = {
    win32: join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    darwin: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    linux: join(home, '.config', 'Claude', 'claude_desktop_config.json'),
  };

  const claudePath = claudeDesktopPaths[os];
  if (claudePath) {
    const claudeDir = claudePath.replace(/[/\\][^/\\]+$/, '');
    const claudeExists = existsSync(claudeDir);
    results.push({
      name: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: claudePath,
      configDir: claudeDir,
      detected: claudeExists,
      os,
    });
  }

  // --- Claude Code (CLI) ---
  const claudeCodePaths = {
    win32: join(home, '.claude.json'),
    darwin: join(home, '.claude.json'),
    linux: join(home, '.claude.json'),
  };

  const claudeCodePath = claudeCodePaths[os];
  if (claudeCodePath) {
    results.push({
      name: 'claude-code',
      label: 'Claude Code (CLI)',
      configPath: claudeCodePath,
      configDir: home,
      detected: existsSync(claudeCodePath),
      os,
    });
  }

  // --- Cursor ---
  const cursorPaths = {
    win32: join(home, '.cursor', 'mcp.json'),
    darwin: join(home, '.cursor', 'mcp.json'),
    linux: join(home, '.cursor', 'mcp.json'),
  };

  const cursorPath = cursorPaths[os];
  if (cursorPath) {
    const cursorDir = cursorPath.replace(/[/\\][^/\\]+$/, '');
    results.push({
      name: 'cursor',
      label: 'Cursor',
      configPath: cursorPath,
      configDir: cursorDir,
      detected: existsSync(cursorDir),
      os,
    });
  }

  // --- VS Code + Continue ---
  const vscodePaths = {
    win32: join(home, '.continue', 'config.json'),
    darwin: join(home, '.continue', 'config.json'),
    linux: join(home, '.continue', 'config.json'),
  };

  const vscodePath = vscodePaths[os];
  if (vscodePath) {
    const vscodeDir = vscodePath.replace(/[/\\][^/\\]+$/, '');
    results.push({
      name: 'vscode-continue',
      label: 'VS Code + Continue',
      configPath: vscodePath,
      configDir: vscodeDir,
      detected: existsSync(vscodeDir),
      os,
    });
  }

  return results;
}

/**
 * Get human-friendly OS name.
 */
export function getOsLabel() {
  const os = platform();
  const labels = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };
  return labels[os] || os;
}

/**
 * Get the default install directory for the MCP server files.
 */
export function getDefaultInstallDir() {
  const os = platform();
  const home = homedir();

  if (os === 'win32') {
    return join(home, 'x402-bazaar');
  }
  return join(home, '.x402-bazaar');
}
