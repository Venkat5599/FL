import OpenAI from "openai";
import { SignalSchema, type Signal } from "./signal-schema";

export type Classification = {
  signal: Signal | null;
  raw: unknown;
  chatId: string | null;
  teeSignature: string | null;
  providerAddress: string | null;
  // 0G router's on-chain TEE verification result (from x_0g_trace.tee_verified
  // when the request opts in with verify_tee:true). null when not requested or
  // the provider is TeeTLS (no per-response signature).
  teeVerified: boolean | null;
};

// Endpoint + default model are env-configurable so the same code runs against
// the 0G mainnet Private Computer or the testnet router without edits:
//   ZG_BASE_URL (default mainnet router), ZG_MODEL (default DeepSeek-V3.1).
const ZG_BASE_URL = process.env.ZG_BASE_URL || "https://router-api.0g.ai/v1";
const ZG_DEFAULT_MODEL = process.env.ZG_MODEL || "deepseek-ai/DeepSeek-V3.1";

// Lazy-init: instantiating OpenAI eagerly at module load would throw at
// import time (and in tests) whenever ZG_API_KEY is unset. Building the
// client on first use keeps `parseToolCall` importable with no env vars.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: ZG_BASE_URL,
      apiKey: (process.env.ZG_API_KEY || "").trim(),
      // Pin to a TEE-backed (private) provider so verify_tee can produce an
      // on-chain-verified response on models that support it.
      defaultHeaders: { "X-0G-Provider-Trust-Mode": "private" },
    });
  }
  return client;
}

const TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "emit_trade_signal",
    description: "Classify a crypto post as a trade signal using the closed template set.",
    parameters: {
      type: "object",
      properties: {
        template: { enum: ["DIRECTIONAL", "TARGET_CALL", "GEM_SHILL", "NOT_A_SIGNAL"] },
        asset_symbol: { type: ["string", "null"] },
        direction: { enum: ["long", "short", null] },
        expiry_days: { type: ["number", "null"] },
        confidence: { type: "number" },
      },
      required: ["template", "confidence"],
    },
  },
};

const SYSTEM = `You classify a crypto X post into ONE trade-signal template via the emit_trade_signal tool.

A post is a SIGNAL only if it makes an EXPLICIT tradeable call on a specific token:
- DIRECTIONAL: says to long/short a token (e.g. "longing ETH", "short SOL").
- TARGET_CALL: names a token with an entry/target/price prediction (e.g. "$PEPE to $0.00003").
- GEM_SHILL: hypes a token to buy (e.g. "$WIF is the next 10x").
Otherwise (news, commentary, macro takes, sarcasm, memes, questions, retrospectives, no specific token) => NOT_A_SIGNAL.

When it IS a signal you MUST fill:
- asset_symbol: the bare ticker WITHOUT the $ sign, uppercase (e.g. PEPE, ETH, WIF). Never null for a signal.
- direction: "long" for buy/bullish calls (default when a token is hyped), "short" for bearish.
- expiry_days: number of days if a timeframe is stated, else null.
- confidence: 0-1, how sure you are this is a real explicit call.
For NOT_A_SIGNAL set asset_symbol null and confidence low.

Examples:
"$PEPE about to 10x 🚀" -> {template:"GEM_SHILL", asset_symbol:"PEPE", direction:"long", expiry_days:null, confidence:0.9}
"Longing ETH here, target $4000 by month end" -> {template:"TARGET_CALL", asset_symbol:"ETH", direction:"long", expiry_days:30, confidence:0.9}
"gm frens, beautiful day" -> {template:"NOT_A_SIGNAL", asset_symbol:null, direction:null, expiry_days:null, confidence:0.0}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts loosely-shaped SDK/test completions
export function parseToolCall(completion: any): Signal | null {
  const tc = completion?.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc || tc.function?.name !== "emit_trade_signal") return null;
  let args: unknown;
  try {
    args = JSON.parse(tc.function.arguments);
  } catch {
    return null;
  }
  const parsed = SignalSchema.safeParse(args);
  return parsed.success ? parsed.data : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ProviderAttestation = {
  address: string;
  modelId: string | null;
  verifiability: string | null; // "TeeML" | "TeeTLS"
  teeType: string | null; // e.g. "TDX"
  teeVerifier: string | null; // e.g. "dstack"
  teeAttested: boolean;
  trustMode: string | null;
  providerName: string | null;
};

// Fetch a serving provider's attestation record from the 0G router registry
// (GET /providers). This is 0G's own data, not ours — it states the provider's
// TEE type, attestation framework, and verifiability, so the "verified" claim
// is backed by an independent, reproducible source.
export async function providerAttestation(address: string): Promise<ProviderAttestation | null> {
  try {
    const res = await fetch(`${ZG_BASE_URL}/providers`, {
      headers: { Authorization: `Bearer ${(process.env.ZG_API_KEY || "").trim()}` },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: Record<string, unknown>[] };
    const p = (d.data ?? []).find(
      (x) => String(x.address ?? "").toLowerCase() === address.toLowerCase(),
    );
    if (!p) return null;
    return {
      address: String(p.address),
      modelId: (p.model_id as string) ?? null,
      verifiability: (p.verifiability as string) ?? null,
      teeType: (p.tee_type as string) ?? null,
      teeVerifier: (p.tee_verifier as string) ?? null,
      teeAttested: p.tee_attested === true,
      trustMode: (p.trust_mode as string) ?? null,
      providerName: (p.provider_name as string) ?? null,
    };
  } catch {
    return null;
  }
}

// HTTP statuses worth retrying (transient); everything else fails fast so the
// caller sees the real error (e.g. 401 bad key, 402 insufficient balance).
function isTransient(status: number | undefined): boolean {
  return status === 429 || status === 408 || (status !== undefined && status >= 500);
}

export async function classifyPost(
  text: string,
  postedAt: number,
  model = ZG_DEFAULT_MODEL,
  retries = 2
): Promise<Classification> {
  const postedAtIso = new Date(postedAt * 1000).toISOString();
  for (let i = 0; i <= retries; i++) {
    let data: OpenAI.Chat.ChatCompletion;
    let response: Response;
    try {
      // verify_tee is a 0G router extension (not in the OpenAI types): it asks
      // the router to perform on-chain TEE signature verification and return
      // the result in x_0g_trace.tee_verified.
      const params = {
        model,
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "emit_trade_signal" } },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Posted at: ${postedAtIso}\n\n${text}` },
        ],
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { verify_tee?: boolean };
      params.verify_tee = true;
      const res = await getClient().chat.completions.create(params).withResponse();
      data = res.data;
      response = res.response;
    } catch (err) {
      // Transient (rate limit / 5xx / network): back off and retry. Permanent
      // errors (bad key, insufficient balance) and the final attempt re-throw
      // so the pipeline can log the real cause and continue to the next post.
      const status = (err as { status?: number }).status;
      if (i < retries && (isTransient(status) || status === undefined)) {
        await sleep(1000 * (i + 1));
        continue;
      }
      throw err;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- x_0g_trace is a 0G router extension not in the OpenAI types
    const teeVerified = (data as any)?.x_0g_trace?.tee_verified;
    const signal = parseToolCall(data);
    if (signal) {
      return {
        signal,
        raw: data,
        chatId: data.id ?? null,
        teeSignature: response.headers.get("zg-res-key") ?? null,
        // 0G router identifies the serving node/provider via the `x-provider`
        // response header (confirmed live, also mirrored in the body under
        // `x_0g_trace.provider`) — an on-chain provider address, not a TEE
        // attestation. We surface it as-is; no fabrication if it's ever absent.
        providerAddress: response.headers.get("x-provider") ?? null,
        teeVerified: typeof teeVerified === "boolean" ? teeVerified : null,
      };
    }
  }
  // Reached the retry cap without a parseable tool call: treat as "not a signal"
  // rather than an error (the model answered, just not usefully).
  return { signal: null, raw: null, chatId: null, teeSignature: null, providerAddress: null, teeVerified: null };
}

