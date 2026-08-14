/** Cryptographic utilities: ECDSA signing and key parsing. */

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import * as secp from '@noble/secp256k1';
import { keccak256 } from '../base/crypto.js';

// Configure @noble/secp256k1 to use synchronous HMAC-SHA256.
secp.etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]) => {
  return hmac(sha256, k, secp.etc.concatBytes(...m));
};

/** Pad a byte array to the specified length with leading zeros. */
function padLeft(b: Uint8Array, size: number): Uint8Array {
  if (b.length >= size) {
    return b.slice(b.length - size);
  }
  const result = new Uint8Array(size);
  result.set(b, size - b.length);
  return result;
}

/** Convert a bigint to a Uint8Array (big-endian). */
function bigintToBytes(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(2, '0');
  const paddedHex = hex.length % 2 ? '0' + hex : hex;
  const bytes = new Uint8Array(paddedHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(paddedHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Sign a message with ECDSA on secp256k1.
 * The message is hashed with Keccak-256 before signing.
 * Returns 65 bytes: r (32) || s (32) || v (1).
 */
export function signECDSA(
  privateKey: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  const msgHash = keccak256(message);

  const sig = secp.sign(msgHash, privateKey);
  const r = padLeft(bigintToBytes(sig.r), 32);
  const s = padLeft(bigintToBytes(sig.s), 32);

  // Recovery ID: sig.recovery is 0 or 1, Ethereum convention adds 27
  const v = (sig.recovery ?? 0) + 27;

  const result = new Uint8Array(65);
  result.set(r, 0);
  result.set(s, 32);
  result[64] = v;

  return result;
}

/**
 * Validate raw bytes as a secp256k1 private key scalar.
 * Returns the 32-byte key.
 */
export function parsePrivateKey(b: Uint8Array): Uint8Array {
  if (b.length === 0) {
    throw new Error('key bytes are empty');
  }
  if (b.length > 32) {
    throw new Error(`key too long: ${b.length} bytes`);
  }

  // Check it's not zero
  let allZero = true;
  for (const byte of b) {
    if (byte !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) {
    throw new Error('key is zero');
  }

  // Pad to 32 bytes
  const key = padLeft(b, 32);

  // Verify it's a valid secp256k1 private key by trying to get the public key
  try {
    secp.getPublicKey(key);
  } catch {
    throw new Error('key >= curve order');
  }

  return key;
}
