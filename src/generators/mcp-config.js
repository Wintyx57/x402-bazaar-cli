import { join } from 'path';
import { platform } from 'os';

/**
 * Generate the MCP server config JSON for the target environment.
 */
export function generateMcpConfig({
  environment,       // 'claude-desktop' | 'cursor' | 'claude-code' | 'generic'
  installDir,        // Where mcp-server.mjs is located
  serverUrl = 'https://x402-api.onrender.com',
  maxBudget = '1.00',
  network = 'mainnet',
  coinbaseApiKey = '',
  coinbaseApiSecret = '',
  seedPath = '',
  readOnly = false,
}) {
  const os = platform();
  const sep = os === 'win32' ? '\\' : '/';

  const mcpServerPath = join(installDir, 'mcp-server.mjs');
  const defaultSeedPath = seedPath || join(installDir, 'agent-seed.json');

  const env = {
    X402_SERVER_URL: serverUrl,
    MAX_BUDGET_USDC: maxBudget,
    NETWORK: network,
  };

  if (!readOnly) {
    env.COINBASE_API_KEY = coinbaseApiKey || 'YOUR_COINBASE_API_KEY';
    env.COINBASE_API_SECRET = coinbaseApiSecret || 'YOUR_COINBASE_API_SECRET';
    env.AGENT_SEED_PATH = defaultSeedPath;
  }

  const serverEntry = {
    command: 'node',
    args: [mcpServerPath],
    env,
  };

  // Format for the target environment
  switch (environment) {
    case 'claude-desktop':
      return {
        mcpServers: {
          'x402-bazaar': serverEntry,
        },
      };

    case 'cursor':
      return {
        mcpServers: {
          'x402-bazaar': serverEntry,
        },
      };

    case 'claude-code':
      return {
        mcpServers: {
          'x402-bazaar': serverEntry,
        },
      };

    case 'vscode-continue':
      return {
        models: [],
        mcpServers: [
          {
            name: 'x402-bazaar',
            ...serverEntry,
          },
        ],
      };

    default:
      return {
        mcpServers: {
          'x402-bazaar': serverEntry,
        },
      };
  }
}

/**
 * Generate a minimal config for read-only mode (no wallet).
 */
export function generateReadOnlyConfig({ environment, installDir, serverUrl }) {
  return generateMcpConfig({
    environment,
    installDir,
    serverUrl,
    readOnly: true,
  });
}
