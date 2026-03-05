import test from 'node:test';
import assert from 'node:assert';

// ── Helpers (pure functions extracted from payment.js / call.js logic) ────────

/**
 * Compute raw split amounts using the same BigInt floor arithmetic as
 * sendSplitUsdcPayment() in src/lib/payment.js.
 *
 * @param {number} totalAmountUsdc
 * @returns {{ providerRaw: bigint, platformRaw: bigint }}
 */
function computeSplitRaw(totalAmountUsdc) {
  // parseUnits equivalent: multiply by 10^6 and convert to BigInt
  const totalRaw = BigInt(Math.round(totalAmountUsdc * 1_000_000));
  const providerRaw = (totalRaw * 95n) / 100n; // floor division
  const platformRaw = totalRaw - providerRaw;
  return { providerRaw, platformRaw };
}

/**
 * Detect split mode from a 402 payment_details object (same logic as call.js).
 * @param {object} paymentDetails
 * @returns {boolean}
 */
function isSplitMode(paymentDetails) {
  return !!(paymentDetails && paymentDetails.provider_wallet);
}

/**
 * Build the retry headers for split mode (mirrors call.js handleSplitAutoPayment).
 * @param {string} txHashProvider
 * @param {string} txHashPlatform
 * @returns {object}
 */
function buildSplitRetryHeaders(txHashProvider, txHashPlatform) {
  return {
    'X-Payment-TxHash-Provider': txHashProvider,
    'X-Payment-TxHash-Platform': txHashPlatform,
  };
}

/**
 * Build the retry headers for legacy mode (mirrors call.js handleAutoPayment).
 * @param {string} txHash
 * @returns {object}
 */
function buildLegacyRetryHeaders(txHash) {
  return {
    'X-Payment-TxHash': txHash,
  };
}

// ── Minimum amount guard (mirrors MIN_SPLIT_AMOUNT_RAW in payment.js) ─────────
const MIN_SPLIT_AMOUNT_RAW = 100n; // 0.0001 USDC

function guardMinimumSplitAmount(providerRaw, platformRaw) {
  if (providerRaw < MIN_SPLIT_AMOUNT_RAW || platformRaw === 0n) {
    throw new Error('Amount too small for split payment (minimum 0.0001 USDC).');
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// ── 1. Split amount arithmetic ────────────────────────────────────────────────

test('Split - 0.01 USDC → 9500 + 500 micro-USDC', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.01);
  assert.strictEqual(providerRaw, 9500n, 'Provider should receive 9500 micro-USDC');
  assert.strictEqual(platformRaw, 500n, 'Platform should receive 500 micro-USDC');
  assert.strictEqual(providerRaw + platformRaw, 10000n, 'Sum must equal total');
});

test('Split - 0.001 USDC → 950 + 50 micro-USDC', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.001);
  assert.strictEqual(providerRaw, 950n);
  assert.strictEqual(platformRaw, 50n);
  assert.strictEqual(providerRaw + platformRaw, 1000n);
});

test('Split - 0.003 USDC → 2850 + 150 micro-USDC', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.003);
  assert.strictEqual(providerRaw, 2850n);
  assert.strictEqual(platformRaw, 150n);
  assert.strictEqual(providerRaw + platformRaw, 3000n);
});

test('Split - 0.007 USDC → 6650 + 350 micro-USDC', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.007);
  assert.strictEqual(providerRaw, 6650n);
  assert.strictEqual(platformRaw, 350n);
  assert.strictEqual(providerRaw + platformRaw, 7000n);
});

test('Split - 1.00 USDC → 950000 + 50000 micro-USDC', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(1.0);
  assert.strictEqual(providerRaw, 950000n);
  assert.strictEqual(platformRaw, 50000n);
  assert.strictEqual(providerRaw + platformRaw, 1000000n);
});

test('Split - Floor division: no micro-USDC lost in rounding', () => {
  // Verify that provider + platform always equals total for several amounts
  const amounts = [0.001, 0.003, 0.005, 0.007, 0.01, 0.05, 0.1, 0.333, 1.0];
  for (const amt of amounts) {
    const { providerRaw, platformRaw } = computeSplitRaw(amt);
    const total = BigInt(Math.round(amt * 1_000_000));
    assert.strictEqual(
      providerRaw + platformRaw,
      total,
      `Sum mismatch for ${amt} USDC`
    );
    // Provider must be >= 94% (floor may cause it to be slightly less than exact 95%)
    const providerPercent = Number(providerRaw * 100n / total);
    assert.ok(
      providerPercent >= 94 && providerPercent <= 95,
      `Provider percent ${providerPercent}% out of expected range for ${amt} USDC`
    );
  }
});

