import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classify } from "@/lib/classify";
import { activeNetwork, addressUrl } from "@/lib/flare";
import { feedIdForSymbol } from "@/lib/feeds";
import { readFeedBySymbol, wadToNumber } from "@/lib/ftso";

/**
 * Evidence for one call. GET /api/verify/[callId]
 *
 * This is the page that has to survive a hostile reader, so it reports the evidence
 * chain link by link and says plainly which links are actually in place.
 *
 * The pre-Flare version asked one question — "did 0G's router verify the provider's TEE
 * signature?" — and answered it by re-running a paid inference. On Flare there are three
 * independent claims, each guaranteed by a different protocol and each separately
 * checkable:
 *
 *   EVIDENCE   (FDC)  the post existed, with this text, at this time
 *   JUDGEMENT  (FCC)  a registered TEE machine classified it under sealed weights
 *   PRICE     (FTSO)  the entry and settle marks came from the oracle
 *
 * A link that is not yet established is reported as `pending` with the reason. It is
 * never reported as verified, and never quietly omitted — a verification page that hides
 * its gaps is worse than no verification page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const db = getDb();

  const row = db
    .prepare(
      `SELECT p.content     AS content,
              p.posted_at   AS posted_at,
              p.x_post_id   AS x_post_id,
              c.asset_symbol AS asset_symbol,
              c.direction   AS direction
         FROM calls c JOIN posts p ON p.id = c.post_id
        WHERE c.id = ?`,
    )
    .get(callId) as
    | { content: string; posted_at: number; x_post_id: string; asset_symbol: string | null; direction: string | null }
    | undefined;

  if (!row) {
    return NextResponse.json({ status: "unavailable", verified: false, detail: "call not found" }, { status: 404 });
  }

  const net = activeNetwork();
  const postRegistry = process.env.NEXT_PUBLIC_POST_REGISTRY_ADDRESS ?? null;
  const callTape = process.env.NEXT_PUBLIC_CALL_TAPE_ADDRESS ?? null;

  // ---- link 1: evidence (FDC) ------------------------------------------------
  //
  // Only an on-chain PostRegistry entry can establish this. Until the contracts are
  // deployed there is nothing to check, and saying so is the honest answer.
  const evidence = postRegistry
    ? {
        status: "deployed" as const,
        protocol: "FDC",
        contract: postRegistry,
        explorer: addressUrl(postRegistry, net),
        detail:
          "PostRegistry verifies a Web2Json Merkle proof on-chain before storing anything. Re-attesting the same post with different text emits ContentDiverged and keeps the original authoritative.",
      }
    : {
        status: "pending" as const,
        protocol: "FDC",
        detail:
          "PostRegistry is not yet deployed on this network, so this post has not been attested. Until it is, the record rests on our database — which is exactly the dependency this product exists to remove.",
      };

  // ---- link 2: judgement (FCC) -----------------------------------------------
  //
  // The local classifier is a PREVIEW of the enclave's verdict, not a substitute for it.
  // It is byte-identical to the enclave source and deterministic, so it predicts the
  // signed verdict reliably — but a prediction is not an attestation and is not labelled
  // as one.
  const preview = classify(row.content);
  const judgement = {
    status: "preview" as const,
    protocol: "FCC",
    signal: {
      template: preview.template,
      assetSymbol: preview.assetSymbol,
      direction: preview.direction,
      expiryDays: preview.expiryDays,
      confidence: preview.confidence,
    },
    teeVerified: null,
    detail:
      "Classification shown here is the local mirror of the enclave classifier — identical source, fully deterministic, so it predicts the TEE's verdict. It is NOT a TEE attestation. The signed verdict is written on-chain by a registered TEE machine once the extension is live.",
    sealed:
      "Ranking weights never leave the enclave. They are provisioned encrypted after attestation and are not compiled into the image, because the image is open source and reproducibly built — anything inside it would be public.",
  };

  // ---- link 3: price (FTSOv2) ------------------------------------------------
  //
  // The one link that can be demonstrated live right now, with no deployment: FTSO is
  // already running on Coston2 and anyone can read the same feed and get the same answer.
  let price: Record<string, unknown>;
  if (!row.asset_symbol) {
    price = {
      status: "unpriceable",
      protocol: "FTSOv2",
      detail: "This call names no asset, so there is no feed to mark it against.",
    };
  } else {
    const feedId = feedIdForSymbol(row.asset_symbol);
    try {
      const mark = await readFeedBySymbol(row.asset_symbol, net);
      price = mark
        ? {
            status: mark.stale ? "stale" : "live",
            protocol: "FTSOv2",
            feedId,
            symbol: `${row.asset_symbol.toUpperCase()}/USD`,
            priceUsd: wadToNumber(mark.priceWad),
            feedTimestamp: mark.timestampSec,
            ageSeconds: mark.ageSec,
            detail: mark.stale
              ? `The feed last updated ${mark.ageSec}s ago, beyond the staleness window. CallTape would refuse to mark against it.`
              : "Read live from FTSOv2 via the Flare contract registry. Anyone can read the same feed id and get the same value.",
          }
        : {
            status: "no_feed",
            protocol: "FTSOv2",
            feedId,
            detail: `FTSOv2 carries no feed for $${row.asset_symbol}. This call is recorded as unpriceable rather than marked against something approximate.`,
          };
    } catch (e) {
      price = {
        status: "unavailable",
        protocol: "FTSOv2",
        feedId,
        detail: `Could not reach FTSOv2: ${(e as Error).message?.slice(0, 140) || "unknown error"}.`,
      };
    }
  }

  // Verified means every link is established — not "most of them", and not "the ones we
  // could check cheaply".
  const verified = evidence.status === "deployed" && judgement.status !== "preview" && price.status === "live";

  return NextResponse.json({
    verified,
    status: verified ? "verified" : "partial",
    network: { name: net.label, chainId: net.chainId, explorer: net.explorer },
    contracts: { postRegistry, callTape },
    chain: { evidence, judgement, price },
    detail: verified
      ? "Every link in the evidence chain is established on-chain."
      : "Some links are not yet established. Each is reported above with the reason, rather than being omitted.",
  });
}