// ---- 0-YAP: distill the post down to pure trade logic ---------------------
// Powers the terminal's "0-yap" mode. Strips influencer noise (storytelling,
// self-promo, links, hedging) and emits just the directional bias, a one-line
// thesis, and the key price levels — via the same verifiable 0G router path
// (verify_tee) as the classifier.

const PURE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "emit_pure_signal",
    description: "Distill a noisy crypto post into its pure trade signal, stripping all hype and filler.",
    parameters: {
      type: "object",
      properties: {
        bias: { enum: ["long", "short", "neutral"] },
        thesis: { type: "string", description: "One sentence, max 18 words: the actual trade logic. No hype, hedging, emojis, or links." },
        levels: {
          type: "array",
          items: { type: "string" },
          description: "Key price levels / triggers as short strings, e.g. '$1,840 support', 'target $2,000'. Empty if none stated.",
        },
      },
      required: ["bias", "thesis"],
    },
  },
};

const PURE_SYSTEM = `You are a trading desk that strips crypto-influencer posts down to signal. Given a post, emit ONLY the pure trade logic via emit_pure_signal: the directional bias, a one-line thesis (<=18 words, no hype, no hedging, no emojis, no links), and the key price levels/triggers if stated. Cut all storytelling, self-promotion, and filler. If the post has no real trade logic, set bias "neutral" and thesis "No tradeable signal — commentary only.".`;

export type PureSignal = {
  bias: "long" | "short" | "neutral";
  thesis: string;
  levels: string[];
  teeVerified: boolean | null;
};

export async function distillSignal(text: string, model = ZG_DEFAULT_MODEL, retries = 2): Promise<PureSignal | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const params = {
        model,
        tools: [PURE_TOOL],
        tool_choice: { type: "function", function: { name: "emit_pure_signal" } },
        messages: [
          { role: "system", content: PURE_SYSTEM },
          { role: "user", content: text },
        ],
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { verify_tee?: boolean };
      params.verify_tee = true;
      const res = await getClient().chat.completions.create(params).withResponse();
      const data = res.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- x_0g_trace is a 0G router extension
      const teeVerified = (data as any)?.x_0g_trace?.tee_verified;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool_calls shape
      const tc = (data as any)?.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.name === "emit_pure_signal") {
        const args = JSON.parse(tc.function.arguments || "{}");
        return {
          bias: args.bias === "long" || args.bias === "short" ? args.bias : "neutral",
          thesis: typeof args.thesis === "string" ? args.thesis.trim() : "",
          levels: Array.isArray(args.levels) ? args.levels.filter((x: unknown) => typeof x === "string").slice(0, 5) : [],
          teeVerified: typeof teeVerified === "boolean" ? teeVerified : null,
        };
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (i < retries && (isTransient(status) || status === undefined)) {
        await sleep(1000 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  return null;
}
