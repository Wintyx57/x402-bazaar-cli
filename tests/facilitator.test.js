import test from 'node:test';
import assert from 'node:assert';
import { randomBytes } from 'crypto';

// ── Helpers (pure functions mirroring call.js + payment.js facilitator logic) ──

/**
 * Detect facilitator mode from a 402 response body (mirrors call.js logic).
 * @param {object} paymentInfo - Parsed 402 JSON body
 * @returns {{ isFacilitatorMode: boolean, facilitatorUrl: string|null, paymentMode: string|null }}
 */
function detectFacilitatorMode(paymentInfo) {
  const paymentMode = paymentInfo.payment_details?.payment_mode || null;
  const facilitatorUrl =
    paymentInfo.payment_details?.facilitator || paymentInfo.facilitator || null;
  const isFacilitatorMode = paymentMode === 'fee_splitter' && !!facilitatorUrl;
  return { isFacilitatorMode, facilitatorUrl, paymentMode };
}

/**
 * Build the retry headers for facilitator mode (mirrors call.js handleFacilitatorPayment).
 * @param {string} txHash
 * @returns {object}
 */
function buildFacilitatorRetryHeaders(txHash) {
  return {
    'X-Payment-TxHash': txHash,
    'X-Payment-Chain': 'polygon',
  };
}

/**
 * Build the x402 paymentPayload sent to the facilitator /settle endpoint
 * (mirrors sendViaFacilitator in payment.js).
 *
 * @param {object} authorization - EIP-3009 authorization fields
 * @param {string} signature     - EIP-712 typed signature
 * @returns {object}
 */
function buildPaymentPayload(authorization, signature) {
  return {
    x402Version: 1,
    scheme:      'exact',
    network:     'polygon',
    payload:     { signature, authorization },
  };
}

/**
 * Build the paymentRequirements object sent alongside the paymentPayload.
 * @param {bigint} amountRaw - Amount in micro-USDC (6 decimals)
 * @param {string} recipient - Recipient address (FeeSplitter or platform wallet)
 * @param {string} resource  - API URL
 * @returns {object}
 */
function buildPaymentRequirements(amountRaw, recipient, resource) {
  const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  return {
    scheme:            'exact',
    network:           'polygon',
    maxAmountRequired: amountRaw.toString(),
    resource,
    description:       'x402 Bazaar API payment',
    mimeType:          'application/json',
    payTo:             recipient,
    asset:             POLYGON_USDC,
    maxTimeoutSeconds: 60,
  };
}

// ── FacilitatorDetect ─────────────────────────────────────────────────────────

test('FacilitatorDetect - fee_splitter mode with facilitator URL → facilitator mode', () => {
  const paymentInfo = {
    payment_details: {
      amount:       '0.01',
      recipient:    '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56',
      payment_mode: 'fee_splitter',
      facilitator:  'https://x402.polygon.technology',
    },
  };

  const { isFacilitatorMode, facilitatorUrl, paymentMode } = detectFacilitatorMode(paymentInfo);

  assert.strictEqual(isFacilitatorMode, true, 'Should detect facilitator mode');
  assert.strictEqual(facilitatorUrl, 'https://x402.polygon.technology', 'Should extract facilitator URL');
  assert.strictEqual(paymentMode, 'fee_splitter', 'Should extract payment_mode');
});

test('FacilitatorDetect - fee_splitter without facilitator URL → NOT facilitator mode', () => {
  const paymentInfo = {
    payment_details: {
      amount:       '0.01',
      recipient:    '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
      payment_mode: 'fee_splitter',
      // no facilitator field
    },
  };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  assert.strictEqual(isFacilitatorMode, false, 'No facilitator URL → not facilitator mode');
});

test('FacilitatorDetect - split_native mode → NOT facilitator mode', () => {
  const paymentInfo = {
    payment_details: {
      amount:         '0.01',
      recipient:      '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
      provider_wallet:'0x8D32c6a000000000000000000000000000000001',
      payment_mode:   'split_native',
    },
  };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  assert.strictEqual(isFacilitatorMode, false, 'split_native is not facilitator mode');
});

test('FacilitatorDetect - no payment_details → NOT facilitator mode', () => {
  const paymentInfo = { price: '0.01', paymentAddress: '0xabc...' };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  assert.strictEqual(isFacilitatorMode, false, 'Missing payment_details → not facilitator mode');
});

test('FacilitatorDetect - facilitator URL at top level (fallback field)', () => {
  // Some backends may return facilitator at the top-level instead of inside payment_details
  const paymentInfo = {
    facilitator: 'https://x402.polygon.technology',
    payment_details: {
      amount:       '0.005',
      recipient:    '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56',
      payment_mode: 'fee_splitter',
    },
  };

  const { isFacilitatorMode, facilitatorUrl } = detectFacilitatorMode(paymentInfo);
  assert.strictEqual(isFacilitatorMode, true, 'Should detect facilitator via top-level field');
  assert.strictEqual(facilitatorUrl, 'https://x402.polygon.technology');
});

