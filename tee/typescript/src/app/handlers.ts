/**
 * TAPE confidential scoring extension — instruction handlers.
 *
 * Three commands, and the split between them is the design:
 *
 *   WEIGHTS   provision the sealed ranking coefficients (encrypted, decrypted in-enclave)
 *   CLASSIFY  attested post -> structured trade signal   (open logic, run for integrity)
 *   RANK      a caller's on-chain record -> score        (sealed logic, the secret part)
 *
 * Every handler is deterministic given its inputs. No clocks that affect output, no
 * network calls except the local TEE node's /decrypt, no randomness. That is what makes
 * the enclave's attested code hash a meaningful statement about the result.
 */

import http from "node:http";
import { decodeAbiParameters, encodeAbiParameters } from "viem";

import { Framework } from "../base/types.js";
import { bytesToHex, hexToBytes } from "../base/encoding.js";
import {
  OP_COMMAND_CLASSIFY,
  OP_COMMAND_RANK,
  OP_COMMAND_WEIGHTS,
  OP_TYPE_SCORE,
  STATUS_ERROR,
  STATUS_OK,
  VERSION,
} from "./config.js";
import { classify, confidenceBps, type Signal } from "./classify.js";
import {
  hasWeights,
  parseWeights,
  rankCaller,
  requireWeights,
  setWeights,
  type SettledCall,
} from "./scoring.js";

let signPort = "9090";

/** Counters for GET /state. Operational visibility only — never affects a result. */
let classifyCount = 0;
let rankCount = 0;
let weightsVersion = 0;

export function setSignPort(port: string): void {
  signPort = port;
}

export function register(framework: Framework): void {
  framework.handle(OP_TYPE_SCORE, OP_COMMAND_WEIGHTS, handleWeights);
  framework.handle(OP_TYPE_SCORE, OP_COMMAND_CLASSIFY, handleClassify);
  framework.handle(OP_TYPE_SCORE, OP_COMMAND_RANK, handleRank);
}

/**
 * State exposed on GET /state.
 *
 * Deliberately reports only *whether* weights are loaded and how many times they have
 * been rotated — never the weights themselves, nor anything derived from them. This
 * endpoint is reachable through the extension proxy, so anything returned here should be
 * treated as public.
 */
export function reportState(): unknown {
  return {
    version: VERSION,
    weightsLoaded: hasWeights(),
    weightsVersion,
    classifyCount,
    rankCount,
  };
}

/** Test-only. */
export function resetCounters(): void {
  classifyCount = 0;
  rankCount = 0;
  weightsVersion = 0;
}

// ---- WEIGHTS ----------------------------------------------------------------

/**
 * Receive encrypted ranking weights, decrypt inside the enclave, validate, and hold in
 * memory.
 *
 * The ciphertext travels on-chain, which is public and permanent. That is acceptable
 * only because it is encrypted to the TEE's key and nothing else can open it — the
 * plaintext never touches the chain, this process's logs, or /state.
 */
async function handleWeights(msg: string): Promise<[string | null, number, string | null]> {
  if (!msg) return [null, STATUS_ERROR, "originalMessage is empty"];

  let ciphertext: Uint8Array;
  try {
    ciphertext = hexToBytes(msg);
  } catch (e) {
    return [null, STATUS_ERROR, `invalid hex in originalMessage: ${e}`];
  }

  let plaintext: Uint8Array;
  try {
    plaintext = await decryptViaNode(ciphertext);
  } catch (e) {
    return [null, STATUS_ERROR, `decryption failed: ${e}`];
  }

  try {
    // parseWeights rejects malformed input rather than coercing it. Coercion here would
    // produce NaN scores that get signed by an attested machine and written on-chain as
    // though they meant something — an authentic signature over garbage.
    const weights = parseWeights(new TextDecoder().decode(plaintext));
    setWeights(weights);
    weightsVersion++;
  } catch (e) {
    return [null, STATUS_ERROR, `${e}`];
  }

  // Note the absence of the weights in this log line, and in the return value.
  console.log(`ranking weights provisioned (rotation ${weightsVersion})`);
  return [null, STATUS_OK, null];
}

// ---- CLASSIFY ---------------------------------------------------------------

const CLASSIFY_INPUT = [{ type: "uint256" }, { type: "string" }] as const;

/**
 * Result written back on-chain.
 * (postId, direction, confidenceBps, symbol, expiryDays, isSignal)
 * direction: 0 = none, 1 = long, 2 = short — matching CallTape.Direction exactly.
 */
const CLASSIFY_OUTPUT = [
  { type: "uint256" },
  { type: "uint8" },
  { type: "uint16" },
  { type: "string" },
  { type: "uint32" },
  { type: "bool" },
] as const;

