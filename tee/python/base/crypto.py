"""Cryptographic utilities shared across extensions."""

from Crypto.Hash import keccak


def keccak256(data: bytes) -> bytes:
    """Compute the Keccak-256 hash of data."""
    h = keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()
