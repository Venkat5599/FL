import { NextResponse } from "next/server";

// Server-side only: UNISWAP_API_KEY never reaches the client. Same base URL
// for mainnet and testnet — Base Sepolia quotes hit this exact endpoint.
const BASE = "https://trade-api.gateway.uniswap.org/v1";

function headers() {
  return {
    "x-api-key": process.env.UNISWAP_API_KEY!,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

interface QuoteRequestBody {
  action?: "approval" | "quote" | "swap";
  tokenIn: string;
  tokenOut: string;
  amount: string;
  swapper: string;
  chainId: number;
  // check_approval passthrough fields
  walletAddress?: string;
  token?: string;
  // action "swap": the inner routing quote, the Permit2 signature the client
  // produced over permitData, and the permitData itself (forwarded to Uniswap).
  quote?: unknown;
  signature?: string;
  permitData?: unknown;
}

// Reads the response body as JSON if possible, falling back to raw text so
// upstream error payloads (which aren't guaranteed to be JSON) are never lost.
async function readBody(r: Response): Promise<unknown> {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function upstreamError(r: Response, detail: unknown) {
  return Response.json(
    { error: "uniswap_api_error", status: r.status, detail },
    { status: 502 },
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as QuoteRequestBody;
    const action = body.action ?? "quote";

    if (action === "approval") {
      const approvalRes = await fetch(`${BASE}/check_approval`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          walletAddress: body.walletAddress ?? body.swapper,
          token: body.token ?? body.tokenIn,
          amount: body.amount,
          chainId: body.chainId,
        }),
      });
      if (!approvalRes.ok) {
        return upstreamError(approvalRes, await readBody(approvalRes));
      }
      const approval = await approvalRes.json();
      return NextResponse.json({ step: "approval", approval });
    }

    // Complete a permit-gated swap: the client signed permitData and sends the
    // signature back here; forward it to Uniswap's /swap to get final calldata.
    if (action === "swap") {
      const swapRes = await fetch(`${BASE}/swap`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          quote: body.quote,
          signature: body.signature,
          permitData: body.permitData,
        }),
      });
      if (!swapRes.ok) {
        return upstreamError(swapRes, await readBody(swapRes));
      }
      const swap = await swapRes.json();
      return NextResponse.json({ step: "swap", swap });
    }

    const quoteRes = await fetch(`${BASE}/quote`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        type: "EXACT_INPUT",
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        tokenInChainId: body.chainId,
        tokenOutChainId: body.chainId,
        amount: body.amount,
        swapper: body.swapper,
        autoSlippage: "DEFAULT",
        // ALWAYS restrict to on-chain protocols: UniswapX carries a $300
        // minimum order size that breaks the small demo swap amounts here.
        protocols: ["V2", "V3", "V4"],
      }),
    });
    if (!quoteRes.ok) {
      return upstreamError(quoteRes, await readBody(quoteRes));
    }
    const quote = await quoteRes.json();

    if (quote.permitData) {
      return NextResponse.json({ step: "permit", quote });
    }

    const swapRes = await fetch(`${BASE}/swap`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ quote: quote.quote }),
    });
    if (!swapRes.ok) {
      return upstreamError(swapRes, await readBody(swapRes));
    }
    const swap = await swapRes.json();

    return NextResponse.json({ step: "swap", quote, swap });
  } catch (e) {
    return Response.json(
      { error: "proxy_exception", detail: String(e) },
      { status: 500 },
    );
  }
}
