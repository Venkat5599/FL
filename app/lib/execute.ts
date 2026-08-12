import { formatUnits, parseUnits } from "viem";
import { getDb } from "./db";
import { privyClient } from "./privy";
import type { PlannedTrade } from "./copytrade";
import { netCfg, type Network } from "./networks";
import { swapExactInputOnBaseSepolia } from "./onchain-swap";

const UNISWAP = "https://trade-api.gateway.uniswap.org/v1";

function uniHeaders() {
  return {
    "x-api-key": process.env.UNISWAP_API_KEY!,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export interface ExecInput {
  userId: number;
  privyWalletId: string | null; // Privy embedded wallet id (needed to sign)
  walletAddress: string | null;
  delegated: boolean;
  network?: Network; // active execution network; defaults to testnet
  allocationId: number;
  callId: number | null;
  creatorHandle: string;
  mode: "copy" | "fade";
  planned: PlannedTrade;
  entryPriceUsd?: number | null;
  sizeUsd?: number; // the resolved quick-trade amount in USDC (testnet sizing)
}

// Execute one copy/fade trade for a user: get a Uniswap quote → (if the wallet
// is delegated + funded) sign & send via Privy on Base Sepolia → log the trade.
// Honest about prerequisites: logs status 'failed' with a reason when the
// wallet isn't delegated/funded rather than pretending it traded.
export async function executeCopyTrade(inp: ExecInput): Promise<{ status: string; txHash?: string; reason?: string }> {
  const db = getDb();
  const p = inp.planned;
  const net = netCfg(inp.network ?? "testnet");
  const chainId = net.chainId;
  const weth = net.weth;
  const tokenIn = p.side === "buy" ? weth : p.tokenAddress;
  const tokenOut = p.side === "buy" ? p.tokenAddress : weth;
  // Demo sizing: fixed small wei amount (real USD→wei sizing needs an oracle;
  // the USD amount is recorded for the portfolio, the on-chain leg is small).
  const amountWei = "1000000000000000"; // 0.001 WETH-equiv

  type LogExtra = { inAmt?: number | null; inSym?: string | null; outAmt?: number | null; outSym?: string | null; reason?: string | null };
  const logTrade = (status: string, txHash?: string, extra?: LogExtra) =>
    db
      .prepare(
        `INSERT INTO copy_trades (user_id, allocation_id, call_id, creator_handle, mode,
           token_symbol, token_address, side, amount_usd, entry_price_usd, tx_hash, status, network,
           in_amount, in_symbol, out_amount, out_symbol, reason, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        inp.userId, inp.allocationId, inp.callId, inp.creatorHandle, inp.mode,
        p.tokenSymbol, p.tokenAddress, p.side, p.amountUsd, inp.entryPriceUsd ?? null,
        txHash ?? null, status, net.key,
        extra?.inAmt ?? null, extra?.inSym ?? null, extra?.outAmt ?? null, extra?.outSym ?? null, extra?.reason ?? null,
        Math.floor(Date.now() / 1000)
      );

  // Prerequisites for real execution.
  if (!inp.delegated || !inp.privyWalletId || !inp.walletAddress) {
    logTrade("failed", undefined, { reason: "wallet not delegated for auto-trading" });
    return { status: "failed", reason: "wallet not delegated for auto-trading" };
  }

  // Testnet: the Uniswap Trading API doesn't index Base Sepolia, so execute
  // directly against the on-chain WETH/USDC pool. Quote asset is USDC, so a
  // "buy" spends USDC for the token (WETH) and a "sell" swaps it back.
  if (net.key === "testnet") {
    const quote = net.quoteAsset;
    const target = p.tokenAddress;
    const isBuy = p.side === "buy";
    const inSym = isBuy ? "USDC" : "WETH";
    const inDec = isBuy ? net.quoteDecimals : 18;
    const outSym = isBuy ? "WETH" : "USDC";
    const outDec = isBuy ? 18 : net.quoteDecimals;
    // Size the on-chain leg from the user's quick-trade amount (USDC). A buy
    // spends that many USDC; a sell converts it to WETH via the call's price
    // (falling back to the small default WETH size when no price is known).
    const sizeUsd = inp.sizeUsd && inp.sizeUsd > 0 ? inp.sizeUsd : 1;
    let amountIn: bigint;
    if (isBuy) {
      amountIn = parseUnits(sizeUsd.toFixed(net.quoteDecimals), net.quoteDecimals);
    } else {
      const price = inp.entryPriceUsd && inp.entryPriceUsd > 0 ? inp.entryPriceUsd : null;
      const wethAmt = price ? sizeUsd / price : Number(formatUnits(BigInt(net.tokenTradeAmount), 18));
      amountIn = parseUnits(wethAmt.toFixed(18), 18);
    }
    const onchain = await swapExactInputOnBaseSepolia({
      privyWalletId: inp.privyWalletId,
      walletAddress: inp.walletAddress,
      tokenIn: isBuy ? quote : target,
      tokenOut: isBuy ? target : quote,
      amountIn,
      tokenInSymbol: inSym,
      tokenInDecimals: inDec,
    });
    // Record the REAL swap: input actually spent + output actually received.
    const inAmt = Number(formatUnits(amountIn, inDec));
    const outAmt = onchain.amountOutRaw != null ? Number(formatUnits(onchain.amountOutRaw, outDec)) : null;
    logTrade(onchain.status, onchain.txHash, {
      inAmt: onchain.status === "executed" ? inAmt : null,
      inSym: onchain.status === "executed" ? inSym : null,
      outAmt,
      outSym: outAmt != null ? outSym : null,
      reason: onchain.reason ?? null,
    });
    return { status: onchain.status, txHash: onchain.txHash, reason: onchain.reason };
  }

  try {
    // Uniswap quote → swap calldata (protocols guard avoids UniswapX $300 min).
    const quote = await fetch(`${UNISWAP}/quote`, {
      method: "POST",
      headers: uniHeaders(),
      body: JSON.stringify({
        type: "EXACT_INPUT", tokenIn, tokenOut,
        tokenInChainId: chainId, tokenOutChainId: chainId,
        amount: amountWei, swapper: inp.walletAddress,
        autoSlippage: "DEFAULT", protocols: ["V2", "V3", "V4"],
      }),
    }).then((r) => r.json());

    if (quote.permitData) {
      // Permit2 needed — the delegated backend would sign the EIP-712 permit then
      // /swap. Left as the next execution step; log honestly for now.
      logTrade("failed", undefined, { reason: "permit2 signature step pending for delegated flow" });
      return { status: "failed", reason: "permit2 signature step pending for delegated flow" };
    }

    const swap = await fetch(`${UNISWAP}/swap`, {
      method: "POST",
      headers: uniHeaders(),
      body: JSON.stringify({ quote: quote.quote }),
    }).then((r) => r.json());

    const tx = swap.swap;
    if (!tx?.to || !tx?.data) {
      logTrade("failed", undefined, { reason: "no route on Uniswap Trading API" });
      return { status: "failed", reason: "no swap calldata" };
    }

    // Delegated server-side signing on the user's Privy wallet.
    // Delegated signing uses the authorization key configured on the client.
    const res = await privyClient().walletApi.ethereum.sendTransaction({
      walletId: inp.privyWalletId,
      caip2: net.caip2,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Privy tx shape
      transaction: { to: tx.to, data: tx.data, value: tx.value ?? "0x0", chainId } as any,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape varies
    const txHash = (res as any).hash ?? (res as any).transactionHash ?? undefined;
    logTrade("executed", txHash);
    return { status: "executed", txHash };
  } catch (e) {
    const reason = (e as Error).message?.slice(0, 160);
    logTrade("failed", undefined, { reason });
    return { status: "failed", reason };
  }
}
