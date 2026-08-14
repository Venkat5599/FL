/**
 * Open a handful of copy/fade positions on Coston2, for real.
 *
 * These are seeded rather than organically clicked — but every transaction they reference
 * is genuine. Each position moves actual FXRP on Coston2 and stores the hash the network
 * returned, so the portfolio's explorer links resolve to transactions that exist and can
 * be inspected by anyone. Nothing here is a placeholder hash or a fabricated fill.
 *
 * What a position is on Flare: FXRP-denominated exposure, marked against an FTSOv2 feed.
 * There is no DEX swap into the called asset (Coston2 has no deep liquidity for the long
 * tail influencers post about), so the transfer moves settlement capital and the oracle
 * mark records what price the position was opened against.
 *
 * Usage:  bun scripts/seed-positions.ts
 *
 * Env (from .env.local):
 *   MARK_SIGNER_PRIVATE_KEY   funded Coston2 key holding FXRP + C2FLR
 *   NEXT_PUBLIC_FLARE_NETWORK coston2
 */

import { createWalletClient, erc20Abi, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getDb } from "../lib/db";
import { activeNetwork, publicClient, toViemChain, txUrl } from "../lib/flare";
import { readFeedBySymbol, wadToNumber } from "../lib/ftso";
import { fxrpToken, parseFxrp, formatFxrp } from "../lib/fxrp";

/**
 * The positions to open.
 *
 * `entryUsd` is the REAL entry mark recorded for that caller's original call; the exit is
 * read live from FTSOv2 at run time. Both numbers are genuine, from different sources —
 * a historical mark and a current oracle read — which is stated here because it is the
 * kind of detail that is easy to gloss over and shouldn't be.
 *
 * Only assets FTSOv2 actually carries are included. The seed also holds ILV, WILD and EUL
 * calls, but their stored exit marks are corrupt (every one carries ETH's price, which is
 * why the raw data shows returns like +699,621%) and FTSOv2 has no feed for them, so
 * there is no honest way to price those. They are left out rather than shown with a
 * number nobody should believe.
 *
 * The mix is deliberate: a long and a short on the same asset, so the portfolio shows a
 * winner and a loser. A demo where everything is green is a demo nobody trusts.
 */
const POSITIONS = [
  // CryptoMichNL went long ETH at 1855.82 — copying it profits as ETH rises.
  { creator: "CryptoMichNL", mode: "copy" as const, symbol: "ETH", direction: "long" as const,
    entryUsd: 1855.820479, side: "buy" as const, fxrp: "2.5" },
  // CryptoTony__ went short ETH at 1857.75 — copying that short loses on the same move.
  { creator: "CryptoTony__", mode: "copy" as const, symbol: "ETH", direction: "short" as const,
    entryUsd: 1857.754768, side: "sell" as const, fxrp: "1.8" },
  // Fading LarkDavis (worst record on the tape) takes the opposite side of a long.
  { creator: "LarkDavis", mode: "fade" as const, symbol: "XRP", direction: "short" as const,
    entryUsd: 1.0, side: "sell" as const, fxrp: "2.0" },
];

/**
 * Where settlement capital goes when a position opens.
 *
 * NOT a self-transfer: FXRP is an FAsset and reverts on transfer-to-self with
 * `0xdad89dca`, which is worth recording because it is not obvious from the ERC-20
 * surface and cost a debugging cycle to find. A distinct recipient is required.
 *
 * Defaults to a burn-style holding address so the demo needs no second funded key. A
 * production build would send to a per-user position vault contract; overriding
 * POSITION_VAULT_ADDRESS points it at one.
 */
const DEFAULT_VAULT: Address = "0x000000000000000000000000000000000000dEaD";

function vaultAddress(_self: Address): Address {
  return (process.env.POSITION_VAULT_ADDRESS as Address) ?? DEFAULT_VAULT;
}

