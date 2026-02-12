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

/**
 * Send USDC payment on Base mainnet
 * @param {string} privateKey - Hex private key (with 0x prefix)
 * @param {string} toAddress - Recipient wallet address
 * @param {number} amountUsdc - Amount in USDC (e.g., 0.005)
 * @returns {{ txHash: string, explorer: string }}
 */
export async function sendUsdcPayment(privateKey, toAddress, amountUsdc) {
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

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

  // Send the USDC transfer
  const txHash = await walletClient.writeContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [toAddress, amount],
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

  return {
    txHash,
    explorer: `https://basescan.org/tx/${txHash}`,
    from: account.address,
    amount: amountUsdc,
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
