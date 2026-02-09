import chalk from 'chalk';

const ORANGE = '#FF9900';
const GREEN = '#34D399';
const RED = '#F87171';
const BLUE = '#60A5FA';
const GRAY = '#6B7280';

export const log = {
  brand: (text) => console.log(chalk.hex(ORANGE).bold(text)),

  info: (text) => console.log(chalk.hex(BLUE)('i') + ' ' + text),

  success: (text) => console.log(chalk.hex(GREEN)('✓') + ' ' + text),

  warn: (text) => console.log(chalk.hex('#FBBF24')('!') + ' ' + chalk.yellow(text)),

  error: (text) => console.log(chalk.hex(RED)('✗') + ' ' + chalk.red(text)),

  dim: (text) => console.log(chalk.hex(GRAY)(text)),

  step: (num, text) => console.log(
    chalk.hex(ORANGE).bold(`[${num}]`) + ' ' + text
  ),

  separator: () => console.log(chalk.hex(GRAY)('─'.repeat(50))),

  banner: () => {
    console.log('');
    console.log(chalk.hex(ORANGE).bold('  ╔═══════════════════════════════════════╗'));
    console.log(chalk.hex(ORANGE).bold('  ║') + chalk.white.bold('       x402 Bazaar — Setup CLI        ') + chalk.hex(ORANGE).bold('║'));
    console.log(chalk.hex(ORANGE).bold('  ║') + chalk.hex(GRAY)('   AI Agent Marketplace on Base L2    ') + chalk.hex(ORANGE).bold('║'));
    console.log(chalk.hex(ORANGE).bold('  ╚═══════════════════════════════════════╝'));
    console.log('');
  },

  json: (obj) => {
    const json = JSON.stringify(obj, null, 2);
    const highlighted = json
      .replace(/"([^"]+)":/g, chalk.hex(BLUE)('"$1"') + ':')
      .replace(/: "([^"]+)"/g, ': ' + chalk.hex(GREEN)('"$1"'));
    console.log(highlighted);
  },

  box: (title, content) => {
    const lines = content.split('\n');
    const maxLen = Math.max(title.length, ...lines.map(l => l.length)) + 4;
    const border = '─'.repeat(maxLen);

    console.log(chalk.hex(GRAY)('┌' + border + '┐'));
    console.log(chalk.hex(GRAY)('│') + ' ' + chalk.white.bold(title.padEnd(maxLen - 2)) + ' ' + chalk.hex(GRAY)('│'));
    console.log(chalk.hex(GRAY)('├' + border + '┤'));
    for (const line of lines) {
      console.log(chalk.hex(GRAY)('│') + ' ' + line.padEnd(maxLen - 2) + ' ' + chalk.hex(GRAY)('│'));
    }
    console.log(chalk.hex(GRAY)('└' + border + '┘'));
  },
};
