"""Hex and byte encoding utilities."""


def hex_to_bytes(h: str) -> bytes:
    """Decode a hex string (optional 0x prefix) to bytes."""
    h = h.removeprefix("0x")
    if not h:
        return b""
    return bytes.fromhex(h)


def bytes_to_hex(b: bytes) -> str:
    """Encode bytes to a 0x-prefixed hex string."""
    return "0x" + b.hex()
