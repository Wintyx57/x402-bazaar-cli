import test from 'node:test';
import assert from 'node:assert';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Test wallet generation and address derivation
 */
test('Wallet - Should derive address from private key', () => {
  const privateKey = '0x1234567890123456789012345678901234567890123456789012345678901234';
  const account = privateKeyToAccount(privateKey);

  assert.ok(account.address, 'Address should be derived');
  assert.match(account.address, /^0x[a-fA-F0-9]{40}$/, 'Address should be valid Ethereum format');
  assert.strictEqual(account.address.length, 42, 'Address should be 42 characters (0x + 40 hex)');
});

/**
 * Test private key validation
 */
test('Wallet - Should validate private key format', () => {
  const validKeys = [
    '0x1234567890123456789012345678901234567890123456789012345678901234',
    '1234567890123456789012345678901234567890123456789012345678901234',
  ];

  for (const key of validKeys) {
    const normalized = normalizePrivateKey(key);
    assert.ok(normalized, `Key ${key} should be valid`);
    assert.match(normalized, /^0x[a-fA-F0-9]{64}$/, 'Normalized key should have 0x prefix and 64 hex chars');
  }
});

/**
 * Test invalid private key rejection
 */
test('Wallet - Should reject invalid private key format', () => {
  const invalidKeys = [
    'not_a_key',
    '0x123',
    '0x' + 'g'.repeat(64),
    '',
    '0x' + 'g'.repeat(64), // 64 chars but with invalid hex char 'g'
    'hello_world',
  ];

  for (const key of invalidKeys) {
    const normalized = normalizePrivateKey(key);
    assert.strictEqual(normalized, null, `Invalid key "${key}" should return null`);
  }
});

/**
 * Test consistent address derivation
 */
test('Wallet - Should derive same address from same key consistently', () => {
  const privateKey = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const account1 = privateKeyToAccount(privateKey);
  const account2 = privateKeyToAccount(privateKey);

  assert.strictEqual(account1.address, account2.address, 'Same key should always derive same address');
});

/**
 * Test address masking (for safe display)
 */
test('Wallet - Should mask address for display', () => {
  const address = '0xA986540F0AaDFB5Ba5ceb2b1d81d90DBE479084b';
  const masked = maskAddress(address);

  assert.match(masked, /^0x[a-fA-F0-9]{4}\.\.\./, 'Masked address should start with 0x and first 4 hex chars');
  assert.match(masked, /\.\.\.[a-fA-F0-9]{4}$/, 'Masked address should end with last 4 hex chars');
  assert.ok(!masked.includes(address.slice(6, -4)), 'Middle part of address should be hidden');
});

/**
 * Helper functions for testing
 */
function normalizePrivateKey(key) {
  key = (key || '').trim();
  if (!key.startsWith('0x')) key = '0x' + key;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) return null;
  return key;
}

function maskAddress(address) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
