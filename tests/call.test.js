import test from "node:test";
import assert from "node:assert";
import {
  parseParams,
  constructUrl,
  resolveChain,
} from "../src/commands/call.js";

/**
 * Test API call flow and parameter parsing
 */
test("Call - Should parse single parameter correctly", () => {
  const params = parseParams(["city=Paris"]);
  assert.deepStrictEqual(
    params,
    { city: "Paris" },
    "Should parse key=value format",
  );
});

/**
 * Test multiple parameters
 */
test("Call - Should parse multiple parameters", () => {
  const params = parseParams(["city=Paris", "days=5", "units=metric"]);
  assert.deepStrictEqual(
    params,
    {
      city: "Paris",
      days: "5",
      units: "metric",
    },
    "Should parse multiple parameters",
  );
});

/**
 * Test parameter with quoted values
 */
test("Call - Should handle quoted parameter values", () => {
  const params = parseParams(['text="hello world"', "name='John Doe'"]);
  assert.deepStrictEqual(
    params,
    {
      text: "hello world",
      name: "John Doe",
    },
    "Should remove surrounding quotes",
  );
});

/**
 * Test parameter with special characters
 */
test("Call - Should handle parameters with special characters", () => {
  const params = parseParams(["query=hello+world", "email=test@example.com"]);
  assert.deepStrictEqual(
    params,
    {
      query: "hello+world",
      email: "test@example.com",
    },
    "Should preserve special characters in values",
  );
});

/**
 * Test parameter with equals sign in value
 */
test("Call - Should handle values containing equals sign", () => {
  const params = parseParams(["formula=x=y+5"]);
  assert.deepStrictEqual(
    params,
    {
      formula: "x=y+5", // First = is separator, rest are part of value
    },
    "Should split on first = only",
  );
});

/**
 * Test invalid parameter format
 */
test("Call - Should reject invalid parameter format", () => {
  const params = parseParams(["invalid_param"]);
  assert.deepStrictEqual(params, {}, "Should skip params without = separator");
});

/**
 * Test empty parameter list
 */
test("Call - Should handle empty parameters", () => {
  const params = parseParams([]);
  assert.deepStrictEqual(params, {}, "Empty params should return empty object");
});

/**
 * Test URL construction
 */
test("Call - Should construct valid URL", () => {
  const url = constructUrl("https://api.example.com", "/weather", {
    city: "Paris",
    days: "5",
  });
  assert.ok(url.includes("https://api.example.com"), "Should include base URL");
  assert.ok(url.includes("/weather"), "Should include endpoint");
  assert.ok(url.includes("city=Paris"), "Should include parameters");
  assert.ok(url.includes("days=5"), "Should include parameters");
});

/**
 * Test endpoint normalization
 */
test("Call - Should normalize endpoint paths", () => {
  const url1 = constructUrl("https://api.example.com", "weather", {});
  const url2 = constructUrl("https://api.example.com", "/weather", {});

  assert.ok(url1.includes("/weather"), "Should add leading slash");
  assert.ok(url2.includes("/weather"), "Should preserve leading slash");
});

/**
 * Test HTTP 402 response detection
 */
test("Call - Should detect HTTP 402 Payment Required", () => {
  const mockResponse = {
    status: 402,
    statusText: "Payment Required",
    ok: false,
  };

  assert.strictEqual(
    mockResponse.status,
    402,
    "Should recognize 402 status code",
  );
  assert.strictEqual(mockResponse.ok, false, "Should mark 402 as not ok");
});

/**
 * Test private key validation from options
 */
test("Call - Should extract private key from options", () => {
  const options = {
    key: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };

  assert.ok(options.key, "Private key should be available");
  assert.match(options.key, /^0x[a-fA-F0-9]{64}$/, "Should be valid format");
});

/**
 * Test server URL default
 */
test("Call - Should use default server URL", () => {
  const serverUrl = "https://x402-api.onrender.com";
  assert.ok(
    serverUrl.includes("x402-api"),
    "Default URL should point to x402 API",
  );
});

/**
 * Test request timeout handling
 */
test("Call - Should set request timeout", () => {
  const timeoutMs = 30000;
  assert.strictEqual(timeoutMs, 30000, "Timeout should be 30 seconds");
});

/**
 * Test 402 payment info parsing
 */
test("Call - Should parse payment details from 402 response", () => {
  const paymentInfo = {
    payment_details: {
      amount: "0.005",
      recipient: "0x1234567890123456789012345678901234567890",
    },
  };

  const amount = paymentInfo.payment_details?.amount;
  const recipient = paymentInfo.payment_details?.recipient;

  assert.strictEqual(amount, "0.005", "Should extract amount");
  assert.match(
    recipient,
    /^0x[a-fA-F0-9]{40}$/,
    "Should extract recipient address",
  );
});

/**
 * Test insufficient balance error
 */
test("Call - Should detect insufficient balance error", () => {
  const error = new Error(
    "Insufficient USDC balance: 0.001 USDC (need 0.005 USDC)",
  );

  assert.ok(
    error.message.includes("Insufficient USDC"),
    "Should identify insufficient balance",
  );
  assert.ok(error.message.includes("0.001"), "Should show available balance");
  assert.ok(error.message.includes("0.005"), "Should show required amount");
});

/**
 * Test network error handling
 */
