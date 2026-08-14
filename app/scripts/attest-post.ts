/**
 * Attest an X post through the Flare Data Connector and enter it into PostRegistry.
 *
 * This is the script that turns "we scraped it" into "the network proved it". After it
 * runs, the claim that a given account published a given text at a given time is carried
 * by a Merkle proof against an FDC voting round that Flare's data providers signed — and
 * it survives the post being deleted.
 *
 * Flow:
 *   1. Ask the verifier to prepare an attestation request (it validates the jq filter
 *      and ABI signature, and returns the canonical ABI-encoded request).
 *   2. Submit that request to FdcHub with the round fee.
 *   3. Work out which voting round it landed in, and wait for the Relay to finalise it.
 *   4. Pull the proof from the DA layer.
 *   5. Hand the proof to PostRegistry, which verifies it on-chain before storing anything.
 *
 * Usage:
 *   bun scripts/attest-post.ts <x-post-id> [...more ids]
 *
 * Required env:
 *   VERIFIER_URL_TESTNET       FDC verifier base url
 *   VERIFIER_API_KEY_TESTNET   verifier api key
 *   COSTON2_DA_LAYER_URL       DA layer base url
 *   POST_REGISTRY_ADDRESS      deployed PostRegistry
 *   ATTESTER_PRIVATE_KEY       funded Coston2 key (gas + attestation fee)
 *   TAPE_PROXY_BASE_URL        public base url of this app, e.g. https://tape.vercel.app
 *                              (the FDC verifiers fetch it themselves, so localhost
 *                              cannot work — it must be reachable from the internet)
 */

