/** ABI encoding/decoding helpers using viem. */

import { encodeAbiParameters, decodeAbiParameters } from "viem";
import { bytesToHex, hexToBytes } from "../base/encoding.js";

/**
 * ABI-encode two dynamic byte arrays: (bytes, bytes).
 */
export function abiEncodeTwo(a: Uint8Array, b: Uint8Array): Uint8Array {
  const params = [{ type: "bytes" as const }, { type: "bytes" as const }];
  const encoded = encodeAbiParameters(params, [bytesToHex(a), bytesToHex(b)]);
  return hexToBytes(encoded);
}

/**
 * Decode ABI-encoded (bytes, bytes) back into two byte arrays.
 */
export function abiDecodeTwo(data: Uint8Array): [Uint8Array, Uint8Array] {
  const params = [{ type: "bytes" as const }, { type: "bytes" as const }];
  const [a, b] = decodeAbiParameters(params, bytesToHex(data));
  return [hexToBytes(a as string), hexToBytes(b as string)];
}
