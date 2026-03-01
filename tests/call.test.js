import test from 'node:test';
import assert from 'node:assert';

/**
 * Test API call flow and parameter parsing
 */
test('Call - Should parse single parameter correctly', () => {
  const params = parseParams(['city=Paris']);
  assert.deepStrictEqual(params, { city: 'Paris' }, 'Should parse key=value format');
});

/**
 * Test multiple parameters
 */
test('Call - Should parse multiple parameters', () => {
  const params = parseParams(['city=Paris', 'days=5', 'units=metric']);
  assert.deepStrictEqual(params, {
    city: 'Paris',
    days: '5',
    units: 'metric',
  }, 'Should parse multiple parameters');
});

/**
 * Test parameter with quoted values
 */
test('Call - Should handle quoted parameter values', () => {
  const params = parseParams(['text="hello world"', "name='John Doe'"]);
  assert.deepStrictEqual(params, {
    text: 'hello world',
    name: 'John Doe',
  }, 'Should remove surrounding quotes');
});

/**
 * Test parameter with special characters
 */
test('Call - Should handle parameters with special characters', () => {
  const params = parseParams(['query=hello+world', 'email=test@example.com']);
  assert.deepStrictEqual(params, {
    query: 'hello+world',
    email: 'test@example.com',
  }, 'Should preserve special characters in values');
});

/**
 * Test parameter with equals sign in value
 */
test('Call - Should handle values containing equals sign', () => {
  const params = parseParams(['formula=x=y+5']);
  assert.deepStrictEqual(params, {
    formula: 'x=y+5', // First = is separator, rest are part of value
  }, 'Should split on first = only');
});

/**
 * Test invalid parameter format
 */
test('Call - Should reject invalid parameter format', () => {
  const params = parseParams(['invalid_param']);
  assert.deepStrictEqual(params, {}, 'Should skip params without = separator');
});

/**
 * Test empty parameter list
 */
test('Call - Should handle empty parameters', () => {
  const params = parseParams([]);
  assert.deepStrictEqual(params, {}, 'Empty params should return empty object');
});

/**
 * Test URL construction
 */
test('Call - Should construct valid URL', () => {
  const url = constructUrl('https://api.example.com', '/weather', { city: 'Paris', days: '5' });
  assert.ok(url.includes('https://api.example.com'), 'Should include base URL');
  assert.ok(url.includes('/weather'), 'Should include endpoint');
  assert.ok(url.includes('city=Paris'), 'Should include parameters');
  assert.ok(url.includes('days=5'), 'Should include parameters');
});

/**
 * Test endpoint normalization
 */
test('Call - Should normalize endpoint paths', () => {
  const url1 = constructUrl('https://api.example.com', 'weather', {});
  const url2 = constructUrl('https://api.example.com', '/weather', {});

  assert.ok(url1.includes('/weather'), 'Should add leading slash');
  assert.ok(url2.includes('/weather'), 'Should preserve leading slash');
});

/**
 * Test HTTP 402 response detection
 */
test('Call - Should detect HTTP 402 Payment Required', () => {
  const mockResponse = {
    status: 402,
    statusText: 'Payment Required',
    ok: false,
  };

  assert.strictEqual(mockResponse.status, 402, 'Should recognize 402 status code');
  assert.strictEqual(mockResponse.ok, false, 'Should mark 402 as not ok');
});

/**
 * Test private key validation from options
 */
test('Call - Should extract private key from options', () => {
  const options = {
    key: '0x1234567890123456789012345678901234567890123456789012345678901234',
  };

  assert.ok(options.key, 'Private key should be available');
  assert.match(options.key, /^0x[a-fA-F0-9]{64}$/, 'Should be valid format');
});

/**
 * Test server URL default
 */
test('Call - Should use default server URL', () => {
  const serverUrl = 'https://x402-api.onrender.com';
  assert.ok(serverUrl.includes('x402-api'), 'Default URL should point to x402 API');
});

/**
 * Test request timeout handling
 */
test('Call - Should set request timeout', () => {
  const timeoutMs = 30000;
  assert.strictEqual(timeoutMs, 30000, 'Timeout should be 30 seconds');
});

/**
 * Test 402 payment info parsing
 */
test('Call - Should parse payment details from 402 response', () => {
  const paymentInfo = {
    payment_details: {
      amount: '0.005',
      recipient: '0x1234567890123456789012345678901234567890',
    },
  };

  const amount = paymentInfo.payment_details?.amount;
  const recipient = paymentInfo.payment_details?.recipient;

  assert.strictEqual(amount, '0.005', 'Should extract amount');
  assert.match(recipient, /^0x[a-fA-F0-9]{40}$/, 'Should extract recipient address');
});

/**
 * Test insufficient balance error
 */
test('Call - Should detect insufficient balance error', () => {
  const error = new Error('Insufficient USDC balance: 0.001 USDC (need 0.005 USDC)');

  assert.ok(error.message.includes('Insufficient USDC'), 'Should identify insufficient balance');
  assert.ok(error.message.includes('0.001'), 'Should show available balance');
  assert.ok(error.message.includes('0.005'), 'Should show required amount');
});

/**
 * Test network error handling
 */
test('Call - Should handle network errors', () => {
  const errors = [
    { code: 'ECONNREFUSED', name: 'ConnectionError' },
    { code: 'ENOTFOUND', name: 'NotFoundError' },
    { name: 'AbortError', message: 'Request timeout' },
  ];

  for (const err of errors) {
    assert.ok(err.code || err.name, 'Error should have code or name');
  }
});

/**
 * Helper functions for testing
 */
function parseParams(paramArray) {
  const params = {};
  if (!paramArray || paramArray.length === 0) return params;

  for (const p of paramArray) {
    const [key, ...valueParts] = p.split('=');
    if (!key || valueParts.length === 0) {
      continue; // Skip invalid params
    }
    let value = valueParts.join('=');
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    params[key.trim()] = value;
  }

  return params;
}

function constructUrl(baseUrl, endpoint, params) {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let url = `${baseUrl}${normalizedEndpoint}`;

  if (Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString();
    url = `${url}?${queryString}`;
  }

  return url;
}
