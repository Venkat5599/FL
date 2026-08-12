# KOLlateral — Frontend Feature Spec (functional only)

> **Purpose:** build and test the frontend *functionality* first — routing, data, actions, states — with **no styling / UI / UX**. Plain, unstyled elements are fine. Visual design is a separate later pass. This doc is the checklist for a full frontend functional test.

**Status legend:** ✅ built · 🟡 partial · ⛔ not built

---

## Global (applies to all pages)

- **Wallet:** connect / disconnect via wagmi; show connected address; target chain **Base Sepolia (84532)**. Show a "wrong network" notice if connected elsewhere.
- **Data source:** everything reads from the app's own API routes (never a live external call from the browser except the wallet). Existing routes:
  - `GET /api/dossier/[handle]` — full dossier (stats, calls, saidVsDid)
  - `GET /api/feed` — recent calls across influencers
  - `GET /api/receipt/[callId]` — 0G artifact for one call
  - `GET /api/og/[handle]` — share-card PNG
  - `POST /api/quote` — Uniswap quote / permit / swap proxy
  - `POST /api/txlog` — log an executed swap hash
- **Every page needs three states:** loading, empty, error (never a blank screen or a crash).
- **No fabricated data:** if an API returns nothing, show the empty state — never placeholder/fake numbers.

---

## Page 1 — Home / Search  ⛔ NOT BUILT
**Route:** `/`  ·  **Replaces:** the current `create-next-app` boilerplate.

**Features**
- Search input for an influencer handle → on submit, navigate to `/k/<handle>`.
- "Trending / indexed" list: show the influencers already in the DB with their headline P&L % and call count; click → their dossier.
- Non-indexed handle: show a clear "not indexed yet" state (queue/scrape is a later enhancement, not required for the test).

**States:** default (with trending list) · loading trending · empty (no influencers indexed) · searching.

**Actions:** type handle · submit (Enter or button) · click a trending row.

**New backend needed:** `GET /api/influencers` → list of `{handle, display_name, headlinePct, callCount}` for the trending list. (Thin SQL over `influencers` + a lightweight per-handle stat; can reuse `buildDossier` stats or a dedicated query.)

---

## Page 2 — Dossier  ✅ BUILT (verify with seed data)
**Route:** `/k/[handle]`  ·  **Data:** `GET /api/dossier/[handle]`

**Features**
- **Verdict block:** headline % ($1,000-per-call vs actual), the two dollar sentences (followed-every-call vs held-ETH), settled count, win rate.
- **Equity curve:** cumulative call P&L vs cumulative ETH benchmark over the call dates.
- **Stat strip:** win rate · call count · deleted-call count · (avg hold optional).
- **Integrity stat (NEW):** from `dossier.integrity` — surface "Deleted N calls, avg X%, $Y of losses hidden" (`deletedTotal`, `deletedScored`, `deletedAvgRetPct`, `deletedHiddenLoss`). Deleted calls still count in the P&L; this makes the deletion behavior visibly damning.
- **Tabs:** `Calls` | `Said vs. Did`.
- **Calls tab — ledger table:** per row → post text (links to the original X post, new tab), asset symbol, direction (long/short), entry→latest price, return % (colored by sign), badges (🗑️ deleted / ⏳ open / ✓ has-receipt). **Filters:** All / Deleted / Ambiguous.
- **Said vs. Did tab:** dual list (posts vs wallet swaps) on a shared time order, contradiction rows linking a post to a wallet sell, case card per contradiction (post + tx link + "sold Xh after"), attribution disclaimer line.
- **Row click** on a call → opens **Call Detail** (Page 3).
- **Share:** link to `/api/og/[handle]` (the PNG card).

**States:** loading · 404 handle-not-found · empty (no scored calls) · Said-vs-Did: no-linked-wallet / no-contradictions.

**Note:** page currently renders client-side (empty HTML until JS). Fine for functional test; SSR/loading polish is a styling-session item.

---

## Page 3 — Call Detail  🟡 BUILT (provider_address fix in flight)
**Route:** slide-over/panel within the dossier  ·  **Data:** `GET /api/receipt/[callId]`