import {
  createWalletClient,
  decodeAbiParameters,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { activeNetwork, flareContract, publicClient, toViemChain, txUrl } from "../lib/flare";

// ---- attestation shape ------------------------------------------------------

/**
 * The jq filter reducing the proxy's response to exactly the DTO fields.
 *
 * Field ORDER is load-bearing: it must match PostRegistry.AttestedPost exactly, because
 * the result is ABI-encoded positionally. A reordering does not error — it decodes into
 * the wrong fields and stores a post whose author is its text.
 */
const POST_PROCESS_JQ = "{postId: .postId, author: .author, text: .text, createdAt: .createdAt}";

/** ABI signature of PostRegistry.AttestedPost, as the verifier expects it. */
const ABI_SIGNATURE = JSON.stringify({
  components: [
    { internalType: "string", name: "postId", type: "string" },
    { internalType: "string", name: "author", type: "string" },
    { internalType: "string", name: "text", type: "string" },
    { internalType: "uint256", name: "createdAt", type: "uint256" },
  ],
  name: "task",
  type: "tuple",
});

/**
 * `sourceId` is "PublicWeb2", NOT "Web2Json". The attestation TYPE is Web2Json; the
 * SOURCE is the public web. Getting this wrong is rejected by the verifier with an
 * unhelpful error, so it is pinned here with this note.
 */
const ATTESTATION_TYPE = "Web2Json";
const SOURCE_ID = "PublicWeb2";

/** UTF-8 string -> right-padded bytes32 hex, the encoding FDC uses for these fields. */
function toUtf8Bytes32(s: string): Hex {
  return `0x${Buffer.from(s, "utf-8").toString("hex").padEnd(64, "0")}`;
}

// ---- contract fragments -----------------------------------------------------

const FDC_HUB_ABI = parseAbi([
  "function requestAttestation(bytes _data) external payable",
]);

const FEE_CONFIG_ABI = parseAbi([
  "function getRequestFee(bytes _data) external view returns (uint256)",
]);

const SYSTEMS_MANAGER_ABI = parseAbi([
  "function firstVotingRoundStartTs() external view returns (uint64)",
  "function votingEpochDurationSeconds() external view returns (uint64)",
]);

const RELAY_ABI = parseAbi([
  "function isFinalized(uint256 _protocolId, uint256 _votingRoundId) external view returns (bool)",
]);

const FDC_VERIFICATION_ABI = parseAbi([
  "function fdcProtocolId() external view returns (uint8)",
]);

const POST_REGISTRY_ABI = parseAbi([
  "function recordPost(((bytes32[] merkleProof, (bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, (string url, string httpMethod, string headers, string queryParams, string body, string postProcessJq, string abiSignature) requestBody, (bytes abiEncodedData) responseBody) data)) _proof) external returns (uint256)",
  "function findPost(string _platformPostId) external view returns (bool found, uint256 postId)",
]);

/** Matches IWeb2Json.Response, for decoding the DA layer's response_hex. */
const WEB2JSON_RESPONSE_TYPE = [
  {
    type: "tuple",
    components: [
      { name: "attestationType", type: "bytes32" },
      { name: "sourceId", type: "bytes32" },
      { name: "votingRound", type: "uint64" },
      { name: "lowestUsedTimestamp", type: "uint64" },
      {
        name: "requestBody",
        type: "tuple",
        components: [
          { name: "url", type: "string" },
          { name: "httpMethod", type: "string" },
          { name: "headers", type: "string" },
          { name: "queryParams", type: "string" },
          { name: "body", type: "string" },
          { name: "postProcessJq", type: "string" },
          { name: "abiSignature", type: "string" },
        ],
      },
      {
        name: "responseBody",
        type: "tuple",
        components: [{ name: "abiEncodedData", type: "bytes" }],
      },
    ],
  },
] as const;

// ---- helpers ----------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Step 1 — prepare the request.
 *
 * The verifier does more than encode: it actually fetches the URL and runs the jq filter,
 * so a failure here means the endpoint or the filter is wrong. That is the cheapest place
 * to find out, long before any gas is spent.
 */
async function prepareRequest(postId: string): Promise<Hex> {
  const verifierUrl = requireEnv("VERIFIER_URL_TESTNET").replace(/\/$/, "");
  const apiKey = requireEnv("VERIFIER_API_KEY_TESTNET");
  const proxyBase = requireEnv("TAPE_PROXY_BASE_URL").replace(/\/$/, "");

  const body = {
    attestationType: toUtf8Bytes32(ATTESTATION_TYPE),
    sourceId: toUtf8Bytes32(SOURCE_ID),
    requestBody: {
      url: `${proxyBase}/api/x-post/${postId}`,
      httpMethod: "GET",
      // Empty on purpose. Anything here is committed on-chain and public forever, which
      // is exactly why the X bearer token lives behind the proxy instead (see
      // app/api/x-post/[id]/route.ts).
      headers: "{}",
      queryParams: "{}",
      body: "{}",
      postProcessJq: POST_PROCESS_JQ,
      abiSignature: ABI_SIGNATURE,
    },
  };

  const res = await fetch(`${verifierUrl}/verifier/web2/Web2Json/prepareRequest`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`verifier prepareRequest failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { status?: string; abiEncodedRequest?: Hex };
  if (!json.abiEncodedRequest) {
    throw new Error(`verifier returned no abiEncodedRequest: ${JSON.stringify(json)}`);
  }
  return json.abiEncodedRequest;
}

/** Step 3 — which voting round did this land in? */
async function roundIdForBlock(blockTimestamp: bigint): Promise<number> {
  const client = publicClient();
  const manager = await flareContract("FlareSystemsManager");

  const [start, duration] = await Promise.all([
    client.readContract({ address: manager, abi: SYSTEMS_MANAGER_ABI, functionName: "firstVotingRoundStartTs" }),
    client.readContract({
      address: manager,
      abi: SYSTEMS_MANAGER_ABI,
      functionName: "votingEpochDurationSeconds",
    }),
  ]);

  return Number((blockTimestamp - BigInt(start)) / BigInt(duration));
}

/**
 * Wait for the round to finalise.
 *
 * Rounds take a couple of minutes. Polling the Relay is the only reliable signal — asking
 * the DA layer early returns a 404 that is indistinguishable from a genuinely bad request.
 */
async function waitForFinalisation(roundId: number, timeoutMs = 15 * 60_000): Promise<void> {
  const client = publicClient();
  const [relay, verification] = await Promise.all([
    flareContract("Relay"),
    flareContract("FdcVerification"),
  ]);

  const protocolId = await client.readContract({
    address: verification,
    abi: FDC_VERIFICATION_ABI,
    functionName: "fdcProtocolId",
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const finalised = await client.readContract({
      address: relay,
      abi: RELAY_ABI,
      functionName: "isFinalized",
      args: [BigInt(protocolId), BigInt(roundId)],
    });
    if (finalised) return;
    process.stdout.write(".");
    await sleep(10_000);
  }
  throw new Error(`round ${roundId} did not finalise within ${timeoutMs / 60_000} minutes`);
}

/** Step 4 — fetch the Merkle proof and attested response. */
async function fetchProof(roundId: number, abiEncodedRequest: Hex) {
  const daUrl = requireEnv("COSTON2_DA_LAYER_URL").replace(/\/$/, "");

  const res = await fetch(`${daUrl}/api/v1/fdc/proof-by-request-round-raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest }),
  });

  if (!res.ok) throw new Error(`DA layer returned ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { response_hex?: Hex; proof?: Hex[] };
  if (!json.response_hex || !json.proof) {
    throw new Error(`DA layer returned no proof yet: ${JSON.stringify(json)}`);
  }
  return json as { response_hex: Hex; proof: Hex[] };
}

// ---- main -------------------------------------------------------------------

async function attestOne(xPostId: string): Promise<void> {
  const net = activeNetwork();
  const client = publicClient(net);
  const account = privateKeyToAccount(`0x${requireEnv("ATTESTER_PRIVATE_KEY").replace(/^0x/, "")}`);
  const wallet = createWalletClient({ account, chain: toViemChain(net), transport: http(net.rpcUrl) });
  const postRegistry = requireEnv("POST_REGISTRY_ADDRESS") as Address;

  // Skip work that is already done. Re-attesting is harmless (PostRegistry is
  // idempotent) but it costs a fee and several minutes.
  const [alreadyRecorded] = (await client.readContract({
    address: postRegistry,
    abi: POST_REGISTRY_ABI,
    functionName: "findPost",
    args: [xPostId],
  })) as [boolean, bigint];
  if (alreadyRecorded) {
    console.log(`[${xPostId}] already on the tape, skipping`);
    return;
  }

  console.log(`[${xPostId}] preparing attestation request...`);
  const abiEncodedRequest = await prepareRequest(xPostId);

  const [fdcHub, feeConfig] = await Promise.all([
    flareContract("FdcHub", net),
    flareContract("FdcRequestFeeConfigurations", net),
  ]);

  const fee = (await client.readContract({
    address: feeConfig,
    abi: FEE_CONFIG_ABI,
    functionName: "getRequestFee",
    args: [abiEncodedRequest],
  })) as bigint;

  console.log(`[${xPostId}] submitting to FdcHub (fee ${fee} wei)...`);
  const hash = await wallet.writeContract({
    address: fdcHub,
    abi: FDC_HUB_ABI,
    functionName: "requestAttestation",
    args: [abiEncodedRequest],
    value: fee,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`[${xPostId}] submitted: ${txUrl(hash, net)}`);

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const roundId = await roundIdForBlock(block.timestamp);
  console.log(`[${xPostId}] voting round ${roundId}, waiting for finalisation`);

  await waitForFinalisation(roundId);
  console.log(`\n[${xPostId}] round finalised, fetching proof...`);

  const { response_hex, proof } = await fetchProof(roundId, abiEncodedRequest);
  const [decodedResponse] = decodeAbiParameters(WEB2JSON_RESPONSE_TYPE, response_hex);

  console.log(`[${xPostId}] recording on-chain...`);
  const recordHash = await wallet.writeContract({
    address: postRegistry,
    abi: POST_REGISTRY_ABI,
    functionName: "recordPost",
    // PostRegistry verifies this proof against the FDC relay before storing anything, so
    // a forged or stale proof reverts here rather than entering the record.
    args: [{ merkleProof: proof, data: decodedResponse }] as never,
  });
  await client.waitForTransactionReceipt({ hash: recordHash });

  console.log(`[${xPostId}] recorded: ${txUrl(recordHash, net)}`);
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter(Boolean);
  if (ids.length === 0) {
    console.error("usage: bun scripts/attest-post.ts <x-post-id> [...more ids]");
    process.exit(1);
  }

  let failures = 0;
  for (const id of ids) {
    try {
      await attestOne(id);
    } catch (e) {
      // One bad post must not abort a batch — the rest are independent, and a partial
      // tape is more useful than none.
      failures++;
      console.error(`[${id}] FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures}/${ids.length} failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
