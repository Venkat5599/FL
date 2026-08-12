// Copy/fade sizing + direction logic. Pure and unit-testable (no wallet, no
// network) — the automation watcher calls this to decide each trade, then
// hands the result to the Privy-signed Uniswap swap.

export type Mode = "copy" | "fade";
export type CapType = "fixed_usd" | "percent";

export interface Allocation {
  mode: Mode;
  capType: CapType;
  capValue: number; // USD if fixed_usd; 0..100 if percent
}

// The creator's call the trade reacts to.
export interface CallSignal {
  direction: "long" | "short";
  tokenAddress: string;
  tokenSymbol: string;
}

// The user's trade this call produces, or null if it shouldn't fire.
export interface PlannedTrade {
  side: "buy" | "sell";
  tokenAddress: string;
  tokenSymbol: string;
  amountUsd: number;
}

// The USD budget a creator allocation is worth right now.
export function allocationBudgetUsd(alloc: Allocation, userBalanceUsd: number): number {
  if (alloc.capType === "fixed_usd") return Math.max(0, alloc.capValue);
  // percent of current balance
  const pct = Math.min(100, Math.max(0, alloc.capValue));
  return Math.max(0, (pct / 100) * userBalanceUsd);
}

// FADE inverts the creator's direction; COPY mirrors it. A long → buy the token;
// a short → sell it (into the quote asset). alreadyDeployedUsd is how much of
// this creator's budget is already in open trades, so we never exceed the cap.
export function planTrade(
  signal: CallSignal,
  alloc: Allocation,
  userBalanceUsd: number,
  alreadyDeployedUsd = 0
): PlannedTrade | null {
  const budget = allocationBudgetUsd(alloc, userBalanceUsd);
  const remaining = budget - Math.max(0, alreadyDeployedUsd);
  if (remaining <= 0) return null;

  // Effective direction after copy/fade.
  const effective =
    alloc.mode === "copy" ? signal.direction : signal.direction === "long" ? "short" : "long";
  const side: "buy" | "sell" = effective === "long" ? "buy" : "sell";

  // Deploy the remaining budget for this call (one call = one entry up to cap).
  const amountUsd = Math.round(remaining * 100) / 100;
  if (amountUsd <= 0) return null;

  return { side, tokenAddress: signal.tokenAddress, tokenSymbol: signal.tokenSymbol, amountUsd };
}
