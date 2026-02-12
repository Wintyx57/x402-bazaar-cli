#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { configCommand } from '../src/commands/config.js';
import { statusCommand } from '../src/commands/status.js';
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
  .version('1.2.2');

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

// Default: show help if no command given
if (process.argv.length <= 2) {
  console.log('');
  console.log(chalk.hex('#FF9900').bold('  x402 Bazaar') + chalk.dim(' — AI Agent Marketplace CLI'));
  console.log('');
  console.log('  Quick start:');
  console.log(chalk.cyan('    npx x402-bazaar init') + chalk.dim('      Full interactive setup'));
  console.log(chalk.cyan('    npx x402-bazaar status') + chalk.dim('    Check server connection'));
  console.log(chalk.cyan('    npx x402-bazaar config') + chalk.dim('    Generate MCP config'));
  console.log('');
  console.log(chalk.dim('  Run with --help for all options'));
  console.log('');
  process.exit(0);
}

program.parse();
