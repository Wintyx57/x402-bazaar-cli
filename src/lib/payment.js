import { createWalletClient, createPublicClient, http, parseUnits, encodeFunctionData } from 'viem';
import { base, polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'crypto';

const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
];

/** Minimum amount in micro-USDC (6 decimals) to allow a split payment. */
const MIN_SPLIT_AMOUNT_RAW = 100n; // 0.0001 USDC

/** USDC contract on Polygon mainnet (Circle native, 6 decimals). */
const POLYGON_USDC_CONTRACT = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

/**
 * Build viem wallet + public clients for Base mainnet.
 * @param {string} privateKey
 * @returns {{ walletClient, publicClient, account }}
 */
function buildClients(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const transport = http('https://mainnet.base.org');
  const walletClient = createWalletClient({ account, chain: base, transport });
  const publicClient = createPublicClient({ chain: base, transport });
  return { walletClient, publicClient, account };
}

/**
 * Build viem wallet + public clients for Polygon mainnet.
 * @param {string} privateKey
 * @returns {{ walletClient, publicClient, account }}
 */
function buildPolygonClients(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const transport = http('https://polygon-bor-rpc.publicnode.com');
  const walletClient = createWalletClient({ account, chain: polygon, transport });
  const publicClient = createPublicClient({ chain: polygon, transport });
  return { walletClient, publicClient, account };
}

/**
 * Sign an EIP-3009 TransferWithAuthorization off-chain (zero gas).
 * Used for Polygon facilitator payments.
 *
 * @param {object} walletClient - viem wallet client (Polygon chain)
 * @param {object} account - viem account
 * @param {string} amountRaw - amount as string (integer, 6 decimals)
 * @param {string} to - recipient address
 * @param {number} validAfter - unix timestamp (usually 0)
 * @param {number} validBefore - unix timestamp (5 min from now)
 * @returns {{ signature: string, authorization: object }}
 */
