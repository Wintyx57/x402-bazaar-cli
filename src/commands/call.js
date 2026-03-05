import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

export async function callCommand(endpoint, options) {
  if (!endpoint || endpoint.trim().length === 0) {
    log.error('Endpoint is required');
    log.dim('  Usage: x402-bazaar call <endpoint> [--param key=value...]');
    log.dim('  Example: x402-bazaar call /api/weather --param city=Paris');
    log.dim('  Example: x402-bazaar call /api/hash --param text=hello --key 0x...');
    console.log('');
    process.exit(1);
  }

  const serverUrl = options.serverUrl || 'https://x402-api.onrender.com';
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${serverUrl}${normalizedEndpoint}`;

  log.banner();
  log.info(`Calling endpoint: ${chalk.bold(normalizedEndpoint)}`);
  console.log('');

  // Parse params
  const params = {};
  if (options.param) {
    const paramArray = Array.isArray(options.param) ? options.param : [options.param];
    for (const p of paramArray) {
      const [key, ...valueParts] = p.split('=');
      if (!key || valueParts.length === 0) {
        log.warn(`Invalid param format: ${p} (expected key=value)`);
        continue;
      }
      let value = valueParts.join('=');
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      params[key.trim()] = value;
    }
  }

  if (Object.keys(params).length > 0) {
    log.info('Parameters:');
    for (const [k, v] of Object.entries(params)) {
      log.dim(`  ${k}: ${v}`);
    }
    console.log('');
  }

  // Resolve private key for auto-payment
  const privateKey = resolvePrivateKey(options);
  const autoPay = !!privateKey;

  if (autoPay) {
    log.info(`Auto-payment: ${chalk.hex('#34D399').bold('enabled')}`);
    try {
      const { getAddressFromKey } = await import('../lib/payment.js');
      const address = getAddressFromKey(privateKey);
      log.dim(`  Wallet: ${address.slice(0, 6)}...${address.slice(-4)}`);
    } catch { /* ignore display errors */ }
    console.log('');
  }

  // Build URL with query params
  let finalUrl = fullUrl;
  if (Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString();
    finalUrl = `${fullUrl}?${queryString}`;
  }

  const spinner = ora(`GET ${finalUrl}...`).start();

  try {
    const fetchOptions = {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    };

    const res = await fetch(finalUrl, fetchOptions);
    spinner.stop();

    // Handle 402 Payment Required
    if (res.status === 402) {
      console.log('');
      log.warn(chalk.bold('Payment Required (HTTP 402)'));
      console.log('');

      let paymentInfo;
      try {
        paymentInfo = await res.json();
      } catch {
        log.error('Could not parse payment details');
        process.exit(1);
      }

      const price = paymentInfo.payment_details?.amount || paymentInfo.price;
      const payTo = paymentInfo.payment_details?.recipient || paymentInfo.payment_details?.walletAddress || paymentInfo.paymentAddress;

      // Split-native mode: provider_wallet is present in payment_details
      const providerWallet = paymentInfo.payment_details?.provider_wallet || null;
      const serverSplit = paymentInfo.payment_details?.split || null;
      const isSplitMode = !!(providerWallet);

      if (price) {
        log.info(`Price: ${chalk.cyan.bold(`${price} USDC`)}`);
      }
      if (isSplitMode) {
        log.dim(`  Mode: split native (95% provider / 5% platform)`);
        log.dim(`  Provider wallet: ${providerWallet}`);
        log.dim(`  Platform wallet: ${payTo}`);
      } else if (payTo) {
        log.dim(`  Pay to: ${payTo}`);
      }
      console.log('');

      // Auto-pay if key is available
      if (autoPay && price && payTo) {
        if (isSplitMode) {
          await handleSplitAutoPayment(
            privateKey, price, providerWallet, payTo, serverSplit, finalUrl, fetchOptions
          );
        } else {
          await handleAutoPayment(privateKey, payTo, price, finalUrl, fetchOptions);
        }
        return;
      }

      // No auto-pay — show instructions
      log.separator();
      console.log('');
      log.info('To pay automatically, provide your private key:');
      console.log('');
      log.dim('  Option 1: Environment variable (recommended)');
      log.dim('    export X402_PRIVATE_KEY=0xYourPrivateKey');
      log.dim('    npx x402-bazaar call /api/weather --param city=Paris');
      console.log('');
      log.dim('  Option 2: Generate a wallet file');
      log.dim('    npx x402-bazaar wallet --setup');
      console.log('');
      log.dim('  Option 3: --key flag (reads from wallet.json file)');
      log.dim('    npx x402-bazaar call /api/weather --param city=Paris --key ~/.x402-bazaar/wallet.json');
      console.log('');
      log.dim('  Option 4: Use the MCP server (via Claude/Cursor)');
      log.dim('    npx x402-bazaar init');
      console.log('');
      return;
    }

    // Handle other errors
    if (!res.ok) {
      console.log('');
      log.error(`HTTP ${res.status}: ${res.statusText}`);
      try {
        const errorBody = await res.text();
        if (errorBody) {
          console.log('');
          log.dim('Response:');
          console.log(chalk.red(errorBody));
        }
      } catch { /* ignore */ }
      console.log('');
      process.exit(1);
    }

    // Success
    await displayResponse(res);

  } catch (err) {
    spinner.fail('Request failed');
    console.log('');

    if (err.name === 'AbortError') {
      log.error('Request timeout (30s)');
      log.dim('  Try again or check status: npx x402-bazaar status');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      log.error('Cannot connect to server');
      log.dim(`  Server URL: ${serverUrl}`);
    } else {
      log.error(err.message);
    }

    console.log('');
    process.exit(1);
  }
}

/**
 * Resolve private key from: --key flag > X402_PRIVATE_KEY env > ~/.x402-bazaar/wallet.json
 */
function resolvePrivateKey(options) {
  if (options.key) {
    const raw = options.key.trim();
    // Warn if a raw private key is passed directly as CLI argument (visible in ps aux, shell history)
    const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      console.log('');
      console.warn(chalk.yellow('⚠️  Warning: Using --key on the command line exposes your private key in shell history.'));
      console.warn(chalk.yellow('⚠️  Prefer setting the X402_PRIVATE_KEY environment variable instead.'));
      console.log('');
    }
    return normalizeKey(options.key);
  }

  if (process.env.X402_PRIVATE_KEY) {
    return normalizeKey(process.env.X402_PRIVATE_KEY);
  }

  // Try local wallet file
  try {
    const home = process.env.HOME || process.env.USERPROFILE;
    const walletPath = path.join(home, '.x402-bazaar', 'wallet.json');
    if (fs.existsSync(walletPath)) {
      const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
      if (data.privateKey) {
        return normalizeKey(data.privateKey);
      }
    }
  } catch { /* ignore */ }

  return null;
}

function normalizeKey(key) {
  key = key.trim();
  if (!key.startsWith('0x')) key = '0x' + key;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) return null;
  return key;
}

/**
 * Handle split native payment (95% to provider, 5% to platform) and retry.
 *
 * On success the retry request carries two separate tx-hash headers:
 *   X-Payment-TxHash-Provider — hash of the 95% transfer to the provider
 *   X-Payment-TxHash-Platform — hash of the 5% transfer to the platform
 *
 * @param {string}      privateKey    - Agent private key (hex, with 0x)
 * @param {number}      totalPrice    - Full price in USDC
 * @param {string}      providerWallet - Provider wallet address (95% recipient)
 * @param {string}      platformWallet - Platform wallet address (5% recipient)
 * @param {object|null} serverSplit   - Optional split amounts from 402 payment_details.split
 * @param {string}      url           - API endpoint URL
 * @param {object}      fetchOptions  - Fetch options passed to the retry request
 */
async function handleSplitAutoPayment(
  privateKey, totalPrice, providerWallet, platformWallet, serverSplit, url, fetchOptions
) {
  const spinner = ora(
    `Sending ${totalPrice} USDC (split: 95% provider / 5% platform)...`
  ).start();

  try {
    const { sendSplitUsdcPayment } = await import('../lib/payment.js');

    const result = await sendSplitUsdcPayment(privateKey, {
      totalAmountUsdc: totalPrice,
      providerWallet,
      platformWallet,
      serverSplit,
    });

    spinner.succeed(
      `Split payment confirmed: ` +
      chalk.hex('#34D399').bold(`${result.providerAmountUsdc.toFixed(6)} USDC`) +
      ` to provider + ` +
      chalk.hex('#34D399').bold(`${result.platformAmountUsdc.toFixed(6)} USDC`) +
      ` to platform`
    );
    log.dim(`  Provider tx: ${result.explorerProvider}`);
    log.dim(`  Platform tx: ${result.explorerPlatform}`);
    console.log('');

    // Retry with both payment proofs
    const retrySpinner = ora('Retrying with split payment proof...').start();

    const retryRes = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        'X-Payment-TxHash-Provider': result.txHashProvider,
        'X-Payment-TxHash-Platform': result.txHashPlatform,
      },
    });

    retrySpinner.stop();

    if (!retryRes.ok) {
      console.log('');
      log.error(`HTTP ${retryRes.status}: ${retryRes.statusText}`);
      try {
        const body = await retryRes.text();
        if (body) console.log(chalk.red(body));
      } catch { /* ignore */ }
      console.log('');
      process.exit(1);
    }

    await displayResponse(retryRes);

  } catch (err) {
    spinner.fail('Split payment failed');
    console.log('');

    if (err.message.includes('Insufficient USDC')) {
      log.error(err.message);
      log.dim('  Fund your wallet with USDC on Base.');
      log.dim('  Check balance: npx x402-bazaar wallet --address <your-address>');
    } else if (err.message.includes('Amount too small')) {
      log.error(err.message);
      log.dim('  The service price is too low for a split payment (minimum 0.0001 USDC).');
    } else {
      log.error(err.message);
    }

    console.log('');
    process.exit(1);
  }
}

/**
 * Handle automatic x402 payment and retry
 */
async function handleAutoPayment(privateKey, payTo, price, url, fetchOptions) {
  const spinner = ora(`Sending ${price} USDC on Base mainnet...`).start();

  try {
    const { sendUsdcPayment } = await import('../lib/payment.js');
    const payment = await sendUsdcPayment(privateKey, payTo, price);

    spinner.succeed(`Payment confirmed: ${chalk.hex('#34D399').bold(`${price} USDC`)}`);
    log.dim(`  Tx: ${payment.explorer}`);
    console.log('');

    // Retry with payment proof
    const retrySpinner = ora('Retrying with payment proof...').start();

    const retryRes = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        'X-Payment-TxHash': payment.txHash,
      },
    });

    retrySpinner.stop();

    if (!retryRes.ok) {
      console.log('');
      log.error(`HTTP ${retryRes.status}: ${retryRes.statusText}`);
      try {
        const body = await retryRes.text();
        if (body) console.log(chalk.red(body));
      } catch { /* ignore */ }
      console.log('');
      process.exit(1);
    }

    await displayResponse(retryRes);

  } catch (err) {
    spinner.fail('Payment failed');
    console.log('');

    if (err.message.includes('Insufficient USDC')) {
      log.error(err.message);
      log.dim('  Fund your wallet with USDC on Base.');
      log.dim('  Check balance: npx x402-bazaar wallet --address <your-address>');
    } else {
      log.error(err.message);
    }

    console.log('');
    process.exit(1);
  }
}

/**
 * Display API response with JSON highlighting
 */
async function displayResponse(res) {
  console.log('');
  log.success(`${chalk.bold(res.status)} ${res.statusText}`);
  console.log('');

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const responseData = await res.json();
    log.separator();
    console.log('');
    log.info('Response (JSON):');
    console.log('');
    console.log(highlightJson(JSON.stringify(responseData, null, 2)));
    console.log('');
    log.separator();
  } else {
    const responseText = await res.text();
    log.separator();
    console.log('');
    log.info('Response:');
    console.log('');
    console.log(chalk.white(responseText));
    console.log('');
    log.separator();
  }
  console.log('');
}

function highlightJson(jsonString) {
  return jsonString
    .replace(/"([^"]+)":/g, chalk.hex('#60A5FA')('"$1"') + ':')
    .replace(/: "([^"]+)"/g, ': ' + chalk.hex('#34D399')('"$1"'))
    .replace(/: (\d+\.?\d*)/g, ': ' + chalk.hex('#FBBF24')('$1'))
    .replace(/: (true|false)/g, ': ' + chalk.hex('#9333EA')('$1'))
    .replace(/: null/g, ': ' + chalk.hex('#6B7280')('null'));
}
