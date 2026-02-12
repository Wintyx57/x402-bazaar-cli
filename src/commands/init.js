import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
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
      spinner.text = 'Downloading MCP server from GitHub...';
      try {
        const dlRes = await fetch('https://raw.githubusercontent.com/Wintyx57/x402-backend/main/mcp-server.mjs');
        if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`);
        writeFileSync(mcpServerDest, await dlRes.text());
      } catch (dlErr) {
        spinner.fail(`Could not download MCP server: ${dlErr.message}`);
        log.error('Download the file manually from:');
        log.dim('  https://github.com/Wintyx57/x402-backend/blob/main/mcp-server.mjs');
        log.dim(`  Save it to: ${mcpServerDest}`);
        process.exit(1);
      }
    }

    // Create package.json for the MCP server runtime
    const pkgJsonPath = join(installDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      writeFileSync(pkgJsonPath, JSON.stringify({
        name: 'x402-bazaar-mcp',
        version: '2.0.0',
        type: 'module',
        private: true,
        dependencies: {
          'viem': '^2.0.0',
          '@modelcontextprotocol/sdk': '^1.26.0',
          'dotenv': '^17.2.4',
          'zod': '^4.3.6',
          'ed2curve': '^0.3.0',
          '@scure/bip32': '^1.6.0',
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

  // ─── Step 3: Network & Wallet Configuration ────────────────────────
  log.step(3, 'Configuring network and wallet...');
  console.log('');

  let walletMode = 'readonly';
  let agentPrivateKey = '';
  let coinbaseApiKey = '';
  let coinbaseApiSecret = '';
  let maxBudget = '1.00';
  let network = 'mainnet';
  let serverUrl = options.serverUrl || 'https://x402-api.onrender.com';

  if (options.wallet === false) {
    log.info('Skipping wallet setup (--no-wallet)');
    walletMode = 'readonly';
  } else {
    // Network & Budget first — needed for wallet funding instructions
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
          { name: 'SKALE Europa (zero gas fees — advanced users)', value: 'skale' },
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

    console.log('');

    const { mode } = await promptOrDefault([{
      type: 'list',
      name: 'mode',
      message: 'How do you want to configure payments?',
      choices: [
        {
          name: `${chalk.bold('Generate a new wallet')} — Creates a fresh Ethereum wallet automatically (Recommended)`,
          value: 'generate',
        },
        {
          name: `${chalk.bold('Import private key')} — Use an existing Ethereum private key`,
          value: 'import',
        },
        {
          name: `${chalk.bold('Coinbase API keys')} — Legacy: use Coinbase CDP seed file`,
          value: 'coinbase',
        },
        {
          name: `${chalk.bold('Read-only mode')} — Browse marketplace for free (no payments)`,
          value: 'readonly',
        },
      ],
      default: 'generate',
    }]);

    walletMode = mode;

    if (mode === 'generate') {
      agentPrivateKey = '0x' + randomBytes(32).toString('hex');
      log.success('New wallet generated!');

      // Derive address using viem (installed in step 2)
      let walletAddress = '';
      try {
        walletAddress = execSync(
          `node --input-type=module -e "import{privateKeyToAccount}from'viem/accounts';console.log(privateKeyToAccount('${agentPrivateKey}').address)"`,
          { cwd: installDir, stdio: 'pipe', timeout: 15000 }
        ).toString().trim();
        console.log('');
        log.info(`Wallet address: ${chalk.bold(walletAddress)}`);
        if (network === 'skale') {
          log.dim(`  Explorer: https://elated-tan-skat.explorer.mainnet.skalenodes.com/address/${walletAddress}`);
        } else {
          log.dim(`  BaseScan: https://basescan.org/address/${walletAddress}`);
        }
        console.log('');
        log.separator();
        if (network === 'skale') {
          log.info(chalk.bold('To activate payments, fund this wallet:'));
          console.log('');
          log.dim(`  ${chalk.white('1.')} Bridge USDC to SKALE Europa`);
          log.dim(`     (Use https://portal.skale.space/bridge or any SKALE bridge)`);
          log.dim(`  ${chalk.white('2.')} Send ${chalk.bold('USDC')} to: ${chalk.hex('#34D399')(walletAddress)}`);
          log.dim(`     (Even $1 USDC is enough — each API call costs $0.005-$0.05)`);
          log.dim(`  ${chalk.white('3.')} Get free sFUEL for gas at https://www.sfuelstation.com/`);
          log.dim(`     (sFUEL is free — no ETH needed on SKALE!)`);
          console.log('');
          log.warn(`IMPORTANT: Send USDC on ${chalk.bold('SKALE Europa')} only — not Base or Ethereum!`);
        } else {
          log.info(chalk.bold('To activate payments, fund this wallet from MetaMask:'));
          console.log('');
          log.dim(`  ${chalk.white('1.')} Open MetaMask and switch to the ${chalk.bold('Base')} network`);
          log.dim(`     (Chain ID: 8453 — add it via https://chainlist.org/chain/8453)`);
          log.dim(`  ${chalk.white('2.')} Send ${chalk.bold('USDC')} to: ${chalk.hex('#34D399')(walletAddress)}`);
          log.dim(`     (Even $1 USDC is enough to start — each API call costs $0.005-$0.05)`);
          log.dim(`  ${chalk.white('3.')} Send a tiny bit of ${chalk.bold('ETH')} to the same address for gas`);
          log.dim(`     (${chalk.white('~$0.01 of ETH on Base')} is enough for hundreds of transactions)`);
          console.log('');
          log.warn(`IMPORTANT: Send on the ${chalk.bold('Base')} network only — not Ethereum mainnet!`);
        }
        log.separator();
      } catch {
        log.info('Wallet address will be shown when you first use the MCP server.');
        log.dim('  Use the get_wallet_balance tool to see your address.');
      }
    }

    if (mode === 'import') {
      if (!isInteractive()) {
        log.warn('Cannot enter private key in a non-interactive terminal.');
        log.info('Set AGENT_PRIVATE_KEY in your .env file manually after setup.');
        walletMode = 'readonly';
      } else {
        const { key } = await promptOrDefault([{
          type: 'password',
          name: 'key',
          message: 'Ethereum private key (0x...):',
          mask: '*',
          validate: (v) => {
            const trimmed = v.trim();
            if (trimmed.length === 0) return 'Private key is required';
            const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
            if (!/^[0-9a-fA-F]{64}$/.test(hex)) return 'Invalid private key (expected 64 hex characters)';
            return true;
          },
        }]);
        agentPrivateKey = key.trim().startsWith('0x') ? key.trim() : `0x${key.trim()}`;
        log.success('Private key imported.');
      }
    }

    if (mode === 'coinbase') {
      if (!isInteractive()) {
        log.warn('Cannot enter API credentials in a non-interactive terminal.');
        log.info('Falling back to read-only mode.');
        walletMode = 'readonly';
      } else {
        log.dim('  Legacy mode: requires Coinbase CDP API keys + agent-seed.json');
        console.log('');
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

        const existingSeed = join(installDir, 'agent-seed.json');
        if (!existsSync(existingSeed)) {
          log.warn('No agent-seed.json found.');
          log.dim('  Copy your existing agent-seed.json to: ' + installDir);
          log.dim('  Or re-run init and choose "Generate a new wallet" instead.');
        }
      }
    }
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
    agentPrivateKey,
    coinbaseApiKey,
    coinbaseApiSecret,
    readOnly: walletMode === 'readonly',
  });

  // Write .env file in install dir
  if (walletMode !== 'readonly') {
    const envContent = generateEnvContent({
      serverUrl,
      maxBudget,
      network,
      agentPrivateKey,
      coinbaseApiKey,
      coinbaseApiSecret,
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

  const walletLabel = walletMode === 'readonly'
    ? 'Read-only (no payments)'
    : walletMode === 'generate'
      ? 'New wallet (needs funding)'
      : 'Configured';

  const summaryLines = [
    `Environment:    ${targetEnv.label}`,
    `Install dir:    ${installDir}`,
    `Server:         ${serverUrl}`,
    `Network:        ${network === 'mainnet' ? 'Base Mainnet' : network === 'skale' ? 'SKALE Europa' : 'Base Sepolia'}`,
    `Budget limit:   ${maxBudget} USDC / session`,
    `Wallet:         ${walletLabel}`,
    `Services:       ${serviceCount > 0 ? serviceCount + ' available' : 'check with npx x402-bazaar status'}`,
    '',
    restartMsg[targetEnv.name] || 'Configure your AI client with the generated JSON above.',
    '',
    ...(walletMode === 'generate' ? [
      'Before your agent can pay for APIs:',
      network === 'skale'
        ? '  1. Bridge USDC to your wallet on SKALE Europa + get free sFUEL'
        : '  1. Send USDC + a little ETH to your wallet on Base',
      '  2. Restart your IDE',
      '',
    ] : []),
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

