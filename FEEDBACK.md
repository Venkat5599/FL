# Uniswap developer feedback

Project: **GigaBags** (ETHGlobal Lisbon 2026). Repo: https://github.com/Venkat5599/FL · Live app: https://gigabags.vercel.app

This is the honest developer account of integrating Uniswap, with the exact contracts and lines of code so the integration can be verified.

## What we built with Uniswap

Uniswap is GigaBags's execution layer. The app scores a crypto influencer's public calls, and Uniswap is what lets a user copy the honest callers or fade the rest in a single tap. So the product is an execution loop driven by AI signals, not a scoreboard with a swap bolted on. Once a user delegates a Privy session signer, every Follow or Fade after that executes on-chain with no wallet popup.

We integrated Uniswap two ways to get real coverage on both networks:

**1. Hosted Trading API (Base mainnet).** Quote, then swap.
- Quote and swap calls: [`app/lib/execute.ts#L119`](https://github.com/Venkat5599/FL/blob/main/app/lib/execute.ts#L119)
- Server-side quote route, so `UNISWAP_API_KEY` never reaches the client: [`app/api/quote/route.ts#L5`](https://github.com/Venkat5599/FL/blob/main/app/api/quote/route.ts#L5)
- Endpoint: `https://trade-api.gateway.uniswap.org/v1`

**2. Direct SwapRouter02 (Base Sepolia).** The hosted Trading API does not index Base Sepolia, so we located the deployed WETH/USDC v3 pool on-chain and call `SwapRouter02.exactInputSingle` ourselves, then decode the ERC-20 `Transfer` out of the receipt to record the true output amount instead of a nominal one.
- Router address: [`app/lib/onchain-swap.ts#L22`](https://github.com/Venkat5599/FL/blob/main/app/lib/onchain-swap.ts#L22)
- `exactInputSingle` call: [`app/lib/onchain-swap.ts#L130`](https://github.com/Venkat5599/FL/blob/main/app/lib/onchain-swap.ts#L130)
- Receipt decode for the real fill: [`app/lib/onchain-swap.ts#L146`](https://github.com/Venkat5599/FL/blob/main/app/lib/onchain-swap.ts#L146)

## Contracts and addresses

| What | Address | Network |
|---|---|---|
| SwapRouter02 | [`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`](https://sepolia.basescan.org/address/0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4) | Base Sepolia |
| WETH | `0x4200000000000000000000000000000000000006` | Base (both) |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Base Sepolia |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base mainnet |

## What worked well

- The Trading API is clean where it is supported. One `/quote`, then `/swap`, and you have calldata ready to send. Wiring the mainnet path took very little time.
- Calling `SwapRouter02.exactInputSingle` directly was straightforward once we had the ABI right. The struct-argument shape is easy to encode with viem, and swaps landed on the first try against the live pool.
- Reading the actual output from the swap receipt (the `Transfer` of `tokenOut` into the wallet) gave us an exact fill to store, which is what makes the portfolio show a real number rather than an estimate.
- `check_approval` composed cleanly. Routing it and `/quote` through one server-side handler via an `action` field kept the API key off the client without a second route, and it behaved exactly as expected.

## What cost us time

- **The Trading API does not cover Base Sepolia.** This was the main blocker. The API returns "no route" / `ResourceNotFound` for pairs whose v3 pools are actually deployed and liquid on-chain. We confirmed WETH/USDC pools exist across fee tiers via the factory, then had to bypass the API entirely and call the router ourselves for testnet. A hackathon is exactly where teams build and demo on a testnet, so this gap cost us the most hours.
- **SwapRouter02 dropped the `deadline` field** from `exactInputSingle` compared to the original SwapRouter. We initially encoded the old struct shape and the call reverted with no obvious reason. Documenting the router-version differences prominently would save this class of debugging.
- **UniswapX is in the default `protocols` set, and its order minimum silently kills small swaps.** With the default protocol list, our roughly 0.001 WETH testnet and demo quotes routed nowhere, because UniswapX carries an order minimum well above a demo-sized trade. The fix was to pass `protocols: ["V2","V3","V4"]` explicitly on every `/quote`, but nothing in the response said that was the problem. Returning a structured "below minimum" error, instead of an opaque non-route, would have saved hours.
- **Route provenance is opaque.** A quote does not clearly say whether it resolved to a UniswapX route or a plain on-chain route, which is the flip side of the point above and matters when an agent is deciding how to execute and what to show the user.
- **The `Accept` header is load-bearing but undocumented as such.** Omitting `Accept: application/json`, or sending a looser value, changed the response shape we got back in early testing. The example curl implies it; it is worth stating outright.
- **The permit-versus-swap branch forces a two-step client flow that is not obvious from the quote alone.** You only learn a Permit2 signature is required by checking for `permitData` on the quote response, then signing and threading it into `/swap`. A one-line note on the quote endpoint that a permit step may follow would make this discoverable.

## Suggestions

- Either index Base Sepolia pools in the Trading API, or state plainly at the top of the docs that the Trading API is mainnet-only, so teams do not lose hours assuming their request shape is wrong.
- Add a short "which router am I calling" page that spells out the `exactInputSingle` struct per router version (the missing `deadline` on SwapRouter02 especially).
- Surface in the quote response whether the route is UniswapX versus a direct on-chain swap, and return a structured "below minimum order size" error instead of an opaque non-route.
- Call out in the quickstart that `Accept: application/json` is required and that a Permit2 signing step may follow a quote.

## Ease of use

**6 / 10.** The mainnet Trading API path is genuinely easy. The score is held down by the testnet gap and the router-version struct difference, both of which were avoidable time sinks rather than hard problems.
