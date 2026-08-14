import { describe, it, expect } from "vitest";
import { signECDSA, parsePrivateKey } from "../app/crypto.js";
import { keccak256 } from "../base/crypto.js";
import * as secp from "@noble/secp256k1";

/** Create a 32-byte key from a number (big-endian, zero-padded). */
function keyBytes(n: number): Uint8Array {
  const buf = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0 && v > 0; i--) {
    buf[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return buf;
}

describe("signECDSA", () => {
  it("produces 65-byte signature", () => {
    const validKey = parsePrivateKey(keyBytes(12345));
    const sig = signECDSA(validKey, new TextEncoder().encode("test message"));
    expect(sig.length).toBe(65);
    expect(sig[64]).toBeGreaterThanOrEqual(27);
    expect(sig[64]).toBeLessThanOrEqual(28);
  });

  it("produces different signatures for different messages", () => {
    const validKey = parsePrivateKey(keyBytes(999999));

    const sig1 = signECDSA(validKey, new TextEncoder().encode("message one"));
    const sig2 = signECDSA(validKey, new TextEncoder().encode("message two"));

    expect(sig1).not.toEqual(sig2);
  });

  it("produces deterministic signatures", () => {
    const validKey = parsePrivateKey(keyBytes(42));
    const message = new TextEncoder().encode("deterministic test");

    const sig1 = signECDSA(validKey, message);
    const sig2 = signECDSA(validKey, message);

    expect(sig1).toEqual(sig2);
  });

  it("produces verifiable signatures", () => {
    const validKey = parsePrivateKey(keyBytes(12345));
    const message = new TextEncoder().encode("verify me");
    const sig = signECDSA(validKey, message);

    const msgHash = keccak256(message);
    const r = sig.slice(0, 32);
    const s = sig.slice(32, 64);
    const v = sig[64] - 27;

    const sigObj = new secp.Signature(
      BigInt("0x" + Buffer.from(r).toString("hex")),
      BigInt("0x" + Buffer.from(s).toString("hex")),
      v
    );
    const pubKey = secp.getPublicKey(validKey);
    const isValid = secp.verify(sigObj, msgHash, pubKey);
    expect(isValid).toBe(true);
  });
});

describe("parsePrivateKey", () => {
  it("accepts valid key", () => {
    const key = parsePrivateKey(new Uint8Array([1]));
    expect(key.length).toBe(32);
  });

  it("rejects empty key", () => {
    expect(() => parsePrivateKey(new Uint8Array(0))).toThrow("empty");
  });

  it("rejects zero key", () => {
    expect(() => parsePrivateKey(new Uint8Array(32))).toThrow("zero");
  });

  it("rejects key too long", () => {
    expect(() => parsePrivateKey(new Uint8Array(33).fill(1))).toThrow(
      "too long"
    );
  });
});