**Features**
- Archived post render: text, timestamp, link to original X post.
- Parsed-signal box: template · asset · direction · expiry · confidence.
- **Receipt strip:** content hash · 0G chatId · TEE signature · provider address · **verified badge** (NEW — from `receipt.verified`: green "TEE-verified ✓" on mainnet/TeeML, honest "unverified on this provider" on testnet/TeeTLS; never fakes) · "verify →" link.
- Deleted banner when the post was deleted.
- **"Report deleted" button (NEW):** POST `/api/report-deleted` `{callId}` → verifies the tweet is actually gone on X before marking it (rejects false reports). On success the 🗑️ badge + integrity stat update.
- **FADE / FOLLOW ticket** embedded at the bottom (see Page 4 flow) — this is the swap entry point today.

**States:** loading receipt · receipt missing (404 → placeholders, no crash) · deleted.

**Pending:** `provider_address` population (backend task 14). TEE-label wording depends on the verify-vs-downgrade decision (styling-session copy).

---

## Page 4 — Terminal  ⛔ NOT BUILT
**Route:** `/terminal`  ·  **Data:** `GET /api/feed` (already exists)

**Features**
- **Live feed of call cards** — poll `/api/feed` on an interval. Each card: handle, parsed signal (asset/direction/expiry), and the **caller's track-record pill** (their win rate / P&L).
- **FADE / FOLLOW** buttons per card → the `FadeTicket` flow (quote → permit sign → swap → tx hash logged via `/api/txlog`).
- **Open positions panel:** each executed swap paired with the call it tracks ("you FADED @x's $PEPE long"), settling at the call's expiry (you-vs-them).
- Filters: by influencer / by template (optional for the test).

**States:** empty feed · loading · wallet-not-connected (buttons disabled with a prompt).

**Backend notes:** `/api/feed` exists; to show the per-card track-record pill it may need to include a per-influencer summary (enhance `/api/feed`) or the card fetches `/api/dossier` stats. Decide during build.

---

## Page 5 — Claim & Stake  ⛔ NOT BUILT  (scope decision pending)
**Route:** `/k/[handle]/claim` (or a modal on the dossier)

**Features**
- **Claim flow:** issue a nonce → influencer posts it from their X account (tweet-to-verify) → verify → mark `influencers.claimed`. Connect wallet as part of claiming.
- **Context replies:** a claimed influencer can add a context note to any of their calls (displayed, never deletes the call).
- **Stake flow:** back a specific call with a stake; show the terms (returned + badge if the call beats benchmark at expiry, else forfeited to a pool); staked calls render with a "$X staked" badge everywhere.

**States:** unclaimed · claim-pending (nonce posted, awaiting verify) · claimed.

**SCOPE DECISION (locked): UI states only.** Build the *visual/flow* states, no real escrow:
- Claim flow: nonce issue → "post this to verify" → a verify button that flips `influencers.claimed` (the tweet-check can be manual/simulated for the demo).
- Staked-call badge: a "$X staked" visual state on call rows/cards (data can be a simple `claimed`/`staked` flag, no on-chain escrow).
- Be honest in the pitch: "staking flow demonstrated; escrow settlement is the next step."

**Backend for UI-states scope:** minimal — a `POST /api/claim` that verifies a nonce and sets `influencers.claimed`, and a `staked` boolean (column or small table) toggled for badge rendering. No escrow contract, no `POST /api/stake` settlement.

---

## New backend endpoints implied by the frontend
| Endpoint | For | Needed by |
|---|---|---|
| `GET /api/influencers` | Home trending list | Page 1 |
| enhance `GET /api/feed` (add caller track-record) | Terminal cards | Page 4 |
| `POST /api/claim`, `POST /api/stake` | Claim & Stake | Page 5 (if built) |

## Full frontend functional-test checklist
- [ ] Wallet connects on Base Sepolia; wrong-network notice works.
- [ ] Home: search → dossier; trending list renders from real DB.
- [ ] Dossier: verdict, curve, ledger, filters, both tabs render from seed data.
- [ ] Call Detail: opens on row click; receipt strip populated; deleted banner shows.
- [ ] Terminal: feed polls and renders; FADE/FOLLOW opens the ticket.
- [ ] FADE/FOLLOW: quote → permit → swap → hash logged (needs testnet funds).
- [ ] Claim & Stake (if in scope): nonce issue/verify, stake states.
- [ ] Every page: loading + empty + error states verified.
