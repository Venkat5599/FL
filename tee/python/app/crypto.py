"""Cryptographic utilities: ECDSA signing and key parsing."""

from __future__ import annotations

import coincurve

from base.crypto import keccak256

# secp256k1 curve order
_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def _pad_left(b: bytes, size: int) -> bytes:
    """Pad a byte string to the specified length with leading zeros."""
    if len(b) >= size:
        return b[len(b) - size:]
    return b"\x00" * (size - len(b)) + b


def sign_ecdsa(private_key_bytes: bytes, message: bytes) -> bytes:
    """Sign a message with ECDSA on secp256k1.

    The message is hashed with Keccak-256 before signing.
    Returns 65 bytes: r (32) || s (32) || v (1), with v = 27 or 28.
    """
    msg_hash = keccak256(message)
    key = coincurve.PrivateKey(private_key_bytes)
    sig = key.sign_recoverable(msg_hash, hasher=None)
    # coincurve returns: r (32) || s (32) || recovery_id (1)
    # Convert recovery_id (0 or 1) to Ethereum convention (27 or 28)
    r_s = sig[:64]
    v = sig[64] + 27
    return r_s + bytes([v])


def parse_private_key(b: bytes) -> bytes:
    """Validate raw bytes as a secp256k1 private key scalar.

    Returns the 32-byte key.
    """
    if len(b) == 0:
        raise ValueError("key bytes are empty")
    if len(b) > 32:
        raise ValueError(f"key too long: {len(b)} bytes")

    if all(byte == 0 for byte in b):
        raise ValueError("key is zero")

    key = _pad_left(b, 32)

    scalar = int.from_bytes(key, "big")
    if scalar >= _N:
        raise ValueError("key >= curve order")

    try:
        coincurve.PrivateKey(key)
    except Exception as e:
        raise ValueError(f"invalid private key: {e}") from e

    return key
