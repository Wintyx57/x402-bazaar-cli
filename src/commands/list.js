import ora from 'ora';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const CATEGORIES = [
  'ai', 'data', 'automation', 'blockchain', 'weather', 'finance',
  'social', 'image', 'video', 'audio', 'search', 'translation', 'other'
];

export async function listCommand(options) {
  const serverUrl = options.serverUrl || 'https://x402-api.onrender.com';

  log.banner();
  log.info(`Fetching services from ${chalk.bold('x402 Bazaar')}`);
  console.log('');

  // Build query params
  const params = new URLSearchParams();
  if (options.chain) params.append('chain', options.chain);
  if (options.category) params.append('category', options.category);
  if (options.free) params.append('free', 'true');

  const url = `${serverUrl}/api/services${params.toString() ? '?' + params.toString() : ''}`;

  const spinner = ora('Loading services...').start();

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const services = data.services || data || [];

    spinner.succeed(`Found ${chalk.bold(services.length)} service${services.length !== 1 ? 's' : ''}`);
    console.log('');

    if (services.length === 0) {
      log.warn('No services found with these filters.');
      log.dim('  Try: x402-bazaar list --category ai');
      console.log('');
      return;
    }

    // Display services table
    log.separator();
    console.log('');

    services.forEach((service, idx) => {
      const name = service.name || service.title || 'Unnamed Service';
      const price = parseFloat(service.price || 0);
      const priceLabel = price === 0
        ? chalk.hex('#34D399').bold('FREE')
        : chalk.cyan(`$${price.toFixed(3)} USDC`);

      // Extract category from tags
      let category = 'other';
      if (service.tags && Array.isArray(service.tags)) {
        const realCategories = service.tags.filter(t => CATEGORIES.includes(t.toLowerCase()));
        if (realCategories.length > 0) {
          category = realCategories[0];
        }
      }

      const chain = service.chain || 'base';
      const chainLabel = chain === 'skale'
        ? chalk.hex('#9333EA')('SKALE')
        : chalk.hex('#0052FF')('Base');

      console.log(
        chalk.hex('#FF9900').bold(`${(idx + 1).toString().padStart(2, ' ')}. `) +
        chalk.white.bold(name)
      );
      console.log(`    ${priceLabel} ${chalk.dim('|')} ${chalk.hex('#60A5FA')(category)} ${chalk.dim('|')} ${chainLabel}`);

      if (service.description) {
        const desc = service.description.length > 80
          ? service.description.substring(0, 77) + '...'
          : service.description;
        console.log(`    ${chalk.hex('#6B7280')(desc)}`);
      }

      if (service.endpoint) {
        console.log(`    ${chalk.dim('Endpoint:')} ${chalk.hex('#FBBF24')(service.endpoint)}`);
      }

      console.log('');
    });

    log.separator();
    console.log('');
    log.info(`Total: ${chalk.bold(services.length)} service${services.length !== 1 ? 's' : ''}`);

    // Show filter info
    if (options.chain || options.category || options.free) {
      console.log('');
      log.dim('  Active filters:');
      if (options.chain) log.dim(`    Chain: ${options.chain}`);
      if (options.category) log.dim(`    Category: ${options.category}`);
      if (options.free) log.dim('    Price: free only');
      log.dim('  Run without options to see all services');
    }

    console.log('');

  } catch (err) {
    spinner.fail('Failed to fetch services');

    if (err.name === 'AbortError') {
      log.error('Request timeout — server may be sleeping (Render free tier)');
      log.dim('  Try again in 30 seconds or check status: npx x402-bazaar status');
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
