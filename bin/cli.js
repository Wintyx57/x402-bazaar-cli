#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { configCommand } from '../src/commands/config.js';
import { statusCommand } from '../src/commands/status.js';
import { listCommand } from '../src/commands/list.js';
import { searchCommand } from '../src/commands/search.js';
import { callCommand } from '../src/commands/call.js';
import { walletCommand } from '../src/commands/wallet.js';
import chalk from 'chalk';

// Global error handler
process.on('unhandledRejection', (err) => {
  console.error('');
  console.error(chalk.red('Error: ' + (err.message || err)));
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error(chalk.dim('  Run: npm install'));
  }
  process.exit(1);
});

const program = new Command();

program
  .name('x402-bazaar')
  .description(chalk.hex('#FF9900')('x402 Bazaar') + ' — Connect your AI agent to the marketplace in one command')
  .version('2.0.0');

program
  .command('init')
  .description('Set up x402 Bazaar MCP server (detect environment, configure wallet, generate config)')
  .option('--env <environment>', 'Force environment (claude-desktop, cursor, claude-code, vscode-continue, generic)')
  .option('--no-wallet', 'Skip wallet configuration (read-only mode)')
  .option('--server-url <url>', 'Custom server URL', 'https://x402-api.onrender.com')
  .option('--network <network>', 'Network: mainnet or testnet', 'mainnet')
  .option('--budget <amount>', 'Max USDC budget per session', '1.00')
  .action(initCommand);

program
  .command('config')
  .description('Generate MCP configuration file for your environment')
  .option('--env <environment>', 'Target environment (claude-desktop, cursor, claude-code, vscode-continue, generic)')
  .option('--output <path>', 'Output file path')
  .option('--server-url <url>', 'Custom server URL', 'https://x402-api.onrender.com')
  .option('--network <network>', 'Network: mainnet or testnet', 'mainnet')
  .option('--budget <amount>', 'Max USDC budget per session', '1.00')
  .action(configCommand);

program
  .command('status')
  .description('Check connection to x402 Bazaar marketplace')
  .option('--server-url <url>', 'Server URL to check', 'https://x402-api.onrender.com')
  .action(statusCommand);

program
  .command('list')
  .description('List all services on x402 Bazaar')
  .option('--chain <chain>', 'Filter by chain (base or skale)')
  .option('--category <category>', 'Filter by category (ai, data, weather, etc.)')
  .option('--free', 'Show only free services')
  .option('--server-url <url>', 'Server URL', 'https://x402-api.onrender.com')
  .action(listCommand);

program
  .command('search <query>')
  .description('Search for services by keyword')
  .option('--server-url <url>', 'Server URL', 'https://x402-api.onrender.com')
  .action(searchCommand);

program
  .command('call <endpoint>')
  .description('Call a marketplace endpoint (testing/debugging)')
  .option('--param <key=value>', 'Add parameter (can be used multiple times)', (value, previous) => {
    return previous ? [...previous, value] : [value];
  }, [])
  .option('--server-url <url>', 'Server URL', 'https://x402-api.onrender.com')
  .action(callCommand);

program
  .command('wallet')
  .description('Check USDC wallet balance on Base')
  .option('--address <address>', 'Ethereum address to check')
  .action(walletCommand);

// Default: show help if no command given
if (process.argv.length <= 2) {
  console.log('');
  console.log(chalk.hex('#FF9900').bold('  x402 Bazaar') + chalk.dim(' — AI Agent Marketplace CLI v2'));
  console.log('');
  console.log('  Setup commands:');
  console.log(chalk.cyan('    npx x402-bazaar init') + chalk.dim('          Full interactive setup'));
  console.log(chalk.cyan('    npx x402-bazaar config') + chalk.dim('        Generate MCP config'));
  console.log(chalk.cyan('    npx x402-bazaar status') + chalk.dim('        Check server connection'));
  console.log('');
  console.log('  Marketplace commands:');
  console.log(chalk.cyan('    npx x402-bazaar list') + chalk.dim('          Browse all services'));
  console.log(chalk.cyan('    npx x402-bazaar search <query>') + chalk.dim('  Find services by keyword'));
  console.log(chalk.cyan('    npx x402-bazaar call <endpoint>') + chalk.dim(' Test an API endpoint'));
  console.log(chalk.cyan('    npx x402-bazaar wallet') + chalk.dim('        Check wallet balance'));
  console.log('');
  console.log(chalk.dim('  Run any command with --help for detailed options'));
  console.log('');
  process.exit(0);
}

program.parse();