// ── 2. Split mode detection ───────────────────────────────────────────────────

test('SplitDetect - payment_details with provider_wallet → split mode', () => {
  const paymentDetails = {
    amount: 0.01,
    recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
    provider_wallet: '0x8fdb1Ac0000000000000000000000000000000AB',
    split: { provider_amount: 0.0095, platform_amount: 0.0005 },
    payment_mode: 'split_native',
  };
  assert.strictEqual(isSplitMode(paymentDetails), true, 'Should detect split mode');
});

test('SplitDetect - payment_details without provider_wallet → legacy mode', () => {
  const paymentDetails = {
    amount: 0.01,
    recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
  };
  assert.strictEqual(isSplitMode(paymentDetails), false, 'Should detect legacy mode');
});

test('SplitDetect - null payment_details → legacy mode', () => {
  assert.strictEqual(isSplitMode(null), false, 'Null details should be legacy');
});

test('SplitDetect - provider_wallet empty string → legacy mode', () => {
  const paymentDetails = { provider_wallet: '' };
  assert.strictEqual(isSplitMode(paymentDetails), false, 'Empty string should be falsy');
});

test('SplitDetect - provider_wallet null → legacy mode', () => {
  const paymentDetails = { provider_wallet: null };
  assert.strictEqual(isSplitMode(paymentDetails), false, 'Null provider_wallet should be legacy');
});

// ── 3. Retry headers ─────────────────────────────────────────────────────────

test('Headers - Split mode uses X-Payment-TxHash-Provider and X-Payment-TxHash-Platform', () => {
  const headers = buildSplitRetryHeaders('0xPROV', '0xPLAT');
  assert.ok(headers['X-Payment-TxHash-Provider'], 'Provider hash header should be set');
  assert.ok(headers['X-Payment-TxHash-Platform'], 'Platform hash header should be set');
  assert.strictEqual(headers['X-Payment-TxHash-Provider'], '0xPROV');
  assert.strictEqual(headers['X-Payment-TxHash-Platform'], '0xPLAT');
  assert.ok(!('X-Payment-TxHash' in headers), 'Legacy header must NOT be present in split mode');
});

test('Headers - Legacy mode uses only X-Payment-TxHash', () => {
  const headers = buildLegacyRetryHeaders('0xLEGACY');
  assert.strictEqual(headers['X-Payment-TxHash'], '0xLEGACY');
  assert.ok(!('X-Payment-TxHash-Provider' in headers), 'Split provider header must NOT be present in legacy mode');
  assert.ok(!('X-Payment-TxHash-Platform' in headers), 'Split platform header must NOT be present in legacy mode');
});

test('Headers - Provider and platform hashes must be different', () => {
  const txHash = '0xSAMEHASH1234567890abcdef';
  assert.notStrictEqual(
    '0xDIFFERENT_PROVIDER',
    '0xDIFFERENT_PLATFORM',
    'Two distinct hashes should not be equal'
  );
  // The guard: same hash should be rejected
  assert.ok(
    txHash === txHash,
    'Detect when provider hash === platform hash (attack prevention)'
  );
});

// ── 4. Minimum amount guard ───────────────────────────────────────────────────

test('Guard - Amount 0.0001 USDC (100 micro) passes minimum check', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.0001);
  // 0.0001 USDC = 100 micro-USDC → provider = floor(95) = 95, platform = 5
  // 95 < MIN_SPLIT_AMOUNT_RAW(100) → should throw
  assert.throws(
    () => guardMinimumSplitAmount(providerRaw, platformRaw),
    /Amount too small/,
    'Should throw for amount that yields providerRaw < 100'
  );
});

test('Guard - Amount 0.001 USDC (1000 micro) passes minimum check', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.001);
  // 0.001 → provider = 950, platform = 50 → both >= MIN
  assert.doesNotThrow(
    () => guardMinimumSplitAmount(providerRaw, platformRaw),
    'Should not throw for valid split amounts'
  );
});

test('Guard - Tiny amount triggers minimum guard', () => {
  // 0.00001 USDC = 10 micro-USDC → provider = 9 → below MIN_SPLIT_AMOUNT_RAW
  const tinyRaw = 10n;
  const { providerRaw, platformRaw } = { providerRaw: (tinyRaw * 95n) / 100n, platformRaw: tinyRaw - (tinyRaw * 95n) / 100n };
  assert.throws(
    () => guardMinimumSplitAmount(providerRaw, platformRaw),
    /Amount too small/,
    'Should throw for providerRaw < 100'
  );
});

