import ora from 'ora';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const BASE_RPC_URL = 'https://mainnet.base.org';
const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BALANCE_OF_SELECTOR = '0x70a08231';

export async function walletCommand(options) {
  log.banner();

  if (!options.address) {
    log.info('Check USDC balance for any wallet address on Base.');
    console.log('');
    log.dim('  Usage:');
    log.dim('    x402-bazaar wallet --address 0xYourAddress');
    console.log('');
    log.dim('  Example:');
    log.dim('    x402-bazaar wallet --address 0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b');
    console.log('');
    log.dim('  To find your agent wallet address:');
    log.dim('    1. Run: npx x402-bazaar init');
    log.dim('    2. Or check your .env file: AGENT_PRIVATE_KEY');
    log.dim('    3. Or ask your AI agent: "What is my wallet address?"');
    console.log('');
    return;
  }

  const address = options.address.trim();

  // Validate address format
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
    // Encode balanceOf(address) call
    // balanceOf selector: 0x70a08231
    // Param: address (32 bytes, left-padded)
    const paddedAddress = address.slice(2).padStart(64, '0');
    const data = BALANCE_OF_SELECTOR + paddedAddress;

    // Make RPC call
    const rpcPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          to: USDC_CONTRACT_BASE,
          data: data,
        },
        'latest',
      ],
    };

    const res = await fetch(BASE_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcPayload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const rpcResponse = await res.json();

    if (rpcResponse.error) {
      throw new Error(rpcResponse.error.message || 'RPC error');
    }

    if (!rpcResponse.result) {
      throw new Error('No result from RPC');
    }

    // Parse balance (USDC has 6 decimals)
    const balanceHex = rpcResponse.result;
    const balanceRaw = BigInt(balanceHex);
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

    // Show explorer link
    log.dim(`  Explorer:  https://basescan.org/address/${address}`);

    // Helpful tips based on balance
    if (balanceUsdc === 0) {
      console.log('');
      log.warn('This wallet has no USDC.');
      log.dim('  To fund it:');
      log.dim('    1. Open MetaMask and switch to Base network');
      log.dim('    2. Send USDC to this address');
      log.dim('    3. Send a tiny amount of ETH for gas (~$0.01)');
      log.dim('  Get USDC: bridge from Ethereum or buy on Base DEX');
    } else if (balanceUsdc < 0.1) {
      console.log('');
      log.warn('Low balance — consider adding more USDC.');
      log.dim('  Most x402 Bazaar APIs cost $0.005-$0.05 per call.');
    } else {
      console.log('');
      log.success('Wallet is funded and ready!');
      const estimatedCalls = Math.floor(balanceUsdc / 0.02);
      log.dim(`  Estimated API calls: ~${estimatedCalls} (at avg $0.02/call)`);
    }

    console.log('');

  } catch (err) {
    spinner.fail('Failed to fetch balance');
    console.log('');

    if (err.name === 'AbortError') {
      log.error('Request timeout — Base RPC may be slow');
      log.dim('  Try again in a few seconds');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      log.error('Cannot connect to Base RPC');
      log.dim('  Check your internet connection');
    } else {
      log.error(err.message);
    }

    console.log('');
    process.exit(1);
  }
}

/**
 * Mask address for display: 0xabcd...1234
 */
function maskAddress(address) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
