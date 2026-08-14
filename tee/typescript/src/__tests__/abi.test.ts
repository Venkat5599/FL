import { describe, it, expect } from "vitest";
import { abiEncodeTwo, abiDecodeTwo } from "../app/abi.js";

describe("abiEncodeTwo round trip", () => {
  it("encodes and decodes basic data", () => {
    const a = new TextEncoder().encode("hello world");
    const b = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    const encoded = abiEncodeTwo(a, b);
    const [decodedA, decodedB] = abiDecodeTwo(encoded);

    expect(decodedA).toEqual(a);
    expect(decodedB).toEqual(b);
  });

  it("handles empty arrays", () => {
    const encoded = abiEncodeTwo(new Uint8Array(0), new Uint8Array(0));
    const [a, b] = abiDecodeTwo(encoded);

    expect(a.length).toBe(0);
    expect(b.length).toBe(0);
  });

  it("handles exactly 32 bytes", () => {
    const a = new Uint8Array(32);
    for (let i = 0; i < 32; i++) a[i] = i;
    const b = new Uint8Array([0xff]);

    const encoded = abiEncodeTwo(a, b);
    const [decodedA, decodedB] = abiDecodeTwo(encoded);

    expect(decodedA).toEqual(a);
    expect(decodedB).toEqual(b);
  });

  it("throws for data too short", () => {
    expect(() => abiDecodeTwo(new Uint8Array(10))).toThrow();
  });
});
