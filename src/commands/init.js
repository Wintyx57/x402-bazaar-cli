import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';
import { isInteractive, promptOrDefault, printNonInteractiveHint } from '../utils/prompt.js';
import { detectEnvironment, getOsLabel, getDefaultInstallDir } from '../detectors/environment.js';
import { generateMcpConfig } from '../generators/mcp-config.js';
import { generateEnvContent } from '../generators/env-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Possible locations for the MCP server source
const MCP_SERVER_CANDIDATES = [
  join(__dirname, '..', '..', '..', 'x402-bazaar', 'mcp-server.mjs'),   // Monorepo layout
  join(__dirname, '..', '..', 'mcp-server.mjs'),                        // Bundled with CLI
  join(process.cwd(), 'mcp-server.mjs'),                                // Current directory
  join(process.cwd(), 'x402-bazaar', 'mcp-server.mjs'),                 // Subdirectory
];

function findMcpServerSource() {
  for (const candidate of MCP_SERVER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function initCommand(options) {
  // Node version check
  const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeVersion < 18) {
    log.error(`Node.js >= 18 is required (you have ${process.versions.node}).`);
    log.dim('  Download the latest version at https://nodejs.org');
    process.exit(1);
  }

  log.banner();

  if (!isInteractive()) {
    log.info(chalk.yellow('Non-interactive terminal detected. Using smart defaults.'));
  }

  const osLabel = getOsLabel();
  log.info(`OS: ${chalk.bold(osLabel)} | Node: ${chalk.bold(process.versions.node)}`);
  log.separator();
  console.log('');

  // ─── Step 1: Detect Environment ─────────────────────────────────────
  log.step(1, 'Detecting AI client environment...');
  console.log('');

  const environments = detectEnvironment();
  const detected = environments.filter(e => e.detected);

  let targetEnv;

  if (options.env) {
    targetEnv = environments.find(e => e.name === options.env) || {
      name: options.env,
      label: options.env,
      configPath: null,
      detected: false,
    };
    log.info(`Using: ${chalk.bold(targetEnv.label)}`);
  } else if (detected.length === 1) {
    targetEnv = detected[0];
    log.success(`Auto-detected: ${chalk.bold(targetEnv.label)}`);
    if (targetEnv.configPath) {
      log.dim(`  Config: ${targetEnv.configPath}`);
    }
  } else {
    if (detected.length > 1) {
      log.info(`Found ${detected.length} AI clients.`);
    } else {
      log.warn('No AI client detected automatically.');
    }

    const defaultEnv = detected.length > 0 ? detected[0].name : 'claude-desktop';

    const choices = [
      ...environments.map(e => ({
        name: `${e.label}${e.detected ? chalk.hex('#34D399')(' (detected)') : ''}`,
        value: e.name,
      })),
      ...(isInteractive() ? [new inquirer.Separator()] : []),
      { name: 'Generic (I\'ll configure manually)', value: 'generic' },
    ];

    const { env } = await promptOrDefault([{
      type: 'list',
      name: 'env',
      message: 'Which AI client are you using?',
      choices,
      default: defaultEnv,
    }]);

    targetEnv = environments.find(e => e.name === env) || {
      name: env, label: env, configPath: null, detected: false,
    };
  }

  console.log('');

  // ─── Step 2: Install MCP Server ─────────────────────────────────────
  log.step(2, 'Setting up MCP server files...');
  console.log('');

  const installDir = getDefaultInstallDir();
  log.info(`Install directory: ${chalk.dim(installDir)}`);

  const spinner = ora('Creating directory and copying files...').start();

  try {
    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true });
    }

    const mcpServerDest = join(installDir, 'mcp-server.mjs');
    const mcpSource = findMcpServerSource();

    if (mcpSource) {
      copyFileSync(mcpSource, mcpServerDest);
      spinner.text = 'Copied mcp-server.mjs from local project...';
    } else {
      spinner.text = 'Generating MCP server file...';
      writeFileSync(mcpServerDest, generateMcpServerFile());
    }

    // Create package.json for the MCP server runtime
    const pkgJsonPath = join(installDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      writeFileSync(pkgJsonPath, JSON.stringify({
        name: 'x402-bazaar-mcp',
        version: '1.0.0',
        type: 'module',
        private: true,
        dependencies: {
          '@coinbase/coinbase-sdk': '^0.25.0',
          '@modelcontextprotocol/sdk': '^1.26.0',
          'dotenv': '^17.2.4',
          'zod': '^4.3.6',
        },
      }, null, 2));
    }

    // Create .gitignore in install dir
    const gitignorePath = join(installDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, 'node_modules/\n.env\n*.seed.json\n');
    }

    spinner.succeed('MCP server files ready');
  } catch (err) {
    spinner.fail(`Failed to set up files: ${err.message}`);
    log.error('You may need to create the directory manually:');
    log.dim(`  mkdir "${installDir}"`);
    log.dim('Then re-run: npx x402-bazaar init');
    process.exit(1);
  }

  // npm install in the install directory
  const spinnerNpm = ora('Installing dependencies (this may take a minute)...').start();
  try {
    execSync('npm install --no-fund --no-audit', {
      cwd: installDir,
      stdio: 'pipe',
      timeout: 180000,
    });
    spinnerNpm.succeed('Dependencies installed');
  } catch (err) {
    spinnerNpm.warn('npm install had issues');
    log.dim(`  You can install manually: cd "${installDir}" && npm install`);
  }

  console.log('');

  // ─── Step 3: Wallet Configuration ───────────────────────────────────
  log.step(3, 'Configuring wallet...');
  console.log('');

  let walletMode = 'readonly';
  let coinbaseApiKey = '';
  let coinbaseApiSecret = '';
  let seedPath = '';
  let maxBudget = '1.00';
  let network = 'mainnet';
  let serverUrl = options.serverUrl || 'https://x402-api.onrender.com';

  if (options.wallet === false) {
    log.info('Skipping wallet setup (--no-wallet)');
    walletMode = 'readonly';
  } else {
    const { mode } = await promptOrDefault([{
      type: 'list',
      name: 'mode',
      message: 'How do you want to configure payments?',
      choices: [
        {
          name: `${chalk.bold('I have Coinbase API keys')} — Full access (search, register, pay)`,
          value: 'existing',
        },
        {
          name: `${chalk.bold('Create a new wallet')} — Guide me through setup`,
          value: 'new',
        },
        {
          name: `${chalk.bold('Read-only mode')} — Browse marketplace for free (no payments)`,
          value: 'readonly',
        },
      ],
      default: 'readonly',
    }]);

    walletMode = mode;

    if (mode === 'existing') {
      if (!isInteractive()) {
        log.warn('Cannot enter API credentials in a non-interactive terminal.');
        log.info('Falling back to read-only mode.');
        log.dim('  To configure wallet, run in a standalone terminal:');
        log.dim('    npx x402-bazaar init');
        walletMode = 'readonly';
      } else {
        const walletAnswers = await promptOrDefault([
          {
            type: 'input',
            name: 'coinbaseApiKey',
            message: 'Coinbase API Key (from portal.cdp.coinbase.com):',
            validate: (v) => v.trim().length > 0 || 'API key is required',
          },
          {
            type: 'password',
            name: 'coinbaseApiSecret',
            message: 'Coinbase API Secret:',
            mask: '*',
            validate: (v) => v.trim().length > 0 || 'API secret is required',
          },
        ]);
        coinbaseApiKey = walletAnswers.coinbaseApiKey.trim();
        coinbaseApiSecret = walletAnswers.coinbaseApiSecret.trim();

        // Check if agent-seed.json exists
        const existingSeed = join(installDir, 'agent-seed.json');
        if (!existsSync(existingSeed)) {
          log.warn('No agent-seed.json found. You will need to create a wallet.');
          log.dim('  Run: cd "' + installDir + '" && node -e "const{Coinbase,Wallet}=require(\'@coinbase/coinbase-sdk\');...');
          log.dim('  Or copy your existing agent-seed.json to: ' + installDir);
        }
      }
    }

    if (mode === 'new') {
      console.log('');
      log.info('To get Coinbase API keys:');
      console.log('');
      log.dim('  1. Go to https://portal.cdp.coinbase.com/');
      log.dim('  2. Create a project (free)');
      log.dim('  3. Go to "API Keys" and generate a key pair');
      log.dim('  4. Save both the API Key Name and the Private Key');
      log.dim('  5. Run npx x402-bazaar init again with your keys');
      console.log('');

      if (!isInteractive()) {
        log.info('Continuing in read-only mode (non-interactive terminal).');
        walletMode = 'readonly';
      } else {
        const { proceed } = await promptOrDefault([{
          type: 'confirm',
          name: 'proceed',
          message: 'Continue in read-only mode for now?',
          default: true,
        }]);

        if (!proceed) {
          log.info('Run npx x402-bazaar init when you have your API keys.');
          process.exit(0);
        }
        walletMode = 'readonly';
      }
    }

    // Network & Budget — use CLI flags as overrides
    const configOverrides = {};
    if (options.network) configOverrides.network = options.network;
    if (options.budget) configOverrides.maxBudget = options.budget;

    const configAnswers = await promptOrDefault([
      {
        type: 'list',
        name: 'network',
        message: 'Which network?',
        choices: [
          { name: 'Base Mainnet (real USDC)', value: 'mainnet' },
          { name: 'Base Sepolia (testnet, free tokens for testing)', value: 'testnet' },
        ],
        default: 'mainnet',
      },
      {
        type: 'input',
        name: 'maxBudget',
        message: 'Max USDC budget per session (safety limit):',
        default: '1.00',
        validate: (v) => {
          const n = parseFloat(v);
          if (isNaN(n) || n <= 0) return 'Must be a positive number';
          if (n > 100) return 'Maximum is 100 USDC per session';
          return true;
        },
      },
    ], configOverrides);

    network = configAnswers.network;
    maxBudget = configAnswers.maxBudget;
    seedPath = join(installDir, 'agent-seed.json');
  }

  console.log('');

  // ─── Step 4: Generate Config ────────────────────────────────────────
  log.step(4, 'Generating configuration...');
  console.log('');

  const config = generateMcpConfig({
    environment: targetEnv.name,
    installDir,
    serverUrl,
    maxBudget,
    network,
    coinbaseApiKey,
    coinbaseApiSecret,
    seedPath,
    readOnly: walletMode === 'readonly',
  });

  // Write .env file in install dir
  if (walletMode !== 'readonly') {
    const envContent = generateEnvContent({
      serverUrl,
      maxBudget,
      network,
      coinbaseApiKey,
      coinbaseApiSecret,
      seedPath,
    });
    const envPath = join(installDir, '.env');
    writeFileSync(envPath, envContent);
    log.success(`.env created at ${chalk.dim(envPath)}`);
  }

  // Write or merge config into the AI client config file
  if (targetEnv.configPath) {
    const configWritten = writeConfig(targetEnv, config);
    if (configWritten) {
      log.success(`Config written to ${chalk.dim(targetEnv.configPath)}`);
    }
  } else {
    log.info('Generated MCP config — copy this into your client config:');
    console.log('');
    console.log(chalk.dim(JSON.stringify(config, null, 2)));
  }

  console.log('');

  // ─── Step 5: Verify Connection ──────────────────────────────────────
  log.step(5, 'Verifying connection to x402 Bazaar...');
  console.log('');

  const spinnerCheck = ora('Connecting to marketplace...').start();
  let serverOnline = false;
  let serviceCount = 0;

  try {
    const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    spinnerCheck.succeed(`Connected! Server is online (${data.network})`);
    serverOnline = true;
  } catch (err) {
    spinnerCheck.warn('Could not reach server');
    log.dim('  The server may be sleeping (Render free tier wakes up in ~30s).');
    log.dim('  Run: npx x402-bazaar status');
  }

  if (serverOnline) {
    try {
      const res = await fetch(serverUrl, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      serviceCount = data.total_services || 0;
      log.dim(`  Marketplace: ${data.name} — ${serviceCount} services available`);
    } catch {
      // silent
    }
  }

  console.log('');
  log.separator();

  // ─── Summary ────────────────────────────────────────────────────────
  console.log('');
  log.success(chalk.bold('Setup complete!'));
  console.log('');

  const restartMsg = {
    'claude-desktop': 'Restart Claude Desktop to activate the MCP server.',
    'cursor': 'Restart Cursor to activate the MCP server.',
    'claude-code': 'Restart Claude Code to activate the MCP server.',
  };

  const summaryLines = [
    `Environment:    ${targetEnv.label}`,
    `Install dir:    ${installDir}`,
    `Server:         ${serverUrl}`,
    `Network:        ${network === 'mainnet' ? 'Base Mainnet' : 'Base Sepolia'}`,
    `Budget limit:   ${maxBudget} USDC / session`,
    `Wallet:         ${walletMode === 'readonly' ? 'Read-only (no payments)' : 'Configured'}`,
    `Services:       ${serviceCount > 0 ? serviceCount + ' available' : 'check with npx x402-bazaar status'}`,
    '',
    restartMsg[targetEnv.name] || 'Configure your AI client with the generated JSON above.',
    '',
    'Then try asking your agent:',
    '  "Search for weather APIs on x402 Bazaar"',
    '  "List all available services on the marketplace"',
  ];

  log.box('What\'s next?', summaryLines.join('\n'));

  console.log('');
  log.dim('  Need help?   https://x402bazaar.org');
  log.dim('  Dashboard:   https://x402-api.onrender.com/dashboard');
  log.dim('  Re-configure: npx x402-bazaar init');
  console.log('');

  printNonInteractiveHint('init');
}

