import { createWalletClient, createPublicClient, http, parseUnits, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

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
