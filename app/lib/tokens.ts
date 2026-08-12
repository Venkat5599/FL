// Symbol -> EVM mainnet token address map for the demo influencer set.
// Only liquid tokens with high-confidence mainnet addresses are listed;
// unknown/unconfident symbols are intentionally omitted so callers fall
// back to the "unpriceable" bucket (see run-pipeline.ts) instead of
// silently pricing the wrong contract.
//
// Solana-only symbols shilled by some influencers (WIF, BONK, POPCAT, ...)
// are deliberately absent — there is no EVM mainnet address for them and
// Task 4's Pinax pricing client only covers EVM pools, so they are
// unpriceable by design.
export const TOKENS: Record<string, string | undefined> = {
  PEPE: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  ETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // native ETH priced via WETH pools
  SHIB: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
  LINK: "0x514910771af9ca656af840dff83e8264ecf986ca",
  UNI: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
  AAVE: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
  PEOPLE: "0x7a58c0be72be218b41c608b7fe7c5bb630736c71",
  TURBO: "0xa35923162c49cf95e6bf26623385eb431ad920d3",
  MOG: "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a",
  SPX: "0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c", // SPX6900
  // Additional liquid majors, high-confidence addresses only.
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  DAI: "0x6b175474e89094c44da98b954eedeac495271d0f",
  APE: "0x4d224452801aced8b2f0aebe155379bb5d594381",
  FLOKI: "0xcf0c122c6b73ff809c693db761e7baebe62b6a2e",
  WLD: "0x163f8c2467924be0ae7b5347228cabf260318753",
  LDO: "0x5a98fcbea516cf06857215779fd812ca3bef1b32",
  MKR: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2",
  ENS: "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72",
  ENA: "0x57e114b691db790c35207b2e685d4a43181e6061",
  // Gaming/DeFi tokens with real Uniswap history (used in demo dossiers):
  ILV: "0x767fe9edc9e0df98e07454847909b5e959d7ca0e",
  WILD: "0x2a3bff78b79a009976eea096a51a948a3dc00e34",
  EUL: "0xd9fcd98c322942075a5c3860693e9f4f03aae07b",
  // Deliberately absent (Solana-only, no EVM mainnet contract): WIF, BONK, POPCAT.
};