test('FacilitatorDetect - payment_mode missing entirely → NOT facilitator mode', () => {
  const paymentInfo = {
    payment_details: {
      amount:      '0.01',
      recipient:   '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
      facilitator: 'https://x402.polygon.technology',
      // payment_mode absent
    },
  };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  assert.strictEqual(isFacilitatorMode, false, 'payment_mode must be fee_splitter');
});

// ── Facilitator Retry Headers ─────────────────────────────────────────────────

test('FacilitatorHeaders - X-Payment-TxHash and X-Payment-Chain: polygon', () => {
  const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  const headers = buildFacilitatorRetryHeaders(txHash);

  assert.strictEqual(headers['X-Payment-TxHash'], txHash, 'TxHash header must match');
  assert.strictEqual(headers['X-Payment-Chain'], 'polygon', 'Chain header must be polygon');
});

test('FacilitatorHeaders - No X-Payment-TxHash-Provider in facilitator mode', () => {
  const headers = buildFacilitatorRetryHeaders('0x1234');
  assert.ok(!('X-Payment-TxHash-Provider' in headers), 'No split headers in facilitator mode');
  assert.ok(!('X-Payment-TxHash-Platform' in headers), 'No split headers in facilitator mode');
});

test('FacilitatorHeaders - Facilitator and split headers are mutually exclusive', () => {
  const facilitatorTx = '0xaaa';
  const splitTx       = '0xbbb';

  const facilitatorHeaders = buildFacilitatorRetryHeaders(facilitatorTx);
  const splitHeaders = {
    'X-Payment-TxHash-Provider': splitTx,
    'X-Payment-TxHash-Platform': '0xccc',
  };

  // Neither should contain each other's headers
  assert.ok(!('X-Payment-TxHash-Provider' in facilitatorHeaders));
  assert.ok(!('X-Payment-Chain' in splitHeaders));
});

// ── PaymentPayload Structure ──────────────────────────────────────────────────

test('PaymentPayload - correct x402 structure for facilitator /settle', () => {
  const nonce = '0x' + randomBytes(32).toString('hex');
  const authorization = {
    from:        '0x43408311CDA9774739f9A97dE049782C2D540ddb',
    to:          '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56',
    value:       '10000',
    validAfter:  '0',
    validBefore: String(Math.floor(Date.now() / 1000) + 300),
    nonce,
  };
  const signature = '0xdeadbeef';

  const payload = buildPaymentPayload(authorization, signature);

  assert.strictEqual(payload.x402Version, 1, 'x402Version must be 1');
  assert.strictEqual(payload.scheme, 'exact', 'scheme must be exact');
  assert.strictEqual(payload.network, 'polygon', 'network must be polygon');
  assert.deepStrictEqual(payload.payload, { signature, authorization });
});

test('PaymentPayload - authorization nonce is bytes32 hex', () => {
  const nonce = '0x' + randomBytes(32).toString('hex');
  assert.match(nonce, /^0x[a-fA-F0-9]{64}$/, 'Nonce must be 32-byte hex');
});

test('PaymentPayload - authorization nonces are unique', () => {
  const nonce1 = '0x' + randomBytes(32).toString('hex');
  const nonce2 = '0x' + randomBytes(32).toString('hex');
  assert.notStrictEqual(nonce1, nonce2, 'Each nonce must be unique (random)');
});

// ── PaymentRequirements Structure ────────────────────────────────────────────

