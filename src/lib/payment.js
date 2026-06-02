import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  encodeFunctionData,
} from "viem";
import { base, polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";

const USDC_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];

/** Minimum amount in micro-USDC (6 decimals) to allow a split payment. */
const MIN_SPLIT_AMOUNT_RAW = 100n; // 0.0001 USDC

/**
 * Per-chain configuration: USDC contract address, block explorer URL, and
 * required confirmation count. Add new chains here — callers use CHAIN_CONFIGS
 * instead of hardcoded constants so the map is the single source of truth.
 */
export const CHAIN_CONFIGS = {
  base: {
    usdcContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org",
    rpc: "https://mainnet.base.org",
    confirmations: 1,
  },
  skale: {
    usdcContract: "0x85889c8c714505E0c94b30fcfcF64fE3Ac8FCb20",
    explorer: "https://skale-base-explorer.skalenodes.com",
    rpc: "https://skale-base.skalenodes.com/v1/base",
    confirmations: 1,
  },
  polygon: {
    usdcContract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    explorer: "https://polygonscan.com",
    rpc: "https://polygon-bor-rpc.publicnode.com",
    confirmations: 1,
  },
};

/**
 * SKALE on Base chain definition (not in viem/chains).
 * rpcUrls.default.http[0] intentionally mirrors CHAIN_CONFIGS.skale.rpc so
 * viem's internal transport fallback and our explicit transport agree.
 */
const skaleOnBase = {
  id: 1187947933,
  name: "SKALE on Base",
  nativeCurrency: { name: "CREDITS", symbol: "CREDITS", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN_CONFIGS.skale.rpc] } },
};

/** Map chain identifier → viem chain object. Single source of truth for chain metadata. */
function viemChainFor(chain) {
  if (chain === "skale") return skaleOnBase;
  if (chain === "polygon") return polygon;
  return base; // 'base' and unknown fallback
}

/**
 * Build viem wallet + public clients for any supported chain.
 * Reads the RPC URL from CHAIN_CONFIGS so it is defined in exactly one place.
 *
 * @param {string} privateKey
 * @param {string} chain - 'base' | 'skale' | 'polygon'
 * @returns {{ walletClient, publicClient, account }}
 */
function buildClientsForChain(privateKey, chain = "base") {
  const chainCfg = CHAIN_CONFIGS[chain] ?? CHAIN_CONFIGS.base;
  const viemChain = viemChainFor(chain);
  const account = privateKeyToAccount(privateKey);
  const transport = http(chainCfg.rpc);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport,
  });
  const publicClient = createPublicClient({ chain: viemChain, transport });
  return { walletClient, publicClient, account };
}

/**
 * Build Polygon-specific clients (used only by sendViaFacilitator which must
 * always operate on Polygon regardless of the user's preferred chain).
 */
