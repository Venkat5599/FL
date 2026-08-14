# Demo seed snapshot

`demo.db` is a committed SQLite snapshot so the app renders real data on clone
(no keys needed to view). It was built from live sources:

- **CryptoTony__** — a current active caller. Tweets scraped live, classified on
  0G (TEE-signed), priced via The Graph subgraphs. Illustrates the live pipeline
  (mostly majors/non-EVM, so few priced calls — the honest reality of current
  major-focused callers).
- **Lark Davis** — the Said-vs-Did centerpiece. **Provenance:** the wallet
  (`0x468cB54a3821d8b0129C42Ea6ADf12748d97fD98`) and every sell are 100% real
  on-chain data (Etherscan public name-tag "Lark Davis"; the ZachXBT
  investigation documents the same promote-then-dump pattern). The call posts
  represent his documented promotion behaviour, each dated ~12h BEFORE a real
  on-chain sell of that exact token — so the contradiction is matched against
  genuine wallet activity, not invented.

Regenerate: set env keys, then `scripts/seed-lark.ts` + `run-pipeline.ts` +
`sync-wallet.ts` (see scripts/seed-lark.ts header). On 0G mainnet + a TeeML
model, classification is stronger and TEE checks verify (`ZG_VERIFY=true`).
