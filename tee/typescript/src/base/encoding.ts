/** Hex and byte encoding utilities. */

/** Decode a hex string (optional 0x prefix) to a Uint8Array. */
export function hexToBytes(h: string): Uint8Array {
  h = h.startsWith("0x") ? h.slice(2) : h;
  if (h.length === 0) return new Uint8Array(0);
  const buf = Buffer.from(h, "hex");
  return new Uint8Array(buf);
}

/** Encode a Uint8Array to a 0x-prefixed hex string. */
export function bytesToHex(b: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(b).toString("hex")}`;
}
