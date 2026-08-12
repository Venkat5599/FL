// Core-Graph data layer: pricing + wallet forensics via the Uniswap v3 subgraph
// on The Graph's decentralized network. Chosen over the Pinax Token API per The
// Graph team's guidance (use core subgraphs, not Pinax). Bonus: the subgraph's
// `priceUSD` is USD-native, so no token→quote→USD conversion is needed.
const V3_SUBGRAPH = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";
// Uniswap v2 subgraph — composed with v3 for pricing coverage: v2 serves tokens
// that only have (or have deeper) v2 liquidity, where v3 returns nothing.
const V2_SUBGRAPH = "A3Np3RQbaBA6oKJgiwDJeo5T3zrYfGHPWFYayMwtNDum";

// Built lazily inside a function (not a module-level const) so importing this
// module never depends on GRAPH_STUDIO_KEY being set — keeps the pure helpers
// (and this module) safely importable in tests with no env vars.
function endpoint(subgraphId: string) {
  return `https://gateway.thegraph.com/api/${process.env.GRAPH_STUDIO_KEY}/subgraphs/id/${subgraphId}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-shaped GraphQL JSON
async function gql(subgraphId: string, query: string): Promise<any | null> {
  if (!process.env.GRAPH_STUDIO_KEY) return null;
  try {
    const r = await fetch(endpoint(subgraphId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data ?? null;
  } catch {
    return null;
  }
}

function toPrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const p = parseFloat(raw);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// v3 pricing: latest hourly close at or before tsSec (USD-native).
export async function subgraphPriceAtV3(tokenAddress: string, tsSec: number): Promise<number | null> {
  const data = await gql(
    V3_SUBGRAPH,
    `{
      tokenHourDatas(
        first: 1, orderBy: periodStartUnix, orderDirection: desc,
        where: { token: "${tokenAddress.toLowerCase()}", periodStartUnix_lte: ${tsSec} }
      ) { priceUSD periodStartUnix }
    }`
  );
  return toPrice(data?.tokenHourDatas?.[0]?.priceUSD);
}

// v2 pricing: latest daily close at or before tsSec (USD-native). Composed with
// v3 as a fallback so v2-only / v2-deeper tokens still price.
export async function subgraphPriceAtV2(tokenAddress: string, tsSec: number): Promise<number | null> {
  const data = await gql(
    V2_SUBGRAPH,
    `{
      tokenDayDatas(
        first: 1, orderBy: date, orderDirection: desc,
        where: { token: "${tokenAddress.toLowerCase()}", date_lte: ${tsSec} }
      ) { priceUSD date }
    }`
  );
  return toPrice(data?.tokenDayDatas?.[0]?.priceUSD);
}

// Composed price: v3 (hourly, precise) first, else v2 (daily, broader coverage).
// Returns the price and which subgraph served it.
export async function subgraphPriceAt(
  tokenAddress: string,
  tsSec: number
): Promise<{ price: number; source: string } | null> {
  const v3 = await subgraphPriceAtV3(tokenAddress, tsSec);
  if (v3 != null) return { price: v3, source: "uniswap_v3_subgraph" };
  const v2 = await subgraphPriceAtV2(tokenAddress, tsSec);
  if (v2 != null) return { price: v2, source: "uniswap_v2_subgraph" };
  return null;
}

// ---- wallet forensics (Said-vs-Did) ----------------------------------------
export type RawSwap = {
  timestamp: string;
  amountUSD: string;
  amount0: string;
  amount1: string;
  token0: { id: string };
  token1: { id: string };
  transaction: { id: string };
};

// In the Uniswap v3 subgraph, swap amounts are signed from the pool's view:
// the token the trader SOLD entered the pool (positive amount); the token they
// received left the pool (negative). So the sold token is whichever side is
// positive. Pure + testable without network.
export type SwapSell = { tx_hash: string; token_address: string; usd_value: number; occurred_at: number };

export function parseSwapSell(s: RawSwap): SwapSell | null {
  const a0 = parseFloat(s.amount0);
  const a1 = parseFloat(s.amount1);
  let soldToken: string | null = null;
  if (a0 > 0) soldToken = s.token0.id;
  else if (a1 > 0) soldToken = s.token1.id;
  if (!soldToken) return null;
  return {
    tx_hash: s.transaction.id,
    token_address: soldToken.toLowerCase(),
    usd_value: parseFloat(s.amountUSD) || 0,
    occurred_at: parseInt(s.timestamp, 10),
  };
}

export async function subgraphSwapsForWallet(
  wallet: string,
  startSec: number,
  endSec: number
): Promise<SwapSell[]> {
  const data = await gql(
    V3_SUBGRAPH,
    `{
      swaps(
        first: 200, orderBy: timestamp, orderDirection: desc,
        where: { origin: "${wallet.toLowerCase()}", timestamp_gte: ${startSec}, timestamp_lte: ${endSec} }
      ) {
        timestamp amountUSD amount0 amount1
        token0 { id } token1 { id } transaction { id }
      }
    }`
  );
  const rows: RawSwap[] = data?.swaps ?? [];
  return rows.map(parseSwapSell).filter((x): x is SwapSell => x !== null);
}
