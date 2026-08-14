import { beforeEach, describe, expect, it } from "vitest";
import { decodeAbiParameters, encodeAbiParameters } from "viem";

import { Framework, stringToBytes32Hex } from "../base/types.js";
import { register, reportState, resetCounters } from "../app/handlers.js";
import { resetWeights, setWeights, type RankWeights } from "../app/scoring.js";
import { OP_COMMAND_CLASSIFY, OP_COMMAND_RANK, OP_TYPE_SCORE } from "../app/config.js";

const TEST_WEIGHTS: RankWeights = {
  hitRate: 1,
  meanReturn: 1,
  consistency: 1,
  recency: 1,
  conviction: 1,
  contradictionPenalty: 0.5,
  priorStrength: 10,
  returnClampBps: 5000,
  recencyHalfLifeDays: 90,
};

function handlerFor(opCommand: string) {
  const framework = new Framework();
  register(framework);
  const handler = framework.lookup(stringToBytes32Hex(OP_TYPE_SCORE), stringToBytes32Hex(opCommand));
  if (!handler) throw new Error(`no handler registered for ${opCommand}`);
  return handler;
}

const CLASSIFY_INPUT = [{ type: "uint256" }, { type: "string" }] as const;
const CLASSIFY_OUTPUT = [
  { type: "uint256" },
  { type: "uint8" },
  { type: "uint16" },
  { type: "string" },
  { type: "uint32" },
  { type: "bool" },
] as const;

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
const RANK_OUTPUT = [{ type: "bytes32" }, { type: "uint16" }, { type: "uint32" }, { type: "uint32" }] as const;

const AUTHOR = ("0x" + "ab".repeat(32)) as `0x${string}`;

beforeEach(() => {
  resetWeights();
  resetCounters();
});

describe("routing", () => {
  // A mismatch between these strings and the bytes32 constants in
  // TapeInstructionSender.sol does not fail loudly — the enclave just reports
  // "unsupported op type/command" and the instruction dies. So the registration itself
  // is asserted.
  it("registers all three commands under SCORE", () => {
    for (const cmd of ["WEIGHTS", "CLASSIFY", "RANK"]) {
      expect(() => handlerFor(cmd)).not.toThrow();
    }
  });

  it("does not answer an unknown command", () => {
    const framework = new Framework();
    register(framework);
    expect(framework.lookup(stringToBytes32Hex(OP_TYPE_SCORE), stringToBytes32Hex("NOPE"))).toBeNull();
  });
});

describe("CLASSIFY handler", () => {
  it("decodes the instruction and returns an on-chain-shaped verdict", async () => {
    const handler = handlerFor(OP_COMMAND_CLASSIFY);
    const msg = encodeAbiParameters(CLASSIFY_INPUT, [7n, "Longing $ETH here, target $4000 by month end"]);

    const [data, status, err] = await handler(msg);
    expect(err).toBeNull();
    expect(status).toBe(1);

    const [postId, direction, confidence, symbol, expiryDays, isSignal] = decodeAbiParameters(
      CLASSIFY_OUTPUT,
      data as `0x${string}`,
    );
    expect(postId).toBe(7n);
    expect(direction).toBe(1); // CallTape.Direction.Long
    expect(symbol).toBe("ETH");
    expect(expiryDays).toBe(30);
    expect(isSignal).toBe(true);
    expect(Number(confidence)).toBeGreaterThan(0);
  });

  it("reports a non-signal without inventing a direction", async () => {
    const handler = handlerFor(OP_COMMAND_CLASSIFY);
    const msg = encodeAbiParameters(CLASSIFY_INPUT, [7n, "gm frens"]);

    const [data, status] = await handler(msg);
    expect(status).toBe(1);
    const [, direction, confidence, symbol, , isSignal] = decodeAbiParameters(
      CLASSIFY_OUTPUT,
      data as `0x${string}`,
    );
    expect(isSignal).toBe(false);
    expect(direction).toBe(0); // Direction.None
    expect(symbol).toBe("");
    expect(Number(confidence)).toBe(0);
  });

  it("errors on an empty or undecodable message", async () => {
    const handler = handlerFor(OP_COMMAND_CLASSIFY);
    expect((await handler(""))[1]).toBe(0);
    expect((await handler("0xdeadbeef"))[1]).toBe(0);
  });
});

describe("RANK handler", () => {
  const calls = Array.from({ length: 12 }, (_, i) => ({
    pnlBps: 600n,
    postedAt: BigInt(1_755_000_000 - i * 86_400),
    settledAt: BigInt(1_755_100_000 - i * 86_400),
    confidenceBps: 8000,
  }));

  /**
   * The confidentiality guarantee, tested at the boundary: with no weights provisioned
   * the enclave must refuse rather than quietly score under a compiled-in default that
   * would be public by construction.
   */
  it("refuses to rank before weights are provisioned", async () => {
    const handler = handlerFor(OP_COMMAND_RANK);
    const msg = encodeAbiParameters(RANK_INPUT, [AUTHOR, calls]);

    const [data, status, err] = await handler(msg);
    expect(status).toBe(0);
    expect(data).toBeNull();
    expect(err).toContain("weights");
  });

  it("scores once weights are provisioned", async () => {
    setWeights(TEST_WEIGHTS);
    const handler = handlerFor(OP_COMMAND_RANK);
    const msg = encodeAbiParameters(RANK_INPUT, [AUTHOR, calls]);

    const [data, status, err] = await handler(msg);
    expect(err).toBeNull();
    expect(status).toBe(1);

    const [author, scoreBps, sampleSize, contradictions] = decodeAbiParameters(
      RANK_OUTPUT,
      data as `0x${string}`,
    );
    expect(author).toBe(AUTHOR);
    expect(Number(sampleSize)).toBe(12);
    expect(Number(contradictions)).toBe(0);
    expect(Number(scoreBps)).toBeGreaterThan(0);
    expect(Number(scoreBps)).toBeLessThanOrEqual(10_000);
  });

  it("errors on an empty record rather than signing a zero that reads as a verdict", async () => {
    setWeights(TEST_WEIGHTS);
    const handler = handlerFor(OP_COMMAND_RANK);
    const msg = encodeAbiParameters(RANK_INPUT, [AUTHOR, []]);
    expect((await handler(msg))[1]).toBe(0);
  });
});

describe("reportState", () => {
  /**
   * /state is reachable through the extension proxy, so everything it returns is public.
   * It must never expose the weights or anything derived from them.
   */
  it("reveals whether weights are loaded but never the weights", async () => {
    expect((reportState() as { weightsLoaded: boolean }).weightsLoaded).toBe(false);

    setWeights(TEST_WEIGHTS);
    const state = reportState() as Record<string, unknown>;
    expect(state.weightsLoaded).toBe(true);

    const serialised = JSON.stringify(state);
    for (const key of Object.keys(TEST_WEIGHTS)) {
      expect(serialised).not.toContain(key);
    }
    expect(serialised).not.toContain(String(TEST_WEIGHTS.recencyHalfLifeDays));
  });

  it("counts work done", async () => {
    const handler = handlerFor(OP_COMMAND_CLASSIFY);
    await handler(encodeAbiParameters(CLASSIFY_INPUT, [1n, "longing $ETH"]));
    expect((reportState() as { classifyCount: number }).classifyCount).toBe(1);
  });
});
