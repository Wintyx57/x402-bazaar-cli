import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

const BASE_RPC_URL = 'https://mainnet.base.org';
const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BALANCE_OF_SELECTOR = '0x70a08231';

export async function walletCommand(options) {
  log.banner();

  // Handle --setup: generate a new wallet
  if (options.setup) {
    await setupWallet();
    return;
  }

  if (!options.address) {
    log.info('Check USDC balance or generate a new wallet.');
    console.log('');
    log.dim('  Usage:');
    log.dim('    x402-bazaar wallet --address 0xYourAddress');
    log.dim('    x402-bazaar wallet --setup');
    console.log('');
    log.dim('  Examples:');
    log.dim('    x402-bazaar wallet --address 0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b');
    log.dim('    x402-bazaar wallet --setup  (generate a new wallet for auto-payment)');
    console.log('');
    return;
  }

  const address = options.address.trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    log.error('Invalid Ethereum address format');
    log.dim('  Expected: 0x followed by 40 hexadecimal characters');
    log.dim(`  Got: ${address}`);
    console.log('');
    process.exit(1);
  }

  log.info(`Checking wallet: ${chalk.bold(maskAddress(address))}`);
  console.log('');

  const spinner = ora('Fetching USDC balance from Base...').start();

  try {
    const paddedAddress = address.slice(2).padStart(64, '0');
    const data = BALANCE_OF_SELECTOR + paddedAddress;

    const rpcPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC_CONTRACT_BASE, data }, 'latest'],
    };

    const res = await fetch(BASE_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcPayload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const rpcResponse = await res.json();
    if (rpcResponse.error) throw new Error(rpcResponse.error.message || 'RPC error');
    if (!rpcResponse.result) throw new Error('No result from RPC');

    const balanceRaw = BigInt(rpcResponse.result);
    const balanceUsdc = Number(balanceRaw) / 1_000_000;

    spinner.succeed('Balance fetched');
    console.log('');
    log.separator();
    console.log('');

    log.info(`Address:  ${chalk.hex('#34D399')(maskAddress(address))}`);
    log.info(`Network:  ${chalk.hex('#0052FF').bold('Base Mainnet')} (Chain ID: 8453)`);
    log.info(`Balance:  ${chalk.cyan.bold(balanceUsdc.toFixed(6))} ${chalk.dim('USDC')}`);

    console.log('');
    log.separator();
    console.log('');
    log.dim(`  Explorer:  https://basescan.org/address/${address}`);

    if (balanceUsdc === 0) {
      console.log('');
      log.warn('This wallet has no USDC.');
      log.dim('  Send USDC on Base to this address to start using paid APIs.');
    } else if (balanceUsdc < 0.1) {
      console.log('');
      log.warn('Low balance — consider adding more USDC.');
      log.dim('  Most x402 Bazaar APIs cost $0.001-$0.05 per call.');
    } else {
      console.log('');
      log.success('Wallet is funded and ready!');
      const estimatedCalls = Math.floor(balanceUsdc / 0.005);
      log.dim(`  Estimated API calls: ~${estimatedCalls} (at avg $0.005/call)`);
    }
    console.log('');

  } catch (err) {
    spinner.fail('Failed to fetch balance');
    console.log('');

    if (err.name === 'AbortError') {
      log.error('Request timeout — Base RPC may be slow');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      log.error('Cannot connect to Base RPC');
    } else {
      log.error(err.message);
    }
    console.log('');
    process.exit(1);
  }
}

/**
 * Generate a new wallet and save to ~/.x402-bazaar/wallet.json
 */
async function setupWallet() {
  log.info('Generating a new wallet for x402 Bazaar auto-payment...');
  console.log('');

  const home = process.env.HOME || process.env.USERPROFILE;
  const dir = path.join(home, '.x402-bazaar');
  const walletPath = path.join(dir, 'wallet.json');

  // Check if wallet already exists
  if (fs.existsSync(walletPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
      if (existing.privateKey) {
        const { getAddressFromKey } = await import('../lib/payment.js');
        const address = getAddressFromKey(existing.privateKey.startsWith('0x') ? existing.privateKey : '0x' + existing.privateKey);
        console.log('');
        log.warn('A wallet already exists!');
        log.info(`Address: ${chalk.hex('#34D399')(address)}`);
        log.dim(`  File: ${walletPath}`);
        console.log('');
        log.dim('  To use a different wallet, delete the file and run --setup again.');
        log.dim('  To check balance: npx x402-bazaar wallet --address ' + address);
        console.log('');
        return;
      }
    } catch { /* ignore parse errors, will overwrite */ }
  }

  const spinner = ora('Generating cryptographic key pair...').start();

  try {
    const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Create directory
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save wallet (private key stored locally)
    fs.writeFileSync(walletPath, JSON.stringify({
      address: account.address,
      privateKey: privateKey,
      network: 'base',
      created: new Date().toISOString(),
    }, null, 2), 'utf-8');

    spinner.succeed('Wallet generated!');
    console.log('');
    log.separator();
    console.log('');

    log.info(`Address:     ${chalk.hex('#34D399').bold(account.address)}`);
    log.info(`Network:     ${chalk.hex('#0052FF').bold('Base Mainnet')}`);
    log.info(`Saved to:    ${chalk.dim(walletPath)}`);

    console.log('');
    log.separator();
    console.log('');

    log.info('Next steps:');
    console.log('');
    log.dim('  1. Fund this wallet with USDC on Base:');
    log.dim(`     Send USDC to ${chalk.hex('#34D399')(account.address)}`);
    log.dim('     + a tiny amount of ETH for gas (~$0.01)');
    console.log('');
    log.dim('  2. Call paid APIs automatically:');
    log.dim(`     ${chalk.cyan('npx x402-bazaar call /api/weather --param city=Paris')}`);
    log.dim('     (auto-payment will use your saved wallet)');
    console.log('');
    log.dim('  3. Or set the env variable for any tool:');
    log.dim(`     export X402_PRIVATE_KEY=${privateKey}`);
    console.log('');

    log.warn('Keep your private key safe! Anyone with it can spend your funds.');
    log.dim(`  Backup: ${walletPath}`);
    console.log('');

  } catch (err) {
    spinner.fail('Wallet generation failed');
    console.log('');
    log.error(err.message);
    console.log('');
    process.exit(1);
  }
}

function maskAddress(address) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
