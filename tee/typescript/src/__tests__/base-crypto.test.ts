import { describe, it, expect } from "vitest";
import { keccak256 } from "../base/crypto.js";
import { bytesToHex } from "../base/encoding.js";

describe("keccak256", () => {
  it("hashes empty bytes correctly", () => {
    const h = keccak256(new Uint8Array(0));
    expect(bytesToHex(h)).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
  });

  it("hashes 'hello' correctly", () => {
    const h = keccak256(new TextEncoder().encode("hello"));
    expect(bytesToHex(h)).toBe(
      "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
    );
  });
});
