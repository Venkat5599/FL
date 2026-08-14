"""Handler functions for the KEY extension operations."""

from __future__ import annotations

import base64
import json
import logging
from typing import Any, Optional
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from base.types import Framework
from .config import VERSION, OP_TYPE_KEY, OP_COMMAND_UPDATE, OP_COMMAND_SIGN
from .abi import abi_encode_two
from .crypto import sign_ecdsa, parse_private_key
from base.encoding import hex_to_bytes, bytes_to_hex

logger = logging.getLogger(__name__)

# Mutable state — the framework serializes all handler calls.
_private_key: Optional[bytes] = None
_sign_port: str = "9090"


def set_sign_port(port: str) -> None:
    """Set the sign port for communicating with the TEE node."""
    global _sign_port
    _sign_port = port


def register(framework: Framework) -> None:
    """Register the KEY handlers with the framework."""
    framework.handle(OP_TYPE_KEY, OP_COMMAND_UPDATE, handle_key_update)
    framework.handle(OP_TYPE_KEY, OP_COMMAND_SIGN, handle_key_sign)


def report_state() -> Any:
    """Return a JSON-serializable snapshot of the current state."""
    return {
        "hasKey": _private_key is not None,
        "version": VERSION,
    }


def handle_key_update(msg: str) -> tuple[Optional[str], int, Optional[str]]:
    """Decrypt the original message using the TEE node's key, store as private key."""
    global _private_key

    if not msg:
        return None, 0, "originalMessage is empty"

    try:
        ciphertext = hex_to_bytes(msg)
    except Exception as e:
        return None, 0, f"invalid hex in originalMessage: {e}"

    try:
        key_bytes = _decrypt_via_node(ciphertext)
    except Exception as e:
        return None, 0, f"decryption failed: {e}"

    try:
        validated_key = parse_private_key(key_bytes)
    except Exception as e:
        return None, 0, f"invalid private key: {e}"

    _private_key = validated_key
    logger.info("private key updated")
    return None, 1, None


def handle_key_sign(msg: str) -> tuple[Optional[str], int, Optional[str]]:
    """Sign the original message with the stored private key."""
    if _private_key is None:
        return None, 0, "no private key stored"

    if not msg:
        return None, 0, "originalMessage is empty"

    try:
        msg_bytes = hex_to_bytes(msg)
    except Exception as e:
        return None, 0, f"invalid hex in originalMessage: {e}"

    try:
        sig = sign_ecdsa(_private_key, msg_bytes)
    except Exception as e:
        return None, 0, f"signing failed: {e}"

    try:
        encoded = abi_encode_two(msg_bytes, sig)
    except Exception as e:
        return None, 0, f"ABI encoding failed: {e}"

    data_hex = bytes_to_hex(encoded)
    return data_hex, 1, None


def _decrypt_via_node(ciphertext: bytes) -> bytes:
    """Call the TEE node's /decrypt endpoint.

    Sends ciphertext as base64-encoded bytes (matching Go's []byte JSON marshaling).
    Returns the decrypted plaintext bytes.
    """
    url = f"http://localhost:{_sign_port}/decrypt"
    req_body = json.dumps({
        "encryptedMessage": base64.b64encode(ciphertext).decode("ascii"),
    }).encode("utf-8")

    req = Request(url, data=req_body, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return base64.b64decode(data["decryptedMessage"])
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"node returned {e.code}: {body}") from e
    except URLError as e:
        raise RuntimeError(f"request error: {e}") from e
