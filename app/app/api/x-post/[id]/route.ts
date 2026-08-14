import { NextResponse } from "next/server";

/**
 * Read-only X post proxy, normalised to the exact shape PostRegistry.AttestedPost
 * expects.
 *
 * WHY THIS EXISTS AT ALL — the security constraint that shapes the whole FDC path.
 *
 * FDC's Web2Json attestation commits the entire `requestBody` on-chain: the url, the
 * headers, the query params, all of it, carried inside the attested Response and
 * readable by anyone forever. Putting an X API bearer token in `headers` would therefore
 * publish that credential permanently and irrevocably.
 *
 * So the token cannot travel with the attestation request. It lives here, server-side,
 * and FDC attests THIS endpoint instead of api.x.com.
 *
 * That reintroduces a trusted hop, and the submission says so plainly rather than
 * claiming an end-to-end trustless path we do not have. The mitigations are that this
 * route is deliberately incapable of much: the upstream host is fixed, the only input is
 * a numeric id, it performs no interpretation or filtering, and it returns exactly four
 * fields. It can relay faithfully or it can fail. The alternative — leaking the
 * credential on-chain forever — is strictly worse.
 *
 * Note also that FDC verifiers fetch this URL INDEPENDENTLY, several times, to reach
 * consensus. So it must be cheap, cacheable, and stable: two verifiers fetching the same
 * post must see byte-identical output or the attestation will not converge.
 */

const X_API_BASE = "https://api.x.com/2/tweets";

/** X post ids are snowflakes: digits only. Anchored, length-bounded, no interpretation. */
const POST_ID_PATTERN = /^[0-9]{1,25}$/;

/**
 * Cached because the verifiers hammer this endpoint and because X rate limits hard.
 * A post's text and timestamp are immutable once published — if they change, that is
 * precisely the divergence PostRegistry is designed to surface, and it will be caught by
 * a fresh attestation rather than by a stale cache.
 */
export const revalidate = 3600;

interface AttestedPostDto {
  postId: string;
  author: string;
  text: string;
  /** Unix seconds. */
  createdAt: number;
}

interface XApiResponse {
  data?: { id: string; text: string; created_at?: string; author_id?: string };
  includes?: { users?: Array<{ id: string; username: string }> };
  errors?: Array<{ detail?: string; title?: string }>;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Validate before touching the network. This is the SSRF guard: `id` is interpolated
  // into an upstream URL, so anything other than digits is refused outright rather than
  // escaped and hoped for.
  if (!POST_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "invalid post id" }, { status: 400 });
  }

  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    // Explicit 503 rather than a silent empty response: a missing credential is an
    // operator error, and an attestation built on a fabricated empty post would be far
    // worse than a failed one.
    return NextResponse.json({ error: "X_BEARER_TOKEN is not configured" }, { status: 503 });
  }

  const url = `${X_API_BASE}/${id}?tweet.fields=created_at&expansions=author_id&user.fields=username`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate },
    });
  } catch (e) {
    return NextResponse.json({ error: `upstream request failed: ${e}` }, { status: 502 });
  }

  if (!upstream.ok) {
    // Pass the status through (429 and 404 are both meaningful to the caller) but never
    // the body, which can echo request details.
    return NextResponse.json({ error: `upstream returned ${upstream.status}` }, { status: 502 });
  }

  const body = (await upstream.json()) as XApiResponse;

  if (!body.data || body.errors?.length) {
    return NextResponse.json({ error: "post not available" }, { status: 404 });
  }

  const author = body.includes?.users?.find((u) => u.id === body.data?.author_id)?.username;
  if (!author || !body.data.created_at) {
    // Missing either field means the DTO cannot be built honestly. Fail rather than
    // substitute a placeholder that would be attested as fact and then bound to a
    // caller's permanent record.
    return NextResponse.json({ error: "incomplete post data" }, { status: 502 });
  }

  // Normalise the timestamp HERE rather than in the attestation's jq filter. X returns
  // ISO-8601 with fractional seconds ("2026-08-14T10:30:00.000Z"), which jq's
  // `fromdateiso8601` does not parse — it would fail inside the verifier, where the
  // error is far harder to see than it is here.
  const createdAt = Math.floor(new Date(body.data.created_at).getTime() / 1000);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return NextResponse.json({ error: "unparseable created_at" }, { status: 502 });
  }

  const dto: AttestedPostDto = {
    postId: body.data.id,
    author,
    text: body.data.text,
    createdAt,
  };

  // Key order matters. The jq filter and the Solidity struct read these positionally
  // once ABI-encoded, and a reordering would decode into the wrong fields silently
  // rather than failing.
  return NextResponse.json(dto, {
    headers: { "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=86400` },
  });
}
