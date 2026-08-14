"""Tests for cryptographic utilities."""

import unittest

import coincurve

from app.crypto import sign_ecdsa, parse_private_key, _N
from base.crypto import keccak256


class TestSignECDSA(unittest.TestCase):
    def test_basic(self) -> None:
        key = parse_private_key((12345).to_bytes(32, "big"))
        sig = sign_ecdsa(key, b"test message")
        self.assertEqual(len(sig), 65)
        self.assertIn(sig[64], (27, 28))

    def test_different_messages(self) -> None:
        key = parse_private_key((999999).to_bytes(32, "big"))
        sig1 = sign_ecdsa(key, b"message one")
        sig2 = sign_ecdsa(key, b"message two")
        self.assertNotEqual(sig1, sig2)

    def test_deterministic(self) -> None:
        key = parse_private_key((42).to_bytes(32, "big"))
        sig1 = sign_ecdsa(key, b"deterministic test")
        sig2 = sign_ecdsa(key, b"deterministic test")
        self.assertEqual(sig1, sig2)

    def test_verify_signature(self) -> None:
        key = parse_private_key((12345).to_bytes(32, "big"))
        sig = sign_ecdsa(key, b"verify me")
        msg_hash = keccak256(b"verify me")
        recovery_id = sig[64] - 27
        recoverable_sig = sig[:64] + bytes([recovery_id])
        pub_key = coincurve.PublicKey.from_signature_and_message(
            recoverable_sig, msg_hash, hasher=None
        )
        expected_pub = coincurve.PrivateKey(key).public_key
        self.assertEqual(pub_key.format(), expected_pub.format())


class TestParsePrivateKey(unittest.TestCase):
    def test_valid(self) -> None:
        key = parse_private_key(b"\x01")
        self.assertEqual(len(key), 32)

    def test_empty(self) -> None:
        with self.assertRaises(ValueError): parse_private_key(b"")

    def test_zero(self) -> None:
        with self.assertRaises(ValueError): parse_private_key(b"\x00" * 32)

    def test_too_large(self) -> None:
        with self.assertRaises(ValueError): parse_private_key(_N.to_bytes(32, "big"))

    def test_too_long(self) -> None:
        with self.assertRaises(ValueError): parse_private_key(b"\x01" * 33)


if __name__ == "__main__":
    unittest.main()
