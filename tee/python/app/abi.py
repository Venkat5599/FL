"""ABI encoding/decoding helpers using eth_abi."""

from __future__ import annotations

from eth_abi import encode, decode


def abi_encode_two(a: bytes, b: bytes) -> bytes:
    """ABI-encode two dynamic byte arrays: (bytes, bytes)."""
    return encode(["bytes", "bytes"], [a, b])


def abi_decode_two(data: bytes) -> tuple[bytes, bytes]:
    """Decode ABI-encoded (bytes, bytes) back into two byte slices."""
    result = decode(["bytes", "bytes"], data)
    return bytes(result[0]), bytes(result[1])
