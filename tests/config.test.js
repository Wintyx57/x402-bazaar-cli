import test from 'node:test';
import assert from 'node:assert';

/**
 * Test MCP config generation for different platforms
 */
test('Config - Should generate valid Claude Desktop config', () => {
  const config = generateMcpConfig({
    environment: 'claude-desktop',
    serverUrl: 'https://x402-api.onrender.com',
    network: 'mainnet',
    budget: '1.00',
  });

  assert.ok(config.mcpServers, 'Config should have mcpServers');
  assert.ok(config.mcpServers['x402-bazaar'], 'Config should have x402-bazaar server');

  const server = config.mcpServers['x402-bazaar'];
  assert.strictEqual(server.command, 'node', 'Command should be node');
  assert.ok(server.args, 'Server should have args array');
  assert.ok(server.args.some(arg => arg.includes('x402-bazaar')), 'Args should include x402-bazaar');
});

/**
 * Test config for Cursor IDE
 */
test('Config - Should generate valid Cursor config', () => {
  const config = generateMcpConfig({
    environment: 'cursor',
    serverUrl: 'https://x402-api.onrender.com',
    network: 'mainnet',
    budget: '1.00',
  });

  assert.ok(config.mcpServers, 'Config should have mcpServers');
  assert.ok(config.mcpServers['x402-bazaar'], 'Config should have x402-bazaar server');
});

/**
 * Test config for Claude Code
 */
test('Config - Should generate valid Claude Code config', () => {
  const config = generateMcpConfig({
    environment: 'claude-code',
    serverUrl: 'https://x402-api.onrender.com',
    network: 'mainnet',
    budget: '1.00',
  });

  assert.ok(config.mcpServers, 'Config should have mcpServers');
  assert.ok(config.mcpServers['x402-bazaar'], 'Config should have x402-bazaar server');
});

/**
 * Test config with custom server URL
 */
test('Config - Should accept custom server URL', () => {
  const customUrl = 'https://custom.example.com';
  const config = generateMcpConfig({
    environment: 'claude-desktop',
    serverUrl: customUrl,
    network: 'mainnet',
    budget: '1.00',
  });

  const serverArgs = config.mcpServers['x402-bazaar'].args;
  assert.ok(serverArgs.some(arg => arg.includes(customUrl)), 'Config should contain custom server URL');
});

/**
 * Test config with testnet
 */
test('Config - Should support testnet network', () => {
  const config = generateMcpConfig({
    environment: 'claude-desktop',
    serverUrl: 'https://x402-api.onrender.com',
    network: 'testnet',
    budget: '1.00',
  });

  const serverArgs = config.mcpServers['x402-bazaar'].args;
  assert.ok(serverArgs.some(arg => arg.includes('testnet')), 'Config should include testnet flag');
});

/**
 * Test config with different budget
 */
test('Config - Should set custom budget', () => {
  const config = generateMcpConfig({
    environment: 'claude-desktop',
    serverUrl: 'https://x402-api.onrender.com',
    network: 'mainnet',
    budget: '10.50',
  });

  const serverArgs = config.mcpServers['x402-bazaar'].args;
  assert.ok(serverArgs.some(arg => arg.includes('10.50')), 'Config should include custom budget');
});

/**
 * Test config validation - invalid environment
 */
test('Config - Should validate environment', () => {
  assert.throws(() => {
    generateMcpConfig({
      environment: 'invalid-env',
      serverUrl: 'https://x402-api.onrender.com',
      network: 'mainnet',
      budget: '1.00',
    });
  }, /Invalid environment/, 'Should reject invalid environment');
});

/**
 * Test config validation - invalid network
 */
test('Config - Should validate network', () => {
  assert.throws(() => {
    generateMcpConfig({
      environment: 'claude-desktop',
      serverUrl: 'https://x402-api.onrender.com',
      network: 'invalid-network',
      budget: '1.00',
    });
  }, /Invalid network/, 'Should reject invalid network');
});

/**
 * Test config validation - invalid budget
 */
test('Config - Should validate budget format', () => {
  assert.throws(() => {
    generateMcpConfig({
      environment: 'claude-desktop',
      serverUrl: 'https://x402-api.onrender.com',
      network: 'mainnet',
      budget: 'not_a_number',
    });
  }, /Invalid budget/, 'Should reject non-numeric budget');
});

/**
 * Helper function to generate MCP config
 */
function generateMcpConfig(options) {
  const validEnvironments = ['claude-desktop', 'cursor', 'claude-code', 'vscode-continue', 'generic'];
  const validNetworks = ['mainnet', 'testnet'];

  if (!validEnvironments.includes(options.environment)) {
    throw new Error('Invalid environment');
  }

  if (!validNetworks.includes(options.network)) {
    throw new Error('Invalid network');
  }

  const budget = parseFloat(options.budget);
  if (isNaN(budget) || budget <= 0) {
    throw new Error('Invalid budget format');
  }

  const args = [
    'npx',
    'x402-bazaar',
    'mcp',
    '--server-url',
    options.serverUrl,
    '--network',
    options.network,
    '--budget',
    options.budget,
  ];

  return {
    mcpServers: {
      'x402-bazaar': {
        command: 'node',
        args: args,
      },
    },
  };
}