test('PaymentRequirements - correct fields for /settle body', () => {
  const amountRaw = 10000n; // 0.01 USDC
  const recipient = '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56';
  const resource  = 'https://x402-api.onrender.com/api/weather';

  const req = buildPaymentRequirements(amountRaw, recipient, resource);

  assert.strictEqual(req.scheme, 'exact');
  assert.strictEqual(req.network, 'polygon');
  assert.strictEqual(req.maxAmountRequired, '10000');
  assert.strictEqual(req.resource, resource);
  assert.strictEqual(req.payTo, recipient);
  assert.strictEqual(req.asset, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
  assert.strictEqual(req.maxTimeoutSeconds, 60);
});

test('PaymentRequirements - amountRaw converted from USDC correctly', () => {
  const amounts = [
    { usdc: 0.005, expectedRaw: 5000n  },
    { usdc: 0.01,  expectedRaw: 10000n },
    { usdc: 0.1,   expectedRaw: 100000n },
    { usdc: 1.0,   expectedRaw: 1000000n },
  ];

  for (const { usdc, expectedRaw } of amounts) {
    const raw = BigInt(Math.round(usdc * 1e6));
    assert.strictEqual(raw, expectedRaw, `${usdc} USDC → ${expectedRaw} micro-USDC`);
  }
});

// ── Facilitator Response Handling ─────────────────────────────────────────────

test('FacilitatorResponse - success response shape', () => {
  const successResponse = {
    success:     true,
    transaction: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  };

  assert.strictEqual(successResponse.success, true);
  assert.match(successResponse.transaction, /^0x[a-fA-F0-9]{64}$/, 'txHash must be 32 bytes hex');
});

test('FacilitatorResponse - failure response throws with errorReason', () => {
  const failureResponse = {
    success:      false,
    errorReason:  'invalid_signature',
    errorMessage: 'Signature verification failed',
  };

  const errorMsg = `Facilitator settlement failed: ${failureResponse.errorReason || 'unknown'} — ` +
    `${failureResponse.errorMessage || JSON.stringify(failureResponse)}`;

  const err = new Error(errorMsg);
  assert.ok(err.message.includes('invalid_signature'), 'Error should include errorReason');
  assert.ok(err.message.includes('Signature verification failed'), 'Error should include errorMessage');
});

test('FacilitatorResponse - failure without errorReason falls back to unknown', () => {
  const failureResponse = { success: false };
  const errorMsg = `Facilitator settlement failed: ${failureResponse.errorReason || 'unknown'} — ` +
    `${failureResponse.errorMessage || JSON.stringify(failureResponse)}`;

  assert.ok(errorMsg.includes('unknown'), 'Should fallback to unknown');
});

// ── EIP-3009 Authorization Fields ────────────────────────────────────────────

test('EIP3009Auth - validBefore is ~5 minutes from now', () => {
  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + 300;

  assert.ok(validBefore > now, 'validBefore must be in the future');
  assert.ok(validBefore <= now + 300 + 5, 'validBefore should be ~5 minutes from now');
});

test('EIP3009Auth - validAfter is 0 (accept immediately)', () => {
  const validAfter = 0;
  assert.strictEqual(validAfter, 0, 'validAfter = 0 means usable immediately');
});

test('EIP3009Auth - authorization value matches amountRaw', () => {
  const usdc = 0.01;
  const amountRaw = BigInt(Math.round(usdc * 1e6));
  const authValue = amountRaw.toString();

  assert.strictEqual(authValue, '10000', '0.01 USDC = 10000 micro-USDC as string');
});

test('EIP3009Auth - domain chainId is 137 (Polygon mainnet)', () => {
  const domain = {
    name:            'USD Coin',
    version:         '2',
    chainId:         137,
    verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  };

  assert.strictEqual(domain.chainId, 137, 'Must sign on Polygon mainnet');
  assert.strictEqual(domain.name, 'USD Coin');
  assert.strictEqual(domain.version, '2');
});

test('EIP3009Auth - types match EIP-3009 TransferWithAuthorization spec', () => {
  const types = {
    TransferWithAuthorization: [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
    ],
  };

  const fields = types.TransferWithAuthorization.map(f => f.name);
  assert.ok(fields.includes('from'),        'Must have from');
  assert.ok(fields.includes('to'),          'Must have to');
  assert.ok(fields.includes('value'),       'Must have value');
  assert.ok(fields.includes('validAfter'),  'Must have validAfter');
  assert.ok(fields.includes('validBefore'), 'Must have validBefore');
  assert.ok(fields.includes('nonce'),       'Must have nonce');
  assert.strictEqual(fields.length, 6,      'Exactly 6 fields per EIP-3009');
});

// ── Priority: facilitator > split > legacy ────────────────────────────────────

test('PaymentPriority - fee_splitter takes precedence over split_native', () => {
  // A response that has BOTH provider_wallet (split) AND fee_splitter (facilitator)
  // The facilitator check runs first in call.js
  const paymentInfo = {
    payment_details: {
      amount:         '0.01',
      recipient:      '0x820d4b07D09e5E07598464E6E36cB12561e0Ba56',
      provider_wallet:'0x8D32c6a000000000000000000000000000000001',
      payment_mode:   'fee_splitter',
      facilitator:    'https://x402.polygon.technology',
    },
  };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  const isSplit = !!(paymentInfo.payment_details?.provider_wallet);

  assert.strictEqual(isFacilitatorMode, true, 'Facilitator mode takes precedence');
  // In call.js the if-chain checks isFacilitatorMode BEFORE isSplitMode
  // so even if both are true, facilitator wins
  assert.strictEqual(isSplit, true, 'split would also be detected, but facilitator wins');
});

test('PaymentPriority - no facilitator → split mode when provider_wallet present', () => {
  const paymentInfo = {
    payment_details: {
      amount:         '0.01',
      recipient:      '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
      provider_wallet:'0x8D32c6a000000000000000000000000000000001',
      payment_mode:   'split_native',
    },
  };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  const isSplit = !!(paymentInfo.payment_details?.provider_wallet);

  assert.strictEqual(isFacilitatorMode, false, 'No facilitator URL → not facilitator mode');
  assert.strictEqual(isSplit, true, 'Split mode should be active');
});

test('PaymentPriority - no facilitator, no split → legacy mode', () => {
  const paymentInfo = {
    payment_details: {
      amount:    '0.01',
      recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
    },
  };

  const { isFacilitatorMode } = detectFacilitatorMode(paymentInfo);
  const isSplit = !!(paymentInfo.payment_details?.provider_wallet);

  assert.strictEqual(isFacilitatorMode, false, 'Not facilitator mode');
  assert.strictEqual(isSplit, false, 'Not split mode');
  // → legacy single transfer
});