async function signEIP3009Auth(walletClient, account, amountRaw, to, validAfter, validBefore) {
  // Random bytes32 nonce (EIP-3009 uses random nonces, not sequential)
  const nonce = '0x' + randomBytes(32).toString('hex');

  const domain = {
    name: 'USD Coin',
    version: '2',
    chainId: 137,
    verifyingContract: POLYGON_USDC_CONTRACT,
  };

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

  const message = {
    from:        account.address,
    to,
    value:       BigInt(amountRaw),
    validAfter:  BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  return {
    signature,
    authorization: {
      from:        account.address,
      to,
      value:       amountRaw.toString(),
      validAfter:  validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}

/**
 * Pay via Polygon facilitator (EIP-3009, gas-free for the user).
 *
 * Flow:
 *   1. Sign EIP-3009 TransferWithAuthorization off-chain ($0 gas)
 *   2. POST to facilitator /settle — facilitator executes on-chain
 *   3. Return the txHash from the facilitator
 *
 * @param {string}  privateKey     - Hex private key (with 0x prefix)
 * @param {string}  facilitatorUrl - Base URL of the facilitator (e.g. https://x402.polygon.technology)
 * @param {object}  details        - Payment details from the 402 response body
 * @param {string}  details.amount    - Amount in USDC (e.g. "0.01")
 * @param {string}  details.recipient - Recipient address (FeeSplitter contract or platform wallet)
 * @param {string}  apiUrl         - Original API URL (used as resource in paymentRequirements)
 * @returns {string} txHash
 * @throws {Error} if the facilitator rejects the settlement
 */
export async function sendViaFacilitator(privateKey, facilitatorUrl, details, apiUrl) {
  const { walletClient, account } = buildPolygonClients(privateKey);

  const cost = parseFloat(details.amount);
  const amountRaw = BigInt(Math.round(cost * 1e6));

  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const recipient = details.recipient;

  // Step 1: Sign EIP-3009 TransferWithAuthorization off-chain (zero gas)
  const { signature, authorization } = await signEIP3009Auth(
    walletClient,
    account,
    amountRaw.toString(),
    recipient,
    validAfter,
    validBefore,
  );

  // Step 2: Build x402 paymentPayload (Version 1, exact scheme, EVM)
  const paymentPayload = {
    x402Version: 1,
    scheme:      'exact',
    network:     'polygon',
    payload:     { signature, authorization },
  };

  const paymentRequirements = {
    scheme:            'exact',
    network:           'polygon',
    maxAmountRequired: amountRaw.toString(),
    resource:          apiUrl,
    description:       'x402 Bazaar API payment',
    mimeType:          'application/json',
    payTo:             recipient,
    asset:             POLYGON_USDC_CONTRACT,
    maxTimeoutSeconds: 60,
  };

  // Step 3: POST to facilitator /settle
  const settleUrl = `${facilitatorUrl}/settle`;
  const settleRes = await fetch(settleUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    signal:  AbortSignal.timeout(30000),
  });

  const settleData = await settleRes.json();

  if (!settleData.success) {
    throw new Error(
      `Facilitator settlement failed: ${settleData.errorReason || 'unknown'} — ` +
      `${settleData.errorMessage || JSON.stringify(settleData)}`
    );
  }

  return settleData.transaction;
}

/**
 * Send a single USDC transfer on Base mainnet and wait for confirmation.
 * Caller is responsible for balance checks.
 *
 * @param {{ walletClient, publicClient }} clients
 * @param {string} toAddress
 * @param {bigint} amountRaw - amount in micro-USDC (6 decimals)
 * @returns {{ txHash: string, explorer: string }}
 */
async function sendUsdcRaw(clients, toAddress, amountRaw) {
  const { walletClient, publicClient } = clients;

  const txHash = await walletClient.writeContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [toAddress, amountRaw],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

  return {
    txHash,
    explorer: `https://basescan.org/tx/${txHash}`,
  };
}

/**
 * Send USDC payment on Base mainnet (legacy mode — 100% to one recipient).
 * @param {string} privateKey - Hex private key (with 0x prefix)
 * @param {string} toAddress - Recipient wallet address
 * @param {number} amountUsdc - Amount in USDC (e.g., 0.005)
 * @returns {{ txHash: string, explorer: string, from: string, amount: number }}
 */
export async function sendUsdcPayment(privateKey, toAddress, amountUsdc) {
  const { walletClient, publicClient, account } = buildClients(privateKey);

  // Convert USDC amount to 6-decimal units
  const amount = parseUnits(amountUsdc.toString(), 6);

  // Check balance first
  const balance = await publicClient.readContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (balance < amount) {
    const balanceUsdc = Number(balance) / 1_000_000;
    throw new Error(`Insufficient USDC balance: ${balanceUsdc.toFixed(6)} USDC (need ${amountUsdc} USDC)`);
  }

  const { txHash, explorer } = await sendUsdcRaw({ walletClient, publicClient }, toAddress, amount);

  return {
    txHash,
    explorer,
    from: account.address,
    amount: amountUsdc,
  };
}

/**
 * Send a split USDC payment on Base mainnet (native split mode — 95% to provider, 5% to platform).
 *
 * The split amounts are derived from the server-provided `split` object when available,
 * or computed with floor arithmetic to guarantee provider + platform = total exactly.
 *
 * @param {string} privateKey - Hex private key (with 0x prefix)
 * @param {object} splitDetails
 * @param {number} splitDetails.totalAmountUsdc        - Total price in USDC (e.g., 0.01)
 * @param {string} splitDetails.providerWallet         - Provider wallet address (95%)
 * @param {string} splitDetails.platformWallet         - Platform wallet address (5%)
 * @param {object|null} [splitDetails.serverSplit]     - Optional split object from server 402 response
 * @param {number} [splitDetails.serverSplit.provider_amount] - Provider amount in USDC from server
 * @param {number} [splitDetails.serverSplit.platform_amount] - Platform amount in USDC from server
 *
 * @returns {{
 *   txHashProvider: string,
 *   txHashPlatform: string,
 *   explorerProvider: string,
 *   explorerPlatform: string,
 *   from: string,
 *   providerAmountUsdc: number,
 *   platformAmountUsdc: number,
 * }}
 *
 * @throws {Error} If total amount is too small for a meaningful split (< 0.0001 USDC)
 * @throws {Error} If USDC balance is insufficient for the total amount
 */
export async function sendSplitUsdcPayment(privateKey, splitDetails) {
  const {
    totalAmountUsdc,
    providerWallet,
    platformWallet,
    serverSplit = null,
  } = splitDetails;

  const { walletClient, publicClient, account } = buildClients(privateKey);

  // Compute raw amounts (6 decimals).
  // Use server-provided amounts when present to avoid client/server rounding divergence.
  let providerAmountRaw;
  let platformAmountRaw;

  if (serverSplit && serverSplit.provider_amount != null && serverSplit.platform_amount != null) {
    providerAmountRaw = parseUnits(serverSplit.provider_amount.toString(), 6);
    platformAmountRaw = parseUnits(serverSplit.platform_amount.toString(), 6);
  } else {
    const totalRaw = parseUnits(totalAmountUsdc.toString(), 6);
    providerAmountRaw = (totalRaw * 95n) / 100n;      // floor division via BigInt
    platformAmountRaw = totalRaw - providerAmountRaw;  // guarantees sum = total
  }

  const totalRawForCheck = providerAmountRaw + platformAmountRaw;

  // Guard: minimum split amount
  if (providerAmountRaw < MIN_SPLIT_AMOUNT_RAW || platformAmountRaw === 0n) {
    throw new Error(
      `Amount too small for split payment (minimum 0.0001 USDC). ` +
      `Provider share would be ${Number(providerAmountRaw)} micro-USDC.`
    );
  }

  // Check balance for the full total
  const balance = await publicClient.readContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (balance < totalRawForCheck) {
    const balanceUsdc = Number(balance) / 1_000_000;
    const needUsdc = Number(totalRawForCheck) / 1_000_000;
    throw new Error(
      `Insufficient USDC balance: ${balanceUsdc.toFixed(6)} USDC (need ${needUsdc.toFixed(6)} USDC for split payment)`
    );
  }

  // Transaction 1 — provider (95%)
  const providerResult = await sendUsdcRaw(
    { walletClient, publicClient },
    providerWallet,
    providerAmountRaw
  );

  // Transaction 2 — platform (5%)
  const platformResult = await sendUsdcRaw(
    { walletClient, publicClient },
    platformWallet,
    platformAmountRaw
  );

  return {
    txHashProvider: providerResult.txHash,
    txHashPlatform: platformResult.txHash,
    explorerProvider: providerResult.explorer,
    explorerPlatform: platformResult.explorer,
    from: account.address,
    providerAmountUsdc: Number(providerAmountRaw) / 1_000_000,
    platformAmountUsdc: Number(platformAmountRaw) / 1_000_000,
  };
}

/**
 * Get the wallet address from a private key
 */
export function getAddressFromKey(privateKey) {
  const account = privateKeyToAccount(privateKey);
  return account.address;
}

/**
 * Get USDC balance for an address
 */
export async function getUsdcBalance(address) {
  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  const balance = await publicClient.readContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [address],
  });

  return Number(balance) / 1_000_000;
}