function buildPolygonClients(privateKey) {
  return buildClientsForChain(privateKey, "polygon");
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
async function signEIP3009Auth(
  walletClient,
  account,
  amountRaw,
  to,
  validAfter,
  validBefore,
) {
  // Random bytes32 nonce (EIP-3009 uses random nonces, not sequential)
  const nonce = "0x" + randomBytes(32).toString("hex");

  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: 137,
    verifyingContract: CHAIN_CONFIGS.polygon.usdcContract,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const message = {
    from: account.address,
    to,
    value: BigInt(amountRaw),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await walletClient.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  return {
    signature,
    authorization: {
      from: account.address,
      to,
      value: amountRaw.toString(),
      validAfter: validAfter.toString(),
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
export async function sendViaFacilitator(
  privateKey,
  facilitatorUrl,
  details,
  apiUrl,
) {
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
    scheme: "exact",
    network: "polygon",
    payload: { signature, authorization },
  };

  const paymentRequirements = {
    scheme: "exact",
    network: "polygon",
    maxAmountRequired: amountRaw.toString(),
    resource: apiUrl,
    description: "x402 Bazaar API payment",
    mimeType: "application/json",
    payTo: recipient,
    asset: CHAIN_CONFIGS.polygon.usdcContract,
    maxTimeoutSeconds: 60,
  };

  // Step 3: POST to facilitator /settle
  const settleUrl = `${facilitatorUrl}/settle`;
  const settleRes = await fetch(settleUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload,
      paymentRequirements,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const settleData = await settleRes.json();

  if (!settleData.success) {
    throw new Error(
      `Facilitator settlement failed: ${settleData.errorReason || "unknown"} — ` +
        `${settleData.errorMessage || JSON.stringify(settleData)}`,
    );
  }

  return settleData.transaction;
}

/**
 * Send a single USDC transfer on the given chain and wait for confirmation.
 * Caller is responsible for balance checks.
 *
 * @param {{ walletClient, publicClient }} clients
 * @param {string} toAddress
 * @param {bigint} amountRaw - amount in micro-USDC (6 decimals)
 * @param {string} chain - 'base' | 'skale' | 'polygon'
 * @returns {{ txHash: string, explorer: string }}
 */
async function sendUsdcRaw(clients, toAddress, amountRaw, chain = "base") {
  const { walletClient, publicClient } = clients;
  const chainCfg = CHAIN_CONFIGS[chain] ?? CHAIN_CONFIGS.base;

  const txHash = await walletClient.writeContract({
    address: chainCfg.usdcContract,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [toAddress, amountRaw],
  });

  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: chainCfg.confirmations,
  });

  return {
    txHash,
    explorer: `${chainCfg.explorer}/tx/${txHash}`,
  };
}

/**
 * Send USDC payment on the specified chain (legacy mode — 100% to one recipient).
 * Defaults to 'base' for backwards compatibility with callers that omit the chain.
 *
 * @param {string} privateKey  - Hex private key (with 0x prefix)
 * @param {string} toAddress   - Recipient wallet address
 * @param {number} amountUsdc  - Amount in USDC (e.g., 0.005)
 * @param {string} [chain]     - 'base' | 'skale' | 'polygon' (default: 'base')
 * @returns {{ txHash: string, explorer: string, from: string, amount: number }}
 */
export async function sendUsdcPayment(
  privateKey,
  toAddress,
  amountUsdc,
  chain = "base",
) {
  const chainCfg = CHAIN_CONFIGS[chain] ?? CHAIN_CONFIGS.base;
  const { walletClient, publicClient, account } = buildClientsForChain(
    privateKey,
    chain,
  );

  // Convert USDC amount to 6-decimal units
  const amount = parseUnits(amountUsdc.toString(), 6);

  // Check balance first
  const balance = await publicClient.readContract({
    address: chainCfg.usdcContract,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  if (balance < amount) {
    const balanceUsdc = Number(balance) / 1_000_000;
    throw new Error(
      `Insufficient USDC balance: ${balanceUsdc.toFixed(6)} USDC (need ${amountUsdc} USDC)`,
    );
  }

  const { txHash, explorer } = await sendUsdcRaw(
    { walletClient, publicClient },
    toAddress,
    amount,
    chain,
  );

  return {
    txHash,
    explorer,
    from: account.address,
    amount: amountUsdc,
  };
}

/**
 * Send a split USDC payment on the specified chain (95% provider / 5% platform).
 *
 * The split amounts are derived from the server-provided `split` object when
 * available, or computed with floor arithmetic to guarantee provider + platform
 * = total exactly.
 *
 * @param {string} privateKey - Hex private key (with 0x prefix)
 * @param {object} splitDetails
 * @param {number} splitDetails.totalAmountUsdc        - Total price in USDC
 * @param {string} splitDetails.providerWallet         - Provider wallet (95%)
 * @param {string} splitDetails.platformWallet         - Platform wallet (5%)
 * @param {string} [splitDetails.chain]                - 'base' | 'skale' | 'polygon' (default: 'base')
 * @param {object|null} [splitDetails.serverSplit]     - Optional split from server 402 response
 * @param {number} [splitDetails.serverSplit.provider_amount]
 * @param {number} [splitDetails.serverSplit.platform_amount]
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
 */
export async function sendSplitUsdcPayment(privateKey, splitDetails) {
  const {
    totalAmountUsdc,
    providerWallet,
    platformWallet,
    chain = "base",
    serverSplit = null,
  } = splitDetails;

  const chainCfg = CHAIN_CONFIGS[chain] ?? CHAIN_CONFIGS.base;
  const { walletClient, publicClient, account } = buildClientsForChain(
    privateKey,
    chain,
  );

  // Compute raw amounts (6 decimals).
  // Use server-provided amounts when present to avoid client/server rounding divergence.
  let providerAmountRaw;
  let platformAmountRaw;

  if (
    serverSplit &&
    serverSplit.provider_amount != null &&
    serverSplit.platform_amount != null
  ) {
    providerAmountRaw = parseUnits(serverSplit.provider_amount.toString(), 6);
    platformAmountRaw = parseUnits(serverSplit.platform_amount.toString(), 6);
  } else {
    const totalRaw = parseUnits(totalAmountUsdc.toString(), 6);
    providerAmountRaw = (totalRaw * 95n) / 100n; // floor division via BigInt
    platformAmountRaw = totalRaw - providerAmountRaw; // guarantees sum = total
  }

  const totalRawForCheck = providerAmountRaw + platformAmountRaw;

  // Guard: minimum split amount
  if (providerAmountRaw < MIN_SPLIT_AMOUNT_RAW || platformAmountRaw === 0n) {
    throw new Error(
      `Amount too small for split payment (minimum 0.0001 USDC). ` +
        `Provider share would be ${Number(providerAmountRaw)} micro-USDC.`,
    );
  }

  // Check balance for the full total
  const balance = await publicClient.readContract({
    address: chainCfg.usdcContract,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  if (balance < totalRawForCheck) {
    const balanceUsdc = Number(balance) / 1_000_000;
    const needUsdc = Number(totalRawForCheck) / 1_000_000;
    throw new Error(
      `Insufficient USDC balance: ${balanceUsdc.toFixed(6)} USDC (need ${needUsdc.toFixed(6)} USDC for split payment)`,
    );
  }

  // Transaction 1 — provider (95%)
  const providerResult = await sendUsdcRaw(
    { walletClient, publicClient },
    providerWallet,
    providerAmountRaw,
    chain,
  );

  // Transaction 2 — platform (5%)
  const platformResult = await sendUsdcRaw(
    { walletClient, publicClient },
    platformWallet,
    platformAmountRaw,
    chain,
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
 * Get the wallet address from a private key.
 */
export function getAddressFromKey(privateKey) {
  const account = privateKeyToAccount(privateKey);
  return account.address;
}

/**
 * Get USDC balance for an address on the specified chain.
 * Defaults to 'base' for backwards compatibility.
 *
 * @param {string} address
 * @param {string} [chain] - 'base' | 'skale' | 'polygon' (default: 'base')
 * @returns {Promise<number>} balance in USDC (float)
 */
export async function getUsdcBalance(address, chain = "base") {
  const chainCfg = CHAIN_CONFIGS[chain] ?? CHAIN_CONFIGS.base;

  const publicClient = createPublicClient({
    chain: viemChainFor(chain),
    transport: http(chainCfg.rpc),
  });

  const balance = await publicClient.readContract({
    address: chainCfg.usdcContract,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address],
  });

  return Number(balance) / 1_000_000;
}
