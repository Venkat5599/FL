import { NextResponse } from "next/server";
import { createWalletClient, http, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { activeNetwork, publicClient, toViemChain, txUrl } from "@/lib/flare";
import { feedIdForSymbol } from "@/lib/feeds";
import { wadToNumber } from "@/lib/ftso";

/**
 * Record an FTSOv2 price mark on-chain. POST /api/mark { symbol, tag? }
 *
 * WHAT THIS ACTUALLY DOES, because "the site sent a transaction" is the kind of claim
 * that deserves to be spelled out:
 *
 * FTSOv2 is a spot oracle with no history — it says what a thing is worth now and forgets.
 * TAPE therefore cannot price a call retroactively; it records marks FORWARD, at the
 * moment it observes them, and those recordings become the history. `CallTape` does this
 * at open and at settle. This endpoint does the same thing standalone, so a price can be
 * witnessed and timestamped by the chain before any call is bound to it.
 *
 * The price is NOT sent from here. This request carries a feed id and nothing else; the
 * contract reads FTSOv2 inside the transaction and stores the oracle's own value and
 * timestamp. Neither this server nor the person who clicked the button chooses the
 * number, which is the entire reason the resulting transaction is worth showing.
 *
 * ON THE SERVER-SIDE SIGNER — read this before deploying anywhere that matters.
 *
 * The key below signs without a wallet prompt, which is what makes this demonstrable in a
 * recording. That is a real trade-off, not a free one: anyone who can reach this endpoint
 * can spend this key's gas. It is acceptable here only because the key is a throwaway
 * holding testnet C2FLR and the only function it can call writes a public price mark —
 * the worst outcome is a wasted faucet grant. It must never hold mainnet funds, and any
 * production version of this belongs behind a user's own wallet or a rate-limited relayer
 * with a spend cap.
 */

const MARK_LOG_ABI = parseAbi([
  "function recordMark(bytes21 _feedId, bytes32 _tag) external payable returns (uint256)",
  "function markFee(bytes21 _feedId) external view returns (uint256)",
]);

/** Symbols FTSOv2 is known to carry. Rejecting early gives a clear error instead of a revert. */
const SUPPORTED = new Set(["FLR", "XRP", "BTC", "ETH", "DOGE", "ADA", "ALGO"]);

export async function POST(req: Request) {
  const markLog = process.env.NEXT_PUBLIC_MARK_LOG_ADDRESS as Address | undefined;
  const rawKey = process.env.MARK_SIGNER_PRIVATE_KEY;

  if (!markLog) {
    return NextResponse.json({ error: "NEXT_PUBLIC_MARK_LOG_ADDRESS is not configured" }, { status: 503 });
  }
  if (!rawKey) {
    // Explicit 503 rather than a fabricated success. A demo that reports a transaction
    // it did not send is worse than one that admits it cannot send it.
    return NextResponse.json({ error: "MARK_SIGNER_PRIVATE_KEY is not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { symbol?: string; tag?: string };
  const symbol = (body.symbol ?? "XRP").trim().toUpperCase();

  if (!SUPPORTED.has(symbol)) {
    return NextResponse.json(
      { error: `FTSOv2 carries no feed for ${symbol}`, supported: [...SUPPORTED] },
      { status: 400 },
    );
  }

  const net = activeNetwork();
  const client = publicClient(net);
  const account = privateKeyToAccount(`0x${rawKey.replace(/^0x/, "")}` as Hex);
  const wallet = createWalletClient({ account, chain: toViemChain(net), transport: http(net.rpcUrl) });

  const feedId = feedIdForSymbol(symbol);
  // A tag is the caller's own reference, truncated to 31 bytes so it fits a bytes32.
  const tag = stringToHex((body.tag ?? `tape:${symbol}`).slice(0, 31), { size: 32 });

  try {
    const fee = (await client.readContract({
      address: markLog,
      abi: MARK_LOG_ABI,
      functionName: "markFee",
      args: [feedId],
    })) as bigint;

    const hash = await wallet.writeContract({
      address: markLog,
      abi: MARK_LOG_ABI,
      functionName: "recordMark",
      args: [feedId, tag],
      value: fee,
      chain: toViemChain(net),
      account,
    });

    const receipt = await client.waitForTransactionReceipt({ hash });

    // Read the mark back out of the log rather than echoing what we hoped was written.
    // The point of the exercise is what the chain now says, not what we intended.
    const markLogAbiFull = parseAbi([
      "function totalMarks() external view returns (uint256)",
      "function getMark(uint256) external view returns ((bytes21 feedId, uint256 priceWad, uint64 feedTimestamp, uint64 recordedAt, address recorder, bytes32 tag))",
    ]);
    const total = (await client.readContract({
      address: markLog,
      abi: markLogAbiFull,
      functionName: "totalMarks",
    })) as bigint;
    const mark = (await client.readContract({
      address: markLog,
      abi: markLogAbiFull,
      functionName: "getMark",
      args: [total - BigInt(1)],
    })) as {
      feedId: string;
      priceWad: bigint;
      feedTimestamp: bigint;
      recordedAt: bigint;
      recorder: string;
    };

    return NextResponse.json({
      ok: true,
      txHash: hash,
      explorer: txUrl(hash, net),
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      network: { name: net.label, chainId: net.chainId },
      mark: {
        markId: Number(total - BigInt(1)),
        symbol: `${symbol}/USD`,
        feedId,
        priceUsd: wadToNumber(mark.priceWad),
        // The oracle's timestamp and the chain's, kept separate on purpose: the gap
        // between them is how fresh the observation was when it was written down.
        feedTimestamp: Number(mark.feedTimestamp),
        recordedAt: Number(mark.recordedAt),
        recorder: mark.recorder,
      },
      contract: markLog,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "mark failed", detail: (e as Error).message?.slice(0, 300) },
      { status: 502 },
    );
  }
}
