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
  agentPrivateKey = '',
  coinbaseApiKey = '',
  coinbaseApiSecret = '',
  readOnly = false,
}) {
  const mcpServerPath = join(installDir, 'mcp-server.mjs');

  const env = {
    X402_SERVER_URL: serverUrl,
    MAX_BUDGET_USDC: maxBudget,
    NETWORK: network,
  };

  if (!readOnly) {
    if (agentPrivateKey) {
      env.AGENT_PRIVATE_KEY = agentPrivateKey;
    } else if (coinbaseApiKey) {
      env.COINBASE_API_KEY = coinbaseApiKey;
      env.COINBASE_API_SECRET = coinbaseApiSecret;
    }
  }

  // Polygon facilitator — gas-free payments via PIP-82
  if (network === 'polygon') {
    env.POLYGON_FACILITATOR_URL = 'https://x402.polygon.technology';
    env.POLYGON_FEE_SPLITTER_CONTRACT = '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56';
  }

  const serverEntry = {
    command: 'node',
    args: [mcpServerPath],
    env,
  };

  // Format for the target environment
  switch (environment) {
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
