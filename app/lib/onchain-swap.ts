import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  getAddress,
  formatUnits,
  maxUint256,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privyClient } from "./privy";

// Direct on-chain Uniswap v3 execution on Base Sepolia. The hosted Uniswap
// Trading API does NOT index Base Sepolia (every quote returns "no route"),
// but the WETH/USDC v3 pools are deployed and liquid on-chain — so we call the
// SwapRouter02 contract directly instead of going through the routing service.
// Signing is done server-side on the user's delegated Privy embedded wallet.

// Uniswap Base Sepolia deployment (from Uniswap's official deployment docs;
// factory cross-checked against the Base Sepolia RPC).
const SWAP_ROUTER_02 = getAddress("0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4");
const RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const CHAIN_ID = 84532;
// 0.3% tier — the deepest WETH/USDC pool on Base Sepolia (~9.3e13 liquidity).
const POOL_FEE = 3000;

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// SwapRouter02 exactInputSingle: NOTE this variant has NO deadline field
// (SwapRouter02 dropped it, unlike the original SwapRouter).
const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

export interface OnchainSwapInput {
  privyWalletId: string;
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  tokenInSymbol: string; // for human-readable errors
  tokenInDecimals: number;
}

export interface OnchainSwapResult {
  status: "executed" | "failed";
  txHash?: string;
  reason?: string;
  amountOutRaw?: bigint; // actual tokenOut received (decoded from the swap receipt)
}

// ERC-20 Transfer(address,address,uint256) topic0.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Privy tx response shape varies by SDK version
function hashOf(res: any): string | undefined {
  return res?.hash ?? res?.transactionHash ?? undefined;
}

// Swap `amountIn` of tokenIn for tokenOut via the Base Sepolia WETH/USDC pool.
// Approves the router first if needed (waiting for that to confirm), then swaps.
// amountOutMinimum is 0: acceptable on a testnet with no MEV; never reuse this
// module for mainnet execution without slippage protection.
export async function swapExactInputOnBaseSepolia(inp: OnchainSwapInput): Promise<OnchainSwapResult> {
  const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const owner = getAddress(inp.walletAddress);
  const tokenIn = getAddress(inp.tokenIn);
  const tokenOut = getAddress(inp.tokenOut);

  const send = async (to: string, data: Hex): Promise<string | undefined> => {
    const res = await privyClient().walletApi.ethereum.sendTransaction({
      walletId: inp.privyWalletId,
      caip2: `eip155:${CHAIN_ID}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Privy transaction shape
      transaction: { to, data, value: "0x0", chainId: CHAIN_ID } as any,
    });
    return hashOf(res);
  };

  try {
    // 1. Must actually hold the input token — otherwise the swap reverts.
    const bal = (await pub.readContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    })) as bigint;
    if (bal < inp.amountIn) {
      const sym = inp.tokenInSymbol;
      const have = formatUnits(bal, inp.tokenInDecimals);
      const need = formatUnits(inp.amountIn, inp.tokenInDecimals);
      const where =
        sym === "USDC"
          ? "Get testnet USDC at faucet.circle.com (Base Sepolia)"
          : sym === "WETH"
            ? "Wrap a little Base Sepolia ETH into WETH (deposit() on 0x4200…0006)"
            : `Send ${sym} to the vault`;
      return {
        status: "failed",
        reason: `Needs ${need} ${sym}, vault has ${have} ${sym}. ${where}, plus a little Base Sepolia ETH for gas. Fund the vault (address in the wallet menu), then retry.`,
      };
    }

    // 2. Approve the router once if the allowance is short.
    const allowance = (await pub.readContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, SWAP_ROUTER_02],
    })) as bigint;
    if (allowance < inp.amountIn) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SWAP_ROUTER_02, maxUint256],
      });
      const approveHash = await send(tokenIn, approveData);
      if (!approveHash) return { status: "failed", reason: "approval transaction was not broadcast" };
      await pub.waitForTransactionReceipt({ hash: approveHash as Hex });
    }

    // 3. Swap.
    const swapData = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: POOL_FEE,
          recipient: owner,
          amountIn: inp.amountIn,
          amountOutMinimum: BigInt(0),
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });
    const swapHash = await send(SWAP_ROUTER_02, swapData);
    if (!swapHash) return { status: "failed", reason: "swap transaction was not broadcast" };

    // Wait for the receipt and decode the actual tokenOut received (the
    // Transfer of tokenOut into the vault), so the portfolio shows the real
    // fill instead of a nominal size.
    let amountOutRaw: bigint | undefined;
    try {
      const rcpt = await pub.waitForTransactionReceipt({ hash: swapHash as Hex });
      if (rcpt.status === "reverted") return { status: "failed", reason: "swap reverted on-chain", txHash: swapHash };
      const ownerTopic = `0x000000000000000000000000${owner.slice(2)}`.toLowerCase();
      for (const log of rcpt.logs) {
        if (
          log.address.toLowerCase() === tokenOut.toLowerCase() &&
          log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
          log.topics[2]?.toLowerCase() === ownerTopic
        ) {
          amountOutRaw = BigInt(log.data);
        }
      }
    } catch {
      /* receipt/decoding is best-effort; the swap still succeeded */
    }
    return { status: "executed", txHash: swapHash, amountOutRaw };
  } catch (e) {
    return { status: "failed", reason: (e as Error).message?.slice(0, 200) };
  }
}
