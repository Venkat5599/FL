/** Cryptographic utilities shared across extensions. */

import { keccak_256 } from "@noble/hashes/sha3";

/** Compute the Keccak-256 hash of data. */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}