/**
 * Write config to the target AI client config file.
 * Merges with existing config if file already exists.
 */
function writeConfig(envInfo, newConfig) {
  try {
    const configPath = envInfo.configPath;
    const configDir = dirname(configPath);

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    let finalConfig = newConfig;

    if (existsSync(configPath)) {
      try {
        const existing = JSON.parse(readFileSync(configPath, 'utf-8'));

        if (envInfo.name === 'vscode-continue') {
          if (!existing.mcpServers) existing.mcpServers = [];
          const idx = existing.mcpServers.findIndex(s => s.name === 'x402-bazaar');
          if (idx >= 0) {
            existing.mcpServers[idx] = newConfig.mcpServers[0];
          } else {
            existing.mcpServers.push(newConfig.mcpServers[0]);
          }
          finalConfig = existing;
        } else {
          if (!existing.mcpServers) existing.mcpServers = {};
          existing.mcpServers['x402-bazaar'] = newConfig.mcpServers['x402-bazaar'];
          finalConfig = existing;
        }

        log.info('Merged with existing config file');
      } catch {
        log.warn('Could not parse existing config — creating new file');
      }
    }

    writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));
    return true;
  } catch (err) {
    log.error(`Could not write config: ${err.message}`);
    log.info('Copy this JSON manually into your config file:');
    console.log('');
    console.log(JSON.stringify(newConfig, null, 2));
    return false;
  }
}

