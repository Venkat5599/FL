import { describe, it, expect } from "vitest";
import { hexToBytes, bytesToHex } from "../base/encoding.js";

describe("hexToBytes", () => {
  it("decodes with 0x prefix", () => {
    const b = hexToBytes("0xdeadbeef");
    expect(b).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("decodes without prefix", () => {
    const b = hexToBytes("abcd");
    expect(b).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it("returns empty for empty string", () => {
    const b = hexToBytes("");
    expect(b.length).toBe(0);
  });

  it("returns empty for 0x only", () => {
    const b = hexToBytes("0x");
    expect(b.length).toBe(0);
  });
});

describe("bytesToHex", () => {
  it("encodes correctly", () => {
    expect(bytesToHex(new Uint8Array([0xde, 0xad]))).toBe("0xdead");
  });
});
