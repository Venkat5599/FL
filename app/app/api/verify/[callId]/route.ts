import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classifyPost, providerAttestation } from "@/lib/zg";

// Live 0G TEE verification for one call, with independent evidence.
// Re-runs the post through the 0G router with verify_tee:true (pinned to a
// private/TEE provider); the router performs on-chain signature verification
// and returns x_0g_trace.tee_verified. We also pull the provider's attestation
// record from 0G's own /providers registry so the "verified" result is backed
// by reproducible, 0G-sourced evidence (TEE type, verifier, verifiability),
// not just our word. Costs one small inference.
export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.content as content, p.posted_at as posted_at
       FROM calls c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`
    )
    .get(callId) as { content: string; posted_at: number } | undefined;

  if (!row) {
    return NextResponse.json({ status: "unavailable", verified: false, detail: "call not found" });
  }

  try {
    const c = await classifyPost(row.content, row.posted_at);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- x_0g_trace is a 0G router extension
    const trace = (c.raw as any)?.x_0g_trace ?? {};
    const requestId: string | null = trace.request_id ?? null;
    const attestation = c.providerAddress ? await providerAttestation(c.providerAddress) : null;

    if (c.teeVerified === true) {
      return NextResponse.json({
        status: "verified",
        verified: true,
        provider: c.providerAddress,
        requestId,
        attestation,
        trace,
        detail: "The 0G router verified the provider's on-chain TEE signature for this inference (verify_tee).",
      });
    }
    if (c.teeVerified === false) {
      return NextResponse.json({
        status: "failed",
        verified: false,
        provider: c.providerAddress,
        requestId,
        attestation,
        detail: "The provider's TEE signature did not verify on-chain.",
      });
    }
    return NextResponse.json({
      status: "unavailable",
      verified: false,
      provider: c.providerAddress,
      attestation,
      detail:
        "This model is served with transport-layer (TeeTLS) attestation and returns no per-response signature. Use a TeeML model (e.g. 0gm-1.0-35b-a3b) for an on-chain-verified check.",
    });
  } catch (e) {
    return NextResponse.json({
      status: "unavailable",
      verified: false,
      detail: `Verification could not run: ${(e as Error).message?.slice(0, 140) || "unknown error"}.`,
    });
  }
}