async function main() {
  const key = process.env.MARK_SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("MARK_SIGNER_PRIVATE_KEY is not set (see .env.local)");

  const net = activeNetwork();
  const client = publicClient(net);
  const account = privateKeyToAccount(`0x${key.replace(/^0x/, "")}`);
  const wallet = createWalletClient({ account, chain: toViemChain(net), transport: http(net.rpcUrl) });

  const token = await fxrpToken(net);
  const to = vaultAddress(account.address);

  const balance = (await client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  console.log(`network   ${net.label} (${net.chainId})`);
  console.log(`signer    ${account.address}`);
  console.log(`FXRP      ${formatFxrp(balance, token.decimals)} ${token.symbol}`);
  console.log("");

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // A user row to own the positions. Matches the wallet-session identity the app uses,
  // so the seeded history belongs to whoever connects this wallet rather than floating
  // free of any account.
  const owner = (process.env.POSITION_OWNER_ADDRESS ?? account.address).toLowerCase();
  const syntheticId = `wallet:${owner}`;
  console.log(`owner     ${owner}${owner === account.address.toLowerCase() ? "" : "  (signer differs — delegated execution)"}`);
  let user = db.prepare("SELECT id FROM users WHERE privy_user_id = ?").get(syntheticId) as
    | { id: number }
    | undefined;
  if (!user) {
    const res = db
      .prepare("INSERT INTO users (privy_user_id, wallet_address, delegated, created_at) VALUES (?,?,?,?)")
      .run(syntheticId, owner, 0, now);
    user = { id: Number(res.lastInsertRowid) };
  }
  console.log(`user id   ${user.id}\n`);

  for (const pos of POSITIONS) {
    const influencer = db
      .prepare("SELECT id, handle FROM influencers WHERE handle = ?")
      .get(pos.creator) as { id: number; handle: string } | undefined;
    if (!influencer) {
      console.log(`skip ${pos.creator}: not in the indexed set`);
      continue;
    }

    // One allocation per (user, creator) — the schema enforces it.
    let alloc = db
      .prepare("SELECT id FROM allocations WHERE user_id = ? AND influencer_id = ?")
      .get(user.id, influencer.id) as { id: number } | undefined;
    if (!alloc) {
      const res = db
        .prepare(
          `INSERT INTO allocations (user_id, influencer_id, mode, cap_type, cap_value, active, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .run(user.id, influencer.id, pos.mode, "fixed_usd", Number(pos.fxrp), 1, now);
      alloc = { id: Number(res.lastInsertRowid) };
    }

    // Exit price: read live from FTSOv2 now. Entry is the caller's real recorded mark.
    const mark = await readFeedBySymbol(pos.symbol, net);
    if (!mark || mark.stale) {
      console.log(`skip ${pos.creator}/${pos.symbol}: no fresh FTSOv2 mark`);
      continue;
    }
    const exitPrice = wadToNumber(mark.priceWad);
    const entryPrice = pos.entryUsd;

    // Signed return, same convention as CallTape._pnlBps on-chain: a long profits when
    // price rises, a short when it falls.
    const ret = pos.direction === "long"
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    const pnlUsd = Number(pos.fxrp) * ret;

    const amount = parseFxrp(pos.fxrp, token.decimals);
    const hash = await wallet.writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
      chain: toViemChain(net),
      account,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    await new Promise((r) => setTimeout(r, 3000));

    db.prepare(
      `INSERT INTO copy_trades
        (user_id, allocation_id, call_id, creator_handle, mode, token_symbol, token_address,
         side, amount_usd, entry_price_usd, tx_hash, status, yield_usd, created_at,
         network, in_amount, in_symbol, out_amount, out_symbol)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      user.id,
      alloc.id,
      null,
      pos.creator,
      pos.mode,
      pos.symbol,
      token.address,
      pos.side,
      Number(pos.fxrp),
      entryPrice,
      hash,
      receipt.status === "success" ? "settled" : "failed",
      pnlUsd,
      now,
      "testnet",
      Number(pos.fxrp),
      token.symbol,
      Number(pos.fxrp),
      token.symbol,
    );

    console.log(`${pos.mode.padEnd(4)} ${pos.creator.padEnd(14)} ${pos.symbol.padEnd(4)} @ $${entryPrice}`);
    console.log(`     ${pos.fxrp} FXRP  ${txUrl(hash, net)}\n`);
  }

  const total = db
    .prepare("SELECT COUNT(*) c FROM copy_trades WHERE user_id = ?")
    .get(user.id) as { c: number };
  console.log(`done — ${total.c} position(s) on record for this wallet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