/**
 * Generate a standalone MCP server file.
 * Used as fallback when the local x402-bazaar project is not found.
 */
function generateMcpServerFile() {
  return `import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Coinbase, Wallet } = require('@coinbase/coinbase-sdk');

// ─── Config ──────────────────────────────────────────────────────────
const SERVER_URL = process.env.X402_SERVER_URL || 'https://x402-api.onrender.com';
const MAX_BUDGET = parseFloat(process.env.MAX_BUDGET_USDC || '1.00');
const NETWORK = process.env.NETWORK || 'mainnet';
const explorerBase = NETWORK === 'testnet'
    ? 'https://sepolia.basescan.org'
    : 'https://basescan.org';
const networkLabel = NETWORK === 'testnet' ? 'Base Sepolia' : 'Base Mainnet';

// ─── Budget Tracking ─────────────────────────────────────────────────
let sessionSpending = 0;
const sessionPayments = [];

// ─── Wallet ──────────────────────────────────────────────────────────
let wallet = null;
let walletReady = false;

async function initWallet() {
    if (walletReady) return;

    Coinbase.configure({
        apiKeyName: process.env.COINBASE_API_KEY,
        privateKey: process.env.COINBASE_API_SECRET,
    });

    const seedPath = process.env.AGENT_SEED_PATH || 'agent-seed.json';
    const fs = await import('fs');
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    const seedWalletId = Object.keys(seedData)[0];

    wallet = await Wallet.fetch(seedWalletId);
    await wallet.loadSeed(seedPath);
    walletReady = true;
}

// ─── x402 Payment Flow ──────────────────────────────────────────────
async function payAndRequest(url, options = {}) {
    const res = await fetch(url, options);
    const body = await res.json();

    if (res.status !== 402) {
        return body;
    }

    // HTTP 402 — Payment Required
    const details = body.payment_details;
    const cost = parseFloat(details.amount);

    // Budget check
    if (sessionSpending + cost > MAX_BUDGET) {
        throw new Error(
            \`Budget limit reached. Spent: \${sessionSpending.toFixed(2)} USDC / \${MAX_BUDGET.toFixed(2)} USDC limit. \` +
            \`This call costs \${cost} USDC. Increase MAX_BUDGET_USDC env var to allow more spending.\`
        );
    }

    await initWallet();

    const transfer = await wallet.createTransfer({
        amount: details.amount,
        assetId: Coinbase.assets.Usdc,
        destination: details.recipient,
    });
    const confirmed = await transfer.wait({ timeoutSeconds: 120 });
    const txHash = confirmed.getTransactionHash();

    // Track spending
    sessionSpending += cost;
    sessionPayments.push({
        amount: cost,
        txHash,
        timestamp: new Date().toISOString(),
        endpoint: url.replace(SERVER_URL, ''),
    });

    // Retry with payment proof
    const retryHeaders = { ...options.headers, 'X-Payment-TxHash': txHash };
    const retryRes = await fetch(url, { ...options, headers: retryHeaders });
    const result = await retryRes.json();

    // Enrich result with payment info
    result._payment = {
        amount: details.amount,
        currency: 'USDC',
        txHash,
        explorer: \`\${explorerBase}/tx/\${txHash}\`,
        session_spent: sessionSpending.toFixed(2),
        session_remaining: (MAX_BUDGET - sessionSpending).toFixed(2),
    };

    return result;
}

// ─── MCP Server ─────────────────────────────────────────────────────
const server = new McpServer({
    name: 'x402-bazaar',
    version: '1.1.0',
});

// --- Tool: discover_marketplace (FREE) ---
server.tool(
    'discover_marketplace',
    'Discover the x402 Bazaar marketplace. Returns available endpoints, total services, and protocol info. Free — no payment needed.',
    {},
    async () => {
        try {
            const res = await fetch(SERVER_URL);
            const data = await res.json();
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: \`Error: \${err.message}\` }],
                isError: true,
            };
        }
    }
);

// --- Tool: search_services (0.05 USDC) ---
server.tool(
    'search_services',
    \`Search for API services on x402 Bazaar by keyword. Costs 0.05 USDC (paid automatically). Budget: \${MAX_BUDGET.toFixed(2)} USDC per session. Check get_budget_status before calling if unsure about remaining budget.\`,
    { query: z.string().describe('Search keyword (e.g. "weather", "crypto", "ai")') },
    async ({ query }) => {
        try {
            const result = await payAndRequest(
                \`\${SERVER_URL}/search?q=\${encodeURIComponent(query)}\`
            );
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: \`Error: \${err.message}\` }],
                isError: true,
            };
        }
    }
);

// --- Tool: list_services (0.05 USDC) ---
server.tool(
    'list_services',
    \`List all API services available on x402 Bazaar. Costs 0.05 USDC (paid automatically). Budget: \${MAX_BUDGET.toFixed(2)} USDC per session.\`,
    {},
    async () => {
        try {
            const result = await payAndRequest(\`\${SERVER_URL}/services\`);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: \`Error: \${err.message}\` }],
                isError: true,
            };
        }
    }
);

// --- Tool: find_tool_for_task (0.05 USDC — smart service lookup) ---
server.tool(
    'find_tool_for_task',
    \`Describe what you need in plain English and get the best matching API service ready to call. Returns the single best match with name, URL, price, and usage instructions. Costs 0.05 USDC. Budget: \${MAX_BUDGET.toFixed(2)} USDC per session.\`,
    { task: z.string().describe('What you need, in natural language (e.g. "get current weather for a city", "translate text to French")') },
    async ({ task }) => {
        try {
            const stopWords = new Set(['i', 'need', 'want', 'to', 'a', 'an', 'the', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'that', 'this', 'get', 'find', 'me', 'my', 'some', 'can', 'you', 'do', 'is', 'it', 'be', 'have', 'use', 'please', 'should', 'would', 'could']);
            const keywords = task.toLowerCase()
                .replace(/[^a-z0-9\\s]/g, '')
                .split(/\\s+/)
                .filter(w => w.length > 2 && !stopWords.has(w));
            const query = keywords.slice(0, 3).join(' ') || task.slice(0, 30);

            const result = await payAndRequest(
                \`\${SERVER_URL}/search?q=\${encodeURIComponent(query)}\`
            );

            const services = result.data || result.services || [];
            if (services.length === 0) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({
                        found: false,
                        query_used: query,
                        message: \`No services found matching "\${task}". Try rephrasing or use search_services with different keywords.\`,
                        _payment: result._payment,
                    }, null, 2) }],
                };
            }

            const best = services[0];
            return {
                content: [{ type: 'text', text: JSON.stringify({
                    found: true,
                    query_used: query,
                    service: {
                        name: best.name,
                        description: best.description,
                        url: best.url,
                        price_usdc: best.price_usdc,
                        tags: best.tags,
                    },
                    action: \`Call this API using call_api("\${best.url}"). \${Number(best.price_usdc) === 0 ? 'This API is free.' : \`This API costs \${best.price_usdc} USDC per call.\`}\`,
                    alternatives_count: services.length - 1,
                    _payment: result._payment,
                }, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: \`Error: \${err.message}\` }],
                isError: true,
            };
        }
    }
);

// --- Tool: call_api (FREE — calls external APIs) ---
server.tool(
    'call_api',
    'Call an external API URL and return the response. Use this to fetch real data from service URLs discovered on the marketplace. Free — no marketplace payment needed.',
    { url: z.string().url().describe('The full API URL to call') },
    async ({ url }) => {
        try {
            const res = await fetch(url);
            const text = await res.text();
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = { response: text.slice(0, 5000) };
            }
            return {
                content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: \`Error: \${err.message}\` }],
                isError: true,
            };
        }
    }
);

// --- Tool: get_wallet_balance (FREE) ---
server.tool(
    'get_wallet_balance',
    'Check the USDC balance of the agent wallet on-chain. Free.',
    {},
    async () => {
        try {
            await initWallet();
            const balance = await wallet.getBalance(Coinbase.assets.Usdc);
            const address = (await wallet.getDefaultAddress()).getId();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        address,
                        balance_usdc: balance.toString(),
                        network: networkLabel,
                        explorer: \`\${explorerBase}/address/\${address}\`,
                    }, null, 2),
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: \`Error: \${err.message}\` }],
                isError: true,
            };
        }
    }
);

// --- Tool: get_budget_status (FREE) ---
server.tool(
    'get_budget_status',
    'Check the session spending budget. Shows how much USDC has been spent, remaining budget, and a list of all payments made this session. Free — call this before paid requests to verify budget.',
    {},
    async () => {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    budget_limit: MAX_BUDGET.toFixed(2) + ' USDC',
                    spent: sessionSpending.toFixed(2) + ' USDC',
                    remaining: (MAX_BUDGET - sessionSpending).toFixed(2) + ' USDC',
                    payments_count: sessionPayments.length,
                    payments: sessionPayments,
                    network: networkLabel,
                }, null, 2),
            }],
        };
    }
);

// ─── Start ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
`;
}