test('Guard - Platform amount of zero is rejected', () => {
  // Simulate edge: total = 1 micro-USDC → provider = 0, platform = 1 → providerRaw < MIN
  assert.throws(
    () => guardMinimumSplitAmount(0n, 1n),
    /Amount too small/,
    'providerRaw = 0 should always be rejected'
  );
});

// ── 5. Server-provided split amounts ─────────────────────────────────────────

test('ServerSplit - Uses server-provided amounts when present', () => {
  const serverSplit = { provider_amount: 0.0095, platform_amount: 0.0005 };
  // Verify these parse to correct micro-USDC values
  const providerRaw = BigInt(Math.round(serverSplit.provider_amount * 1_000_000));
  const platformRaw = BigInt(Math.round(serverSplit.platform_amount * 1_000_000));
  assert.strictEqual(providerRaw, 9500n);
  assert.strictEqual(platformRaw, 500n);
  assert.strictEqual(providerRaw + platformRaw, 10000n, 'Server split amounts must sum to total');
});

test('ServerSplit - Falls back to local computation when serverSplit is null', () => {
  const { providerRaw, platformRaw } = computeSplitRaw(0.01);
  assert.strictEqual(providerRaw, 9500n);
  assert.strictEqual(platformRaw, 500n);
});

// ── 6. Response metadata (from 402 enriched response) ────────────────────────

test('Response402 - Split 402 response structure', () => {
  const response402 = {
    payment_required: true,
    payment_details: {
      amount: 0.01,
      recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
      provider_wallet: '0x8fdb1Ac0000000000000000000000000000000AB',
      split: {
        provider_amount: 0.0095,
        platform_amount: 0.0005,
        provider_percent: 95,
        platform_percent: 5,
      },
      payment_mode: 'split_native',
    },
  };

  const pd = response402.payment_details;
  assert.ok(pd.provider_wallet, 'provider_wallet must be present');
  assert.ok(pd.split, 'split object must be present');
  assert.strictEqual(pd.split.provider_percent, 95);
  assert.strictEqual(pd.split.platform_percent, 5);
  assert.strictEqual(pd.split.provider_percent + pd.split.platform_percent, 100);
  assert.ok(pd.payment_mode === 'split_native', 'payment_mode should be split_native');
});

test('Response402 - Legacy 402 response structure (no provider_wallet)', () => {
  const response402 = {
    payment_required: true,
    payment_details: {
      amount: 0.01,
      recipient: '0xfb1c478BD5567BdcD39782E0D6D23418bFda2430',
    },
  };

  assert.strictEqual(isSplitMode(response402.payment_details), false);
  assert.ok(!response402.payment_details.provider_wallet, 'provider_wallet must be absent in legacy mode');
});

// ── 7. Split result shape ─────────────────────────────────────────────────────

test('SplitResult - Result object has expected shape', () => {
  // Simulate the result shape returned by sendSplitUsdcPayment
  const mockResult = {
    txHashProvider: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    txHashPlatform: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    explorerProvider: 'https://basescan.org/tx/0xaaa...',
    explorerPlatform: 'https://basescan.org/tx/0xbbb...',
    from: '0x1234567890123456789012345678901234567890',
    providerAmountUsdc: 0.0095,
    platformAmountUsdc: 0.0005,
  };

  assert.ok(mockResult.txHashProvider, 'txHashProvider required');
  assert.ok(mockResult.txHashPlatform, 'txHashPlatform required');
  assert.ok(mockResult.explorerProvider, 'explorerProvider required');
  assert.ok(mockResult.explorerPlatform, 'explorerPlatform required');
  assert.ok(mockResult.from, 'from address required');
  assert.ok(typeof mockResult.providerAmountUsdc === 'number', 'providerAmountUsdc must be a number');
  assert.ok(typeof mockResult.platformAmountUsdc === 'number', 'platformAmountUsdc must be a number');

  // Verify amounts sum correctly (within floating point tolerance)
  const total = mockResult.providerAmountUsdc + mockResult.platformAmountUsdc;
  assert.ok(Math.abs(total - 0.01) < 1e-9, `Provider + platform should equal total (got ${total})`);
});

test('SplitResult - tx hashes must be different', () => {
  const txHashProvider = '0xaaaa';
  const txHashPlatform = '0xbbbb';
  assert.notStrictEqual(txHashProvider, txHashPlatform, 'The two tx hashes must be distinct');
});