function directionToEnum(signal: Signal): number {
  if (signal.direction === "long") return 1;
  if (signal.direction === "short") return 2;
  return 0;
}

async function handleClassify(msg: string): Promise<[string | null, number, string | null]> {
  if (!msg) return [null, STATUS_ERROR, "originalMessage is empty"];

  let postId: bigint;
  let text: string;
  try {
    const [id, t] = decodeAbiParameters(CLASSIFY_INPUT, msg as `0x${string}`);
    postId = id as bigint;
    text = t as string;
  } catch (e) {
    return [null, STATUS_ERROR, `failed to decode classify message: ${e}`];
  }

  // The contract has already proved this text hashes to the attested contentHash, so the
  // enclave can treat it as the genuine post without re-checking against FDC here.
  const signal = classify(text);
  classifyCount++;

  const isSignal = signal.template !== "NOT_A_SIGNAL";
  const encoded = encodeAbiParameters(CLASSIFY_OUTPUT, [
    postId,
    directionToEnum(signal),
    confidenceBps(signal),
    signal.assetSymbol ?? "",
    signal.expiryDays ?? 0,
    isSignal,
  ]);

  return [encoded, STATUS_OK, null];
}

// ---- RANK -------------------------------------------------------------------

/** Mirrors CallTape.SettledCall exactly. */
const SETTLED_CALL_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "pnlBps", type: "int256" },
    { name: "postedAt", type: "uint64" },
    { name: "settledAt", type: "uint64" },
    { name: "confidenceBps", type: "uint16" },
  ],
} as const;

const RANK_INPUT = [{ type: "bytes32" }, SETTLED_CALL_TUPLE] as const;

/** (authorHash, scoreBps, sampleSize, contradictions) */
const RANK_OUTPUT = [
  { type: "bytes32" },
  { type: "uint16" },
  { type: "uint32" },
  { type: "uint32" },
] as const;

interface RawSettledCall {
  pnlBps: bigint;
  postedAt: bigint;
  settledAt: bigint;
  confidenceBps: number;
}

async function handleRank(msg: string): Promise<[string | null, number, string | null]> {
  if (!msg) return [null, STATUS_ERROR, "originalMessage is empty"];

  let authorHash: string;
  let raw: readonly RawSettledCall[];
  try {
    const [hash, calls] = decodeAbiParameters(RANK_INPUT, msg as `0x${string}`);
    authorHash = hash as string;
    raw = calls as unknown as readonly RawSettledCall[];
  } catch (e) {
    return [null, STATUS_ERROR, `failed to decode rank message: ${e}`];
  }

  if (raw.length === 0) return [null, STATUS_ERROR, "no settled calls to rank"];

  const calls: SettledCall[] = raw.map((c) => ({
    pnlBps: Number(c.pnlBps),
    postedAt: Number(c.postedAt),
    settledAt: Number(c.settledAt),
    confidenceBps: Number(c.confidenceBps),
    // Wallet contradictions are not yet part of the on-chain record; until the
    // Said-vs-Did index lands they are reported as absent rather than guessed at, so a
    // caller is never penalised for something the chain cannot evidence.
    contradicted: false,
  }));

  // Determinism: the ranking clock is the newest settlement in the record, not the
  // wall clock. Two machines scoring the same record must agree, and re-scoring an
  // unchanged record next year must give the same number — neither holds if `now`
  // comes from Date.now().
  const now = calls.reduce((max, c) => Math.max(max, c.settledAt), 0);

  let result;
  try {
    result = rankCaller(calls, requireWeights(), now);
  } catch (e) {
    // Includes the "weights not provisioned" case, which must fail rather than fall
    // back to defaults — see scoring.ts requireWeights().
    return [null, STATUS_ERROR, `${e}`];
  }
  rankCount++;

  const encoded = encodeAbiParameters(RANK_OUTPUT, [
    authorHash as `0x${string}`,
    result.scoreBps,
    result.sampleSize,
    result.contradictions,
  ]);
  return [encoded, STATUS_OK, null];
}

// ---- TEE node bridge --------------------------------------------------------

/**
 * Call the TEE node's local /decrypt endpoint.
 *
 * Bytes cross as base64 to match the Go node's JSON marshalling of []byte. localhost
 * only — this never leaves the enclave boundary.
 */
function decryptViaNode(ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      encryptedMessage: Buffer.from(ciphertext).toString("base64"),
    });

    const req = http.request(
      `http://localhost:${signPort}/decrypt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const data = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode !== 200) {
            reject(new Error(`node returned ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(new Uint8Array(Buffer.from(JSON.parse(data).decryptedMessage, "base64")));
          } catch (e) {
            reject(new Error(`decode response: ${e}`));
          }
        });
      },
    );

    req.on("error", (e) => reject(new Error(`request error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

export { bytesToHex };
