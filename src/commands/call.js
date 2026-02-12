import ora from 'ora';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

export async function callCommand(endpoint, options) {
  if (!endpoint || endpoint.trim().length === 0) {
    log.error('Endpoint is required');
    log.dim('  Usage: x402-bazaar call <endpoint> [--param key=value...]');
    log.dim('  Example: x402-bazaar call /api/weather --param city=Paris');
    log.dim('  Example: x402-bazaar call /api/search --param q="AI agents"');
    console.log('');
    process.exit(1);
  }

  const serverUrl = options.serverUrl || 'https://x402-api.onrender.com';

  // Normalize endpoint (add leading slash if missing)
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
      let value = valueParts.join('='); // rejoin in case value contains '='
      // Strip quotes if present
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

  // Build URL with query params (always use GET for marketplace APIs)
  let finalUrl = fullUrl;
  if (Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString();
    finalUrl = `${fullUrl}?${queryString}`;
  }

  const spinner = ora(`GET ${finalUrl}...`).start();

  try {
    const fetchOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    };

    const res = await fetch(finalUrl, fetchOptions);

    spinner.stop();

    // Handle 402 Payment Required
    if (res.status === 402) {
      console.log('');
      log.warn(chalk.bold('Payment Required (HTTP 402)'));
      console.log('');

      try {
        const paymentInfo = await res.json();

        if (paymentInfo.price) {
          log.info(`Price: ${chalk.cyan(`${paymentInfo.price} USDC`)}`);
        }
        if (paymentInfo.paymentAddress) {
          log.info(`Payment address: ${chalk.hex('#34D399')(paymentInfo.paymentAddress)}`);
        }
        if (paymentInfo.message) {
          log.dim(`  ${paymentInfo.message}`);
        }

        console.log('');
        log.separator();
        console.log('');
        log.info('To pay automatically, use the MCP server via Claude/Cursor.');
        log.dim('  The MCP server handles x402 payments transparently.');
        log.dim('  Install: npx x402-bazaar init');
        console.log('');

      } catch {
        log.dim('  This endpoint requires payment.');
        log.dim('  Use the MCP server for automatic payment handling.');
        console.log('');
      }
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
      } catch {
        // Ignore
      }

      console.log('');
      process.exit(1);
    }

    // Success
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

      // Pretty-print JSON with syntax highlighting
      const jsonString = JSON.stringify(responseData, null, 2);
      const highlighted = highlightJson(jsonString);
      console.log(highlighted);
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

  } catch (err) {
    spinner.fail('Request failed');
    console.log('');

    if (err.name === 'AbortError') {
      log.error('Request timeout (30s) — server may be slow or endpoint not responding');
      log.dim('  Try again or check status: npx x402-bazaar status');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      log.error('Cannot connect to server');
      log.dim(`  Server URL: ${serverUrl}`);
      log.dim('  Check your internet connection or try: npx x402-bazaar status');
    } else {
      log.error(err.message);
    }

    console.log('');
    process.exit(1);
  }
}

/**
 * Simple JSON syntax highlighting for terminal
 */
function highlightJson(jsonString) {
  return jsonString
    .replace(/"([^"]+)":/g, chalk.hex('#60A5FA')('"$1"') + ':')
    .replace(/: "([^"]+)"/g, ': ' + chalk.hex('#34D399')('"$1"'))
    .replace(/: (\d+\.?\d*)/g, ': ' + chalk.hex('#FBBF24')('$1'))
    .replace(/: (true|false)/g, ': ' + chalk.hex('#9333EA')('$1'))
    .replace(/: null/g, ': ' + chalk.hex('#6B7280')('null'));
}