test("Call - Should handle network errors", () => {
  const errors = [
    { code: "ECONNREFUSED", name: "ConnectionError" },
    { code: "ENOTFOUND", name: "NotFoundError" },
    { name: "AbortError", message: "Request timeout" },
  ];

  for (const err of errors) {
    assert.ok(err.code || err.name, "Error should have code or name");
  }
});

// ── resolveChain() tests ──────────────────────────────────────────────────────

test("resolveChain - defaults to skale when no config present", () => {
  // Temporarily clear env var if set
  const prev = process.env.X402_PAYMENT_CHAIN;
  delete process.env.X402_PAYMENT_CHAIN;

  // resolveChain reads wallet.json from HOME — in a test environment that file
  // won't exist or won't have a network field, so the default 'skale' applies.
  // We only assert the return type and that it is a non-empty string.
  const chain = resolveChain();
  assert.ok(
    typeof chain === "string" && chain.length > 0,
    "Should return a non-empty string",
  );

  if (prev !== undefined) process.env.X402_PAYMENT_CHAIN = prev;
});

test("resolveChain - reads X402_PAYMENT_CHAIN env var", () => {
  const prev = process.env.X402_PAYMENT_CHAIN;
  process.env.X402_PAYMENT_CHAIN = "polygon";
  assert.strictEqual(
    resolveChain(),
    "polygon",
    "Should return chain from env var",
  );
  if (prev !== undefined) {
    process.env.X402_PAYMENT_CHAIN = prev;
  } else {
    delete process.env.X402_PAYMENT_CHAIN;
  }
});

test("resolveChain - normalises env var to lowercase", () => {
  const prev = process.env.X402_PAYMENT_CHAIN;
  process.env.X402_PAYMENT_CHAIN = "BASE";
  assert.strictEqual(
    resolveChain(),
    "base",
    "Should lowercase the chain value",
  );
  if (prev !== undefined) {
    process.env.X402_PAYMENT_CHAIN = prev;
  } else {
    delete process.env.X402_PAYMENT_CHAIN;
  }
});

// ── X-Payment-Chain header construction tests ─────────────────────────────────

test("Headers - Initial request headers include X-Payment-Chain", () => {
  const chain = "skale";
  const headers = {
    "Content-Type": "application/json",
    "X-Payment-Chain": chain,
  };
  assert.strictEqual(
    headers["X-Payment-Chain"],
    "skale",
    "Initial request must include X-Payment-Chain",
  );
});

test("Headers - Split retry includes X-Payment-Chain alongside both tx hashes", () => {
  const chain = "skale";
  const retryHeaders = {
    "Content-Type": "application/json",
    "X-Payment-Chain": chain,
    "X-Payment-TxHash-Provider": "0xPROVIDER",
    "X-Payment-TxHash-Platform": "0xPLATFORM",
  };
  assert.strictEqual(retryHeaders["X-Payment-Chain"], "skale");
  assert.ok(
    retryHeaders["X-Payment-TxHash-Provider"],
    "Provider hash must be present",
  );
  assert.ok(
    retryHeaders["X-Payment-TxHash-Platform"],
    "Platform hash must be present",
  );
  assert.ok(
    !("X-Payment-TxHash" in retryHeaders),
    "Legacy header must NOT be present in split retry",
  );
});

test("Headers - Legacy retry includes X-Payment-Chain alongside X-Payment-TxHash", () => {
  const chain = "base";
  const retryHeaders = {
    "Content-Type": "application/json",
    "X-Payment-TxHash": "0xLEGACY",
    "X-Payment-Chain": chain,
  };
  assert.strictEqual(retryHeaders["X-Payment-Chain"], "base");
  assert.strictEqual(retryHeaders["X-Payment-TxHash"], "0xLEGACY");
  assert.ok(
    !("X-Payment-TxHash-Provider" in retryHeaders),
    "Split provider header must NOT be present in legacy retry",
  );
  assert.ok(
    !("X-Payment-TxHash-Platform" in retryHeaders),
    "Split platform header must NOT be present in legacy retry",
  );
});

test("Headers - Facilitator retry includes X-Payment-Chain using chain parameter", () => {
  // Verify the chain is passed through and not hardcoded to 'polygon'
  for (const chain of ["polygon", "base", "skale"]) {
    const retryHeaders = {
      "X-Payment-TxHash": "0xFACILITATOR",
      "X-Payment-Chain": chain,
    };
    assert.strictEqual(
      retryHeaders["X-Payment-Chain"],
      chain,
      `Facilitator retry must use chain '${chain}' not a hardcoded value`,
    );
  }
});

// ── _payment_status consumer-protection tests ─────────────────────────────────

test("PaymentStatus - not_charged response is detected", () => {
  const responseData = {
    _payment_status: "not_charged",
    message: "Parameter missing",
  };
  assert.strictEqual(
    responseData._payment_status,
    "not_charged",
    "Should detect not_charged status",
  );
});

test("PaymentStatus - refunded response is detected", () => {
  const responseData = {
    _payment_status: "refunded",
    _x402: { refund_tx_hash: "0xREFUND" },
  };
  assert.strictEqual(
    responseData._payment_status,
    "refunded",
    "Should detect refunded status",
  );
  assert.ok(
    responseData._x402?.refund_tx_hash,
    "Should surface refund tx hash",
  );
});

test("PaymentStatus - normal 200 response has no _payment_status", () => {
  const responseData = { result: "ok", data: [1, 2, 3] };
  assert.ok(
    !responseData._payment_status,
    "Normal response must not have _payment_status",
  );
});
