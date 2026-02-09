import inquirer from 'inquirer';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import chalk from 'chalk';
import { log } from '../utils/logger.js';
import { isInteractive, promptOrDefault, printNonInteractiveHint } from '../utils/prompt.js';
import { detectEnvironment, getDefaultInstallDir } from '../detectors/environment.js';
import { generateMcpConfig } from '../generators/mcp-config.js';

export async function configCommand(options) {
  log.banner();
  log.info('MCP Configuration Generator');
  log.separator();

  // Detect or ask for environment
  let targetEnv = options.env;

  if (!targetEnv) {
    const environments = detectEnvironment();
    const detected = environments.filter(e => e.detected);

    const defaultEnv = detected.length > 0 ? detected[0].name : 'claude-desktop';

    const choices = [
      ...environments.map(e => ({
        name: `${e.label}${e.detected ? chalk.hex('#34D399')(' (detected)') : ''}`,
        value: e.name,
      })),
      { name: 'Generic (print JSON to stdout)', value: 'generic' },
    ];

    const { env } = await promptOrDefault([{
      type: 'list',
      name: 'env',
      message: 'Which environment do you want to configure?',
      choices,
      default: defaultEnv,
    }]);
    targetEnv = env;
  }

  // Config values — use CLI flags as overrides
  const configOverrides = {};
  if (options.serverUrl) configOverrides.serverUrl = options.serverUrl;
  if (options.budget) configOverrides.maxBudget = options.budget;
  if (options.network) configOverrides.network = options.network;

  const { serverUrl, maxBudget, network } = await promptOrDefault([
    {
      type: 'input',
      name: 'serverUrl',
      message: 'x402 Bazaar server URL:',
      default: 'https://x402-api.onrender.com',
    },
    {
      type: 'input',
      name: 'maxBudget',
      message: 'Max USDC budget per session:',
      default: '1.00',
    },
    {
      type: 'list',
      name: 'network',
      message: 'Network:',
      choices: [
        { name: 'Base Mainnet (real USDC)', value: 'mainnet' },
        { name: 'Base Sepolia (testnet)', value: 'testnet' },
      ],
      default: 'mainnet',
    },
  ], configOverrides);

  // Wallet config
  const { walletMode } = await promptOrDefault([{
    type: 'list',
    name: 'walletMode',
    message: 'Wallet configuration:',
    choices: [
      { name: 'I have Coinbase API keys', value: 'existing' },
      { name: 'Read-only mode (browse only, no payments)', value: 'readonly' },
    ],
    default: 'readonly',
  }]);

  let coinbaseApiKey = '';
  let coinbaseApiSecret = '';

  if (walletMode === 'existing') {
    if (!isInteractive()) {
      log.warn('Cannot enter API credentials in non-interactive mode.');
      log.info('Config will be generated in read-only mode.');
    } else {
      const walletAnswers = await promptOrDefault([
        {
          type: 'input',
          name: 'coinbaseApiKey',
          message: 'Coinbase API Key:',
          validate: (v) => v.length > 0 || 'API key is required',
        },
        {
          type: 'password',
          name: 'coinbaseApiSecret',
          message: 'Coinbase API Secret:',
          mask: '*',
          validate: (v) => v.length > 0 || 'API secret is required',
        },
      ]);
      coinbaseApiKey = walletAnswers.coinbaseApiKey;
      coinbaseApiSecret = walletAnswers.coinbaseApiSecret;
    }
  }

  const installDir = getDefaultInstallDir();

  // Generate config
  const config = generateMcpConfig({
    environment: targetEnv,
    installDir,
    serverUrl,
    maxBudget,
    network,
    coinbaseApiKey,
    coinbaseApiSecret,
    readOnly: walletMode === 'readonly' || (!isInteractive() && walletMode === 'existing'),
  });

  log.separator();
  log.success('Generated configuration:');
  console.log('');
  console.log(JSON.stringify(config, null, 2));
  console.log('');

  // Output
  const outputPath = options.output;

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(config, null, 2));
    log.success(`Config written to ${outputPath}`);
  } else {
    const environments = detectEnvironment();
    const envInfo = environments.find(e => e.name === targetEnv);
    if (envInfo) {
      log.info(`To apply, paste this into: ${chalk.bold(envInfo.configPath)}`);
    }
  }

  console.log('');

  printNonInteractiveHint('config');
}
