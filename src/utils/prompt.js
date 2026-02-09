import inquirer from 'inquirer';
import chalk from 'chalk';
import { log } from './logger.js';

/**
 * Returns true if the terminal supports interactive prompts.
 */
export function isInteractive() {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return Boolean(process.stdin.isTTY);
}

/**
 * Safe wrapper around inquirer.prompt().
 *
 * Interactive mode (TTY): behaves exactly like inquirer.prompt().
 * Non-interactive mode: resolves each question with its default value
 * and logs what was chosen.
 *
 * @param {Array} questions - inquirer question array
 * @param {Object} overrides - optional { questionName: value } to force
 * @returns {Promise<Object>} answers
 */
export async function promptOrDefault(questions, overrides = {}) {
  const questionList = Array.isArray(questions) ? questions : [questions];

  if (isInteractive()) {
    const remaining = questionList.filter(q => !(q.name in overrides));
    const answers = { ...overrides };
    if (remaining.length > 0) {
      const prompted = await inquirer.prompt(remaining);
      Object.assign(answers, prompted);
    }
    return answers;
  }

  // Non-interactive path
  const answers = {};

  for (const q of questionList) {
    if (q.name in overrides) {
      answers[q.name] = overrides[q.name];
      log.info(`${q.message} ${chalk.bold(overrides[q.name])} ${chalk.dim('(flag)')}`);
      continue;
    }

    let defaultVal = q.default;

    // For list prompts without explicit default, use first choice
    if (q.type === 'list' && q.choices && defaultVal === undefined) {
      const firstChoice = q.choices.find(c => c.value !== undefined);
      defaultVal = firstChoice ? firstChoice.value : undefined;
    }

    // For confirm prompts, default to true
    if (q.type === 'confirm' && defaultVal === undefined) {
      defaultVal = true;
    }

    if (defaultVal === undefined) {
      answers[q.name] = '';
      log.warn(`${q.message} ${chalk.dim('(skipped — use flags to provide)')}`);
      continue;
    }

    answers[q.name] = defaultVal;

    // Build human-readable label for list choices
    let displayVal = String(defaultVal);
    if (q.type === 'list' && q.choices) {
      const match = q.choices.find(c => c.value === defaultVal);
      if (match && match.name) {
        displayVal = match.name.replace(/\x1b\[[0-9;]*m/g, '');
      }
    }

    log.info(`${q.message} ${chalk.bold(displayVal)} ${chalk.dim('(auto)')}`);
  }

  return answers;
}

/**
 * Print a hint showing available flags for customization.
 * Only prints in non-interactive mode.
 */
export function printNonInteractiveHint(command = 'init') {
  if (isInteractive()) return;

  console.log('');
  log.info(chalk.yellow('Running in non-interactive mode (IDE terminal detected).'));
  log.info('To customize, use flags:');
  console.log('');

  if (command === 'init') {
    log.dim('  npx x402-bazaar init --env cursor');
    log.dim('  npx x402-bazaar init --network testnet --budget 5.00');
    log.dim('  npx x402-bazaar init --no-wallet');
  } else if (command === 'config') {
    log.dim('  npx x402-bazaar config --env cursor');
    log.dim('  npx x402-bazaar config --network testnet --budget 5.00');
  }

  console.log('');
  log.dim('  For full interactive setup, run in a standalone terminal.');
  console.log('');
}
